import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Room } from '@prisma/client';
import { BOT_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { RedisService } from '../common/redis/redis.module';
import { MatchTokenService } from './match-token.service';
import { LedgerService } from '../wallet/ledger.service';

export const MATCH_FOUND_CHANNEL = 'lobby:match-found';

const BOT_NAMES = [
  'shadow_fox', 'pixel_warden', 'krait', 'nightowl', 'arc_wolf', 'orion',
  'tundra', 'voidstep', 'crimson', 'echo_one', 'spectre', 'glitchy',
  'kestrel', 'razorbyte', 'paperjet', 'mirage', 'icarus', 'ronin',
  'flux', 'doppler', 'cobra', 'phantasm', 'reckoner', 'novak', 'zephyr',
  'kairo', 'mistral', 'tempest', 'hexbloom', 'lunar', 'volt', 'nyx',
  'blaze', 'frost', 'ember', 'gale', 'hailstorm', 'inferno', 'jolt',
  'kraken', 'lance', 'mojo', 'neon', 'omen', 'prowler', 'quasar', 'rift',
  'siren', 'titan', 'umbra', 'vex', 'wraith', 'xeno', 'yonder', 'zenith',
  'ace_rune', 'blackice', 'cinder', 'drift', 'eclipse', 'fang', 'ghost',
  'havoc', 'iron', 'jester', 'karma', 'lynx', 'maverick', 'nomad', 'orca',
  'phoenix', 'quartz', 'raven', 'sable', 'thorn', 'ursa', 'venom', 'whisper',
  'xray', 'yeti', 'zulu', 'apex', 'bolt', 'comet', 'dagger', 'edge',
  'falcon', 'grit', 'haze', 'idol', 'jinx', 'krypto', 'loop', 'meteor',
  'nitro', 'onyx', 'piper', 'quick', 'rogue', 'snipe', 'tracer', 'undead',
  'vanta', 'wolfie', 'xander', 'yoru', 'zen', 'astro', 'bandit', 'cipher',
  'dynamo', 'enigma', 'fenix', 'gizmo', 'hunter', 'inkwell', 'juno', 'kobalt',
  'lazer', 'minty', 'ninja', 'oracle', 'pulse', 'quill', 'rasp', 'scout',
  'turbo', 'ulysses', 'vibe', 'wisp', 'xcal', 'yolo', 'zap', 'aero',
  'brick', 'creep', 'dusk', 'echo', 'flick', 'glow', 'hush', 'iris',
  'jolly', 'kilo', 'lotus', 'milo', 'noodle', 'oof', 'pancake', 'quest',
  'rumble', 'sleek', 'tango', 'unity', 'vortex', 'wave', 'xpert', 'yummy',
  'zoom', 'arcade', 'breeze', 'cube', 'duke', 'epic', 'fizz', 'gravy',
];

function pickBotName(): string {
  const base = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] ?? 'player';
  // Almost always append a numeric suffix so duplicates between concurrent
  // bot matches are extremely rare (~150 * 9000 = 1.35M unique handles).
  const suffix = Math.floor(100 + Math.random() * 9900);
  return `${base}${suffix}`;
}

type BotDifficulty = 'easy' | 'medium' | 'hard';
function parseDifficulty(v: unknown): BotDifficulty {
  if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  return 'medium';
}

export interface MatchFoundEvent {
  userId: number;
  matchId: string;
  matchToken: string;
  gameWsUrl: string;
  opponent: { id: number; username: string };
  room: { id: number; name?: string; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
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
    if (input.isBotMatch) {
      meta.bot = true;
      // Pre-pick the bot's per-match display name and persist it so the same
      // name is shown in match history (player2.username is always 'Bot').
      meta.botUsername = pickBotName();
    }

    // CASUAL inclusivity toggle (rooms.casualEnabled=true) lets zero-balance
    // players still queue and play MMR — the match is then run free (no
    // lock, no payout). Players who CAN afford the stake play paid as usual.
    // If either side can't afford, the match runs free for both (we cannot
    // have asymmetric stakes — ledger requires equal locks).
    let effectiveStake: string = input.room.stakeUsd ? String(input.room.stakeUsd) : '0';
    if (input.room.mode === 'CASUAL' && Number(effectiveStake) > 0 && !input.isBotMatch) {
      const setting = await this.prisma.setting.findUnique({ where: { key: 'rooms.casualEnabled' } });
      const casualInclusive = !!setting && (setting.value === true || (setting.value as unknown) === 'true');
      if (casualInclusive) {
        const [w1, w2] = await Promise.all([
          this.prisma.wallet.findUnique({ where: { userId: input.player1Id } }),
          this.prisma.wallet.findUnique({ where: { userId: input.player2Id } }),
        ]);
        const need = Number(effectiveStake);
        const b1 = Number(w1?.balance ?? 0);
        const b2 = Number(w2?.balance ?? 0);
        if (b1 < need || b2 < need) {
          effectiveStake = '0';
          meta.casualFree = true;
        }
      }
    }

    // Resolve loadouts (character+skin) for both players. Bot: pick first active char/default skin.
    const p1Loadout = await this.resolveLoadout(input.player1Id);
    const p2Loadout = input.isBotMatch
      ? await this.resolveBotLoadout()
      : await this.resolveLoadout(input.player2Id);

    const match = await this.prisma.match.create({
      data: {
        roomId: input.room.id,
        stakeUsd: effectiveStake,
        player1Id: input.player1Id,
        player2Id: input.player2Id,
        player1CharId: p1Loadout.characterId,
        player1SkinId: p1Loadout.skinId,
        player2CharId: p2Loadout.characterId,
        player2SkinId: p2Loadout.skinId,
        status: 'PENDING',
        meta: meta as Prisma.InputJsonValue,
      },
    });

    // Lock stakes for paid (non-bot) matches. Bot matches are always free.
    const stake = effectiveStake;
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
          data: { status: 'CANCELLED', meta: { ...meta, cancelReason: 'insufficient_balance' } as Prisma.InputJsonValue },
        });
        throw err;
      }
    }

    const player1 = await this.prisma.user.findUniqueOrThrow({
      where: { id: input.player1Id },
      select: { id: true, username: true },
    });
    const player2User = await this.prisma.user.findUniqueOrThrow({
      where: { id: input.player2Id },
      select: { id: true, username: true },
    });

    // For bot matches, replace the visible username with a realistic random
    // name AND resolve bot difficulty from settings. The name is per-match so
    // the human player can't recognize the bot by username.
    let botConfig: { difficulty: BotDifficulty; startDelayMs: number } | undefined;
    let player2Display = { id: player2User.id, username: player2User.username };
    if (input.isBotMatch) {
      const diffSetting = await this.prisma.setting.findUnique({
        where: { key: 'bots.difficulty' },
      });
      botConfig = {
        difficulty: parseDifficulty(diffSetting?.value),
        startDelayMs: 3500,
      };
      const persistedName = typeof meta.botUsername === 'string' ? (meta.botUsername as string) : pickBotName();
      player2Display = { id: player2User.id, username: persistedName };
    }

    const gameWsUrl = process.env.GAME_PUBLIC_WS_URL ?? 'ws://localhost/ws/match';

    // Persist seed for game-server to load on first connection.
    const tickRate = Number(process.env.TICK_RATE ?? 30);
    const obstacles = Array.isArray(input.room.obstacles) ? input.room.obstacles : [];
    const seed = {
      matchId: match.id,
      mode: input.room.mode,
      roomId: input.room.id,
      roomName: input.room.name,
      stakeUsd: Number(effectiveStake) > 0 ? effectiveStake : undefined,
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
        userId: player2Display.id,
        username: player2Display.username,
        characterId: p2Loadout.characterId,
        skinId: p2Loadout.skinId,
        stats: p2Loadout.stats,
        characterSpriteUrl: p2Loadout.characterSpriteUrl,
        weaponSpriteUrl: p2Loadout.weaponSpriteUrl,
        bulletSpriteUrl: p2Loadout.bulletSpriteUrl,
        ability: p2Loadout.ability,
      },
      ...(botConfig ? { botConfig } : {}),
    };
    await this.redis.client.set(`match:seed:${match.id}`, JSON.stringify(seed), 'EX', 600);

    // Publish match:found for each human player only (bot doesn't subscribe).
    for (const [self, other] of [
      [player1, player2Display],
      [player2Display, player1],
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
          name: input.room.name,
          mode: input.room.mode,
          ...(Number(effectiveStake) > 0 ? { stakeUsd: effectiveStake } : {}),
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
    // Pick a RANDOM active character so the bot doesn't always look the same.
    const chars = await this.prisma.character.findMany({
      where: { isActive: true },
      include: { skins: { where: { isActive: true }, orderBy: { id: 'asc' } }, ability: true },
    });
    if (chars.length === 0) throw new Error('no active character seeded');
    const char = chars[Math.floor(Math.random() * chars.length)]!;
    if (char.skins.length === 0) throw new Error(`character ${char.id} has no skin`);
    // Random skin too, when more than one is available.
    const skin = char.skins[Math.floor(Math.random() * char.skins.length)]!;
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
