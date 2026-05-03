import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';
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
  constructor(private readonly prisma: PrismaService) {}

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
    this.log.log(`match ${body.matchId} finished (winner=${body.winnerId}, reason=${body.reason})`);
    return { ok: true };
  }

  @Post('abort')
  async abort(@Body() body: MatchAbortBody): Promise<{ ok: true }> {
    if (!body.matchId) throw new BadRequestException('matchId required');
    await this.prisma.match.update({
      where: { id: body.matchId },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        meta: { reason: body.reason },
      },
    });
    this.log.warn(`match ${body.matchId} aborted: ${body.reason}`);
    return { ok: true };
  }
}
