import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
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

    await this.prisma.match.update({
      where: { id: body.matchId },
      data: {
        status: 'FINISHED',
        finishedAt: new Date(),
        winnerId: body.winnerId,
        durationMs: body.durationMs,
        replayUrl: body.replayPath ?? null,
        meta: { reason: body.reason, score: body.score },
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
    // Drop any leftover lobby:pending-match keys for both players. Their TTL
    // (300 s) outlives the match itself, and a stale key delivered to a
    // reconnecting lobby socket would dispatch the player into a dead match.
    await this.cleanupLobbyKeys(match.player1Id, match.player2Id);
    return { ok: true };
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
        meta: { reason: body.reason },
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
