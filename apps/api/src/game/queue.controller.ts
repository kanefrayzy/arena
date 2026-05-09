import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { queueJoinSchema, type QueueJoinInput } from '@arena/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../common/prisma/prisma.module';
import { RedisService } from '../common/redis/redis.module';
import { QueueService } from './queue.service';
import { MatchTokenService } from './match-token.service';

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller('queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: MatchTokenService,
  ) {}

  @Post('join')
  @HttpCode(200)
  async join(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(queueJoinSchema)) body: QueueJoinInput,
  ): Promise<{ ok: true }> {
    // Balance check for paid modes — actual lock happens at match creation.
    if (body.mode !== 'free') {
      // Casual: if rooms.casualEnabled=true, treat as free (no stake required)
      if (body.mode === 'casual') {
        const setting = await this.prisma.setting.findUnique({ where: { key: 'rooms.casualEnabled' } });
        const casualFree = setting && (setting.value === true || (setting.value as unknown) === 'true');
        if (!casualFree) {
          // Casual rooms always required a stake in this case; fall through to balance check
          const stake = await this.computeRequiredStake('casual', body.roomId);
          if (stake.gt(0)) {
            const wallet = await this.prisma.wallet.findUnique({ where: { userId: req.user.sub } });
            if (!wallet) throw new BadRequestException('wallet missing');
            const balance = new Prisma.Decimal(wallet.balance.toString());
            if (balance.lessThan(stake)) {
              throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', required: stake.toString(), have: balance.toString() });
            }
          }
        }
        // casualFree=true → no balance check
      } else {
        const stake = await this.computeRequiredStake(body.mode, body.roomId);
        if (stake.gt(0)) {
          const wallet = await this.prisma.wallet.findUnique({ where: { userId: req.user.sub } });
          if (!wallet) throw new BadRequestException('wallet missing');
          const balance = new Prisma.Decimal(wallet.balance.toString());
          if (balance.lessThan(stake)) {
            throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', required: stake.toString(), have: balance.toString() });
          }
        }
      }
    }
    await this.queue.join(req.user.sub, body.mode, body.roomId);
    return { ok: true };
  }

  @Post('leave')
  @HttpCode(200)
  async leave(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    await this.queue.leave(req.user.sub);
    return { ok: true };
  }

  /**
   * HTTP fallback for the lobby WebSocket. The web client polls this when the
   * WS goes silent, so a player is never stranded on the queue page when their
   * `match:found` push was lost (Redis pub/sub flake, lobby socket flap, etc.).
   * Mirrors the recovery cascade in LobbyGateway.recoverActiveMatch.
   */
  @Get('status')
  async status(@Req() req: AuthedRequest): Promise<{
    inQueue: boolean;
    mode?: string;
    roomId?: number;
    waitMs?: number;
    activeMatch?: {
      matchId: string;
      matchToken: string;
      gameWsUrl: string;
      opponent: { id: number; username: string };
      room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
    };
  }> {
    const userId = req.user.sub;

    // 1. Pending match in Redis (fresh, normally consumed by lobby ws).
    const pendingRaw = await this.redis.client.get(`lobby:pending-match:${userId}`);
    if (pendingRaw) {
      try {
        const ev = JSON.parse(pendingRaw) as {
          matchId: string;
          matchToken: string;
          gameWsUrl: string;
          opponent: { id: number; username: string };
          room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
        };
        return {
          inQueue: false,
          activeMatch: {
            matchId: ev.matchId,
            matchToken: ev.matchToken,
            gameWsUrl: ev.gameWsUrl,
            opponent: ev.opponent,
            room: ev.room,
          },
        };
      } catch {
        /* fall through */
      }
    }

    // 2. DB-backed lookup for any active match (PENDING/RUNNING) with live seed.
    const match = await this.prisma.match.findFirst({
      where: {
        OR: [{ player1Id: userId }, { player2Id: userId }],
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { id: 'desc' },
      include: {
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
        room: { select: { id: true, mode: true, stakeUsd: true } },
      },
    });
    if (match) {
      const seedExists = await this.redis.client.exists(`match:seed:${match.id}`);
      if (seedExists) {
        const opponent = match.player1Id === userId ? match.player2 : match.player1;
        const gameWsUrl = process.env.GAME_PUBLIC_WS_URL ?? 'ws://localhost/ws/match';
        return {
          inQueue: false,
          activeMatch: {
            matchId: match.id,
            matchToken: this.tokens.sign({ matchId: match.id, userId }),
            gameWsUrl,
            opponent: { id: opponent.id, username: opponent.username },
            room: {
              id: match.room.id,
              mode: match.room.mode,
              ...(match.room.stakeUsd ? { stakeUsd: String(match.room.stakeUsd) } : {}),
            },
          },
        };
      }
    }

    // 3. In queue?
    const state = await this.queue.getState(userId);
    if (state) {
      return {
        inQueue: true,
        mode: state.mode,
        ...(state.roomId ? { roomId: state.roomId } : {}),
        waitMs: Date.now() - state.joinedAt,
      };
    }

    return { inQueue: false };
  }

  private async computeRequiredStake(mode: 'casual' | 'stake', roomId?: number): Promise<Prisma.Decimal> {
    if (mode === 'stake' && roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.stakeUsd) return new Prisma.Decimal(0);
      return new Prisma.Decimal(room.stakeUsd.toString());
    }
    if (mode === 'casual') {
      const room = await this.prisma.room.findFirst({
        where: { mode: 'CASUAL', isActive: true },
        orderBy: { id: 'asc' },
      });
      if (!room || !room.stakeUsd) return new Prisma.Decimal(0);
      return new Prisma.Decimal(room.stakeUsd.toString());
    }
    return new Prisma.Decimal(0);
  }
}
