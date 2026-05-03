import { Injectable, Logger } from '@nestjs/common';
import type { Room } from '@prisma/client';
import { BOT_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { RedisService } from '../common/redis/redis.module';
import { MatchTokenService } from './match-token.service';

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
  ) {}

  async createMatch(input: CreateMatchInput): Promise<{ matchId: string }> {
    const meta: Record<string, unknown> = {};
    if (input.isBotMatch) meta.bot = true;

    // Pick a default character/skin for M1 (single character).
    const character = await this.prisma.character.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      include: { skins: { orderBy: { id: 'asc' }, take: 1 } },
    });
    if (!character) throw new Error('no active character');
    const charId = character.id;
    const skinId = character.skins[0]?.id ?? 0;

    const match = await this.prisma.match.create({
      data: {
        roomId: input.room.id,
        stakeUsd: input.room.stakeUsd ?? 0,
        player1Id: input.player1Id,
        player2Id: input.player2Id,
        player1CharId: charId,
        player1SkinId: skinId,
        player2CharId: charId,
        player2SkinId: skinId,
        status: 'PENDING',
        meta,
      },
    });

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
    const seed = {
      matchId: match.id,
      mode: input.room.mode,
      roomId: input.room.id,
      stakeUsd: input.room.stakeUsd ? String(input.room.stakeUsd) : undefined,
      tickRate,
      durationMs: 90_000,
      isBotMatch: !!input.isBotMatch,
      player1: {
        userId: player1.id,
        username: player1.username,
        characterId: 1,
        skinId: 1,
      },
      player2: {
        userId: player2.id,
        username: player2.username,
        characterId: 1,
        skinId: 1,
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
      await this.redis.client.publish(MATCH_FOUND_CHANNEL, JSON.stringify(ev));
    }

    this.log.log(
      `match ${match.id} created (${input.player1Id} vs ${input.player2Id}, room=${input.room.id})`,
    );
    return { matchId: match.id };
  }
}
