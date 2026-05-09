import { Injectable, Logger } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { BOT_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { RedisService } from '../common/redis/redis.module';
import { MatchTokenService } from './match-token.service';
import { LedgerService } from '../wallet/ledger.service';

export const MATCH_FOUND_CHANNEL = 'lobby:match-found';

export interface MatchFoundEvent {
  userId: number;
  matchId: string;
  matchToken: string;
  gameWsUrl: string;
  opponent: { id: number; username: string };
  room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
}

interface CreateMatchInput {
  player1Id: number;
  player2Id: number;
  room: Room;
  isBotMatch?: boolean;
}

@Injectable()
export class MatchCreationService {
  private readonly log = new Logger('MatchCreation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: MatchTokenService,
    private readonly ledger: LedgerService,
  ) {}

  async createMatch(input: CreateMatchInput): Promise<{ matchId: string }> {
    const meta: Record<string, unknown> = {};
    if (input.isBotMatch) meta.bot = true;

    // Resolve loadouts (character+skin) for both players. Bot: pick first active char/default skin.
    const p1Loadout = await this.resolveLoadout(input.player1Id);
    const p2Loadout = input.isBotMatch
      ? await this.resolveBotLoadout()
      : await this.resolveLoadout(input.player2Id);

    const match = await this.prisma.match.create({
      data: {
        roomId: input.room.id,
        stakeUsd: input.room.stakeUsd ?? 0,
        player1Id: input.player1Id,
        player2Id: input.player2Id,
        player1CharId: p1Loadout.characterId,
        player1SkinId: p1Loadout.skinId,
        player2CharId: p2Loadout.characterId,
        player2SkinId: p2Loadout.skinId,
        status: 'PENDING',
        meta,
      },
    });

    // Lock stakes for paid (non-bot) matches. Bot matches are always free.
    const stake = input.room.stakeUsd ? String(input.room.stakeUsd) : '0';
    if (!input.isBotMatch && Number(stake) > 0) {
      try {
        await this.ledger.lockStake(match.id, input.player1Id, stake);
        await this.ledger.lockStake(match.id, input.player2Id, stake);
      } catch (err) {
        this.log.error(`stake lock failed for match ${match.id}: ${(err as Error).message}`);
        // Roll back: try to unlock whichever side already locked, mark match cancelled.
        await this.ledger.unlockStake(match.id, input.player1Id, stake).catch(() => undefined);
        await this.ledger.unlockStake(match.id, input.player2Id, stake).catch(() => undefined);
        await this.prisma.match.update({
          where: { id: match.id },
          data: { status: 'CANCELLED', meta: { ...meta, cancelReason: 'insufficient_balance' } },
        });
        throw err;
      }
    }

    const player1 = await this.prisma.user.findUniqueOrThrow({
      where: { id: input.player1Id },
      select: { id: true, username: true },
    });
    const player2 = await this.prisma.user.findUniqueOrThrow({
      where: { id: input.player2Id },
      select: { id: true, username: true },
    });

    const gameWsUrl = process.env.GAME_PUBLIC_WS_URL ?? 'ws://localhost/ws/match';

    // Persist seed for game-server to load on first connection.
    const tickRate = Number(process.env.TICK_RATE ?? 30);
    const obstacles = Array.isArray(input.room.obstacles) ? input.room.obstacles : [];
    const seed = {
      matchId: match.id,
      mode: input.room.mode,
      roomId: input.room.id,
      stakeUsd: input.room.stakeUsd ? String(input.room.stakeUsd) : undefined,
      tickRate,
      durationMs: 90_000,
      isBotMatch: !!input.isBotMatch,
      obstacles,
      player1: {
        userId: player1.id,
        username: player1.username,
        characterId: p1Loadout.characterId,
        skinId: p1Loadout.skinId,
        stats: p1Loadout.stats,
        characterSpriteUrl: p1Loadout.characterSpriteUrl,
        weaponSpriteUrl: p1Loadout.weaponSpriteUrl,
        bulletSpriteUrl: p1Loadout.bulletSpriteUrl,
        ability: p1Loadout.ability,
      },
      player2: {
        userId: player2.id,
        username: player2.username,
        characterId: p2Loadout.characterId,
        skinId: p2Loadout.skinId,
        stats: p2Loadout.stats,
        characterSpriteUrl: p2Loadout.characterSpriteUrl,
        weaponSpriteUrl: p2Loadout.weaponSpriteUrl,
        bulletSpriteUrl: p2Loadout.bulletSpriteUrl,
        ability: p2Loadout.ability,
      },
    };
    await this.redis.client.set(`match:seed:${match.id}`, JSON.stringify(seed), 'EX', 600);

    // Publish match:found for each human player only (bot doesn't subscribe).
    for (const [self, other] of [
      [player1, player2],
      [player2, player1],
    ] as const) {
      if (self.id === BOT_USER_ID) continue;
      const ev: MatchFoundEvent = {
        userId: self.id,
        matchId: match.id,
        matchToken: this.tokens.sign({ matchId: match.id, userId: self.id }),
        gameWsUrl,
        opponent: { id: other.id, username: other.username },
        room: {
          id: input.room.id,
          mode: input.room.mode,
          ...(input.room.stakeUsd ? { stakeUsd: String(input.room.stakeUsd) } : {}),
        },
      };
      // Store as fallback for players whose lobby WS was not connected at this exact moment.
      // The lobby gateway reads this on (re)connect and delivers it, then deletes the key.
      // 5 min TTL is comfortably longer than any realistic reconnect/cold-load window
      // and well under the match seed lifetime (10 min), so a player who briefly loses
      // their connection at the worst possible moment can still recover into the match.
      await this.redis.client.set(
        `lobby:pending-match:${self.id}`,
        JSON.stringify(ev),
        'EX',
        300,
      );
      await this.redis.client.publish(MATCH_FOUND_CHANNEL, JSON.stringify(ev));
    }

    this.log.log(
      `match ${match.id} created (${input.player1Id} vs ${input.player2Id}, room=${input.room.id})`,
    );
    return { matchId: match.id };
  }

  /**
   * Resolves the active character/skin and effective stats for a user.
   * Falls back to first active character + Default skin when no loadout exists.
   */
  private async resolveLoadout(userId: number): Promise<ResolvedLoadout> {
    const loadout = await this.prisma.userLoadout.findUnique({ where: { userId } });
    if (loadout) {
      const [char, skin] = await Promise.all([
        this.prisma.character.findUnique({ where: { id: loadout.characterId }, include: { ability: true } }),
        this.prisma.skin.findUnique({ where: { id: loadout.skinId } }),
      ]);
      if (char && skin) {
        const weapon = await this.resolveWeapon(loadout.weaponId ?? null);
        return {
          characterId: char.id,
          skinId: skin.id,
          stats: this.computeStats(char, skin, weapon),
          characterSpriteUrl: char.battleSpriteUrl ?? char.spriteUrl ?? null,
          weaponSpriteUrl: weapon?.spriteUrl ?? null,
          bulletSpriteUrl: char.bulletSpriteUrl ?? null,
          ability: char.ability ? {
            type: char.ability.type,
            cooldownMs: char.ability.cooldownMs,
            damageAmount: char.ability.damageAmount,
            durationMs: char.ability.durationMs,
            range: char.ability.range,
            soundUrl: char.ability.soundUrl ?? null,
            iconUrl: char.ability.iconUrl ?? null,
          } : null,
        };
      }
    }
    return this.resolveBotLoadout();
  }

  private async resolveBotLoadout(): Promise<ResolvedLoadout> {
    const char = await this.prisma.character.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      include: { skins: { where: { isActive: true }, orderBy: { id: 'asc' }, take: 1 }, ability: true },
    });
    if (!char) throw new Error('no active character seeded');
    const skin = char.skins[0];
    if (!skin) throw new Error(`character ${char.id} has no skin`);
    const weapon = await this.resolveWeapon(null);
    return {
      characterId: char.id,
      skinId: skin.id,
      stats: this.computeStats(char, skin, weapon),
      characterSpriteUrl: char.battleSpriteUrl ?? char.spriteUrl ?? null,
      weaponSpriteUrl: weapon?.spriteUrl ?? null,
      bulletSpriteUrl: char.bulletSpriteUrl ?? null,
      ability: char.ability ? {
        type: char.ability.type,
        cooldownMs: char.ability.cooldownMs,
        damageAmount: char.ability.damageAmount,
        durationMs: char.ability.durationMs,
        range: char.ability.range,
        soundUrl: char.ability.soundUrl ?? null,
        iconUrl: char.ability.iconUrl ?? null,
      } : null,
    };
  }

  private async resolveWeapon(weaponId: number | null) {
    if (weaponId != null) {
      const w = await this.prisma.weapon.findUnique({ where: { id: weaponId } });
      if (w && w.isActive) return w;
    }
    return this.prisma.weapon.findFirst({
      where: { isActive: true, isStarter: true },
      orderBy: { id: 'asc' },
    });
  }

  private computeStats(
    char: { baseHp: number; baseSpeed: number; baseDamage: number; weaponType: string },
    skin: { statModifiers: unknown },
    weapon: { damage: number; fireRateMs: number; bulletSpeed: number } | null,
  ): EffectiveStats {
    const mods = (skin.statModifiers ?? {}) as { hpPct?: number; speedPct?: number; damagePct?: number };
    const hp = Math.max(1, Math.round(char.baseHp * (1 + (mods.hpPct ?? 0) / 100)));
    const speed = Math.max(50, char.baseSpeed * (1 + (mods.speedPct ?? 0) / 100));
    const baseDmg = weapon ? weapon.damage : char.baseDamage;
    const damage = Math.max(1, Math.round(baseDmg * (1 + (mods.damagePct ?? 0) / 100)));
    return { hp, speed, damage, weaponType: char.weaponType };
  }
}

interface EffectiveStats {
  hp: number;
  speed: number;
  damage: number;
  weaponType: string;
}

interface AbilitySeed {
  type: string;
  cooldownMs: number;
  damageAmount: number;
  durationMs: number;
  range: number;
  soundUrl: string | null;
  iconUrl: string | null;
}

interface ResolvedLoadout {
  characterId: number;
  skinId: number;
  stats: EffectiveStats;
  characterSpriteUrl: string | null;
  weaponSpriteUrl: string | null;
  bulletSpriteUrl: string | null;
  ability: AbilitySeed | null;
}
