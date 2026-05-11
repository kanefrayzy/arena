import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { BOT_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { RedisService } from '../common/redis/redis.module';
import { LedgerService } from '../wallet/ledger.service';
import { HmacGuard } from './hmac.guard';

interface MatchStartBody {
  matchId: string;
}
interface MatchFinishBody {
  matchId: string;
  winnerId: number | null;
  reason: 'kill' | 'timeout' | 'disconnect' | 'draw';
  durationMs: number;
  score: Record<string, number>;
  replayPath?: string;
}
interface MatchAbortBody {
  matchId: string;
  reason: string;
}

/**
 * Internal endpoints called by game-server with HMAC signature.
 * Path is /internal/match/* — excluded from setGlobalPrefix('api').
 */
@Controller('internal/match')
@UseGuards(HmacGuard)
@SkipThrottle()
export class InternalMatchController {
  private readonly log = new Logger('InternalMatch');
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly redis: RedisService,
  ) {}

  @Post('start')
  async start(@Body() body: MatchStartBody): Promise<{ ok: true }> {
    if (!body.matchId) throw new BadRequestException('matchId required');
    await this.prisma.match.update({
      where: { id: body.matchId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    this.log.log(`match ${body.matchId} started`);
    return { ok: true };
  }

  @Post('finish')
  async finish(@Body() body: MatchFinishBody): Promise<{ ok: true }> {
    if (!body.matchId) throw new BadRequestException('matchId required');

    const match = await this.prisma.match.findUnique({ where: { id: body.matchId } });
    if (!match) throw new BadRequestException('match not found');

    // PRESERVE existing meta (bot flag, botUsername, casualFree, …) and just
    // tack the finish summary onto it. A previous version did
    // `meta: { reason, score }` which wiped `meta.bot` / `meta.botUsername`,
    // so the match-history endpoint then fell back to the literal username
    // "Bot" (because the override only triggers when `meta.bot` is truthy).
    const prevMeta = (match.meta && typeof match.meta === 'object' && !Array.isArray(match.meta))
      ? (match.meta as Record<string, unknown>)
      : {};
    const mergedMeta = { ...prevMeta, reason: body.reason, score: body.score };

    await this.prisma.match.update({
      where: { id: body.matchId },
      data: {
        status: 'FINISHED',
        finishedAt: new Date(),
        winnerId: body.winnerId,
        durationMs: body.durationMs,
        replayUrl: body.replayPath ?? null,
        meta: mergedMeta as Prisma.InputJsonValue,
      },
    });

    // ── Money settlement ──
    const stake = new Prisma.Decimal(match.stakeUsd.toString());
    const isBotMatch = match.player1Id === BOT_USER_ID || match.player2Id === BOT_USER_ID;

    if (!isBotMatch && stake.gt(0)) {
      const room = await this.prisma.room.findUnique({ where: { id: match.roomId } });
      const commissionPct = room?.commissionPct ?? 0;

      // Always unlock first (refund both sides their locked stake).
      await this.ledger.unlockStake(body.matchId, match.player1Id, stake);
      await this.ledger.unlockStake(body.matchId, match.player2Id, stake);

      if (body.winnerId && (body.winnerId === match.player1Id || body.winnerId === match.player2Id)) {
        const loserId = body.winnerId === match.player1Id ? match.player2Id : match.player1Id;
        await this.ledger.settleMatch({
          matchId: body.matchId,
          winnerId: body.winnerId,
          loserId,
          stake,
          commissionPct,
        });
      } else {
        await this.ledger.settleDraw(body.matchId);
      }

      const inv = await this.ledger.verifyInvariant(body.matchId);
      if (!inv.ok) {
        this.log.error(`INVARIANT VIOLATION match ${body.matchId}: sum=${inv.sum}`);
      }
    }

    this.log.log(`match ${body.matchId} finished (winner=${body.winnerId}, reason=${body.reason})`);
    // Update per-user stats and cup ranking (skip bots).
    await this.updateStatsAndCup(match, body.winnerId, isBotMatch).catch((e) =>
      this.log.error(`updateStatsAndCup failed: ${(e as Error).message}`),
    );
    // Drop any leftover lobby:pending-match keys for both players. Their TTL
    // (300 s) outlives the match itself, and a stale key delivered to a
    // reconnecting lobby socket would dispatch the player into a dead match.
    await this.cleanupLobbyKeys(match.player1Id, match.player2Id);
    return { ok: true };
  }

  /** Increment matchesPlayed/wins/losses/draws and apply cup delta from settings.
   *  Cup is clamped to 0 (never negative). The bot user is skipped, but the
   *  human in a bot match still receives a cup delta and stat increment. */
  private async updateStatsAndCup(
    match: { player1Id: number; player2Id: number },
    winnerId: number | null,
    _isBotMatch: boolean,
  ): Promise<void> {
    const [winSetting, lossSetting] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: 'gameplay.cup_win' } }),
      this.prisma.setting.findUnique({ where: { key: 'gameplay.cup_loss' } }),
    ]);
    const cupWin = readPositiveInt(winSetting?.value, 25);
    const cupLoss = readPositiveInt(lossSetting?.value, 15);

    // Filter out the bot user — never write stats/cup for it.
    const humanIds = [match.player1Id, match.player2Id].filter((id) => id !== BOT_USER_ID);
    if (humanIds.length === 0) return;

    for (const userId of humanIds) {
      await this.prisma.userStats.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
    }

    if (winnerId == null) {
      // Draw — both +1 draw, no cup change.
      await this.prisma.userStats.updateMany({
        where: { userId: { in: humanIds } },
        data: { matchesPlayed: { increment: 1 }, draws: { increment: 1 } },
      });
      return;
    }

    if (winnerId !== BOT_USER_ID && humanIds.includes(winnerId)) {
      await this.prisma.userStats.update({
        where: { userId: winnerId },
        data: {
          matchesPlayed: { increment: 1 },
          wins: { increment: 1 },
          cup: { increment: cupWin },
        },
      });
    }

    const loserId = winnerId === match.player1Id ? match.player2Id : match.player1Id;
    if (loserId !== BOT_USER_ID && humanIds.includes(loserId)) {
      const loser = await this.prisma.userStats.findUnique({ where: { userId: loserId } });
      const newCup = Math.max(0, (loser?.cup ?? 0) - cupLoss);
      await this.prisma.userStats.update({
        where: { userId: loserId },
        data: {
          matchesPlayed: { increment: 1 },
          losses: { increment: 1 },
          cup: newCup,
        },
      });
    }
  }

  @Post('abort')
  async abort(@Body() body: MatchAbortBody): Promise<{ ok: true }> {
    if (!body.matchId) throw new BadRequestException('matchId required');

    const match = await this.prisma.match.findUnique({ where: { id: body.matchId } });

    await this.prisma.match.update({
      where: { id: body.matchId },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        meta: ((): Prisma.InputJsonValue => {
          const prev = (match?.meta && typeof match.meta === 'object' && !Array.isArray(match.meta))
            ? (match.meta as Record<string, unknown>)
            : {};
          return { ...prev, reason: body.reason } as Prisma.InputJsonValue;
        })(),
      },
    });

    // Full refund on abort.
    if (match) {
      const stake = new Prisma.Decimal(match.stakeUsd.toString());
      const isBotMatch = match.player1Id === BOT_USER_ID || match.player2Id === BOT_USER_ID;
      if (!isBotMatch && stake.gt(0)) {
        await this.ledger.unlockStake(body.matchId, match.player1Id, stake);
        await this.ledger.unlockStake(body.matchId, match.player2Id, stake);
        await this.ledger.settleCancel(body.matchId);
      }
    }

    this.log.warn(`match ${body.matchId} aborted: ${body.reason}`);
    if (match) {
      await this.cleanupLobbyKeys(match.player1Id, match.player2Id);
    }
    return { ok: true };
  }

  /** Best-effort cleanup of lobby:pending-match keys for both participants. */
  private async cleanupLobbyKeys(p1: number, p2: number): Promise<void> {
    try {
      await Promise.all([
        this.redis.client.del(`lobby:pending-match:${p1}`),
        this.redis.client.del(`lobby:pending-match:${p2}`),
      ]);
    } catch (e) {
      this.log.warn(`cleanupLobbyKeys failed: ${(e as Error).message}`);
    }
  }
}

function readPositiveInt(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return fallback;
}
