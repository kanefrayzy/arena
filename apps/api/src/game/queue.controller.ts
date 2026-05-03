import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { queueJoinSchema, type QueueJoinInput } from '@arena/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../common/prisma/prisma.module';
import { QueueService } from './queue.service';

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller('queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('join')
  @HttpCode(200)
  async join(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(queueJoinSchema)) body: QueueJoinInput,
  ): Promise<{ ok: true }> {
    // Balance check for paid modes — actual lock happens at match creation.
    if (body.mode !== 'free') {
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
    await this.queue.join(req.user.sub, body.mode, body.roomId);
    return { ok: true };
  }

  @Post('leave')
  @HttpCode(200)
  async leave(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    await this.queue.leave(req.user.sub);
    return { ok: true };
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
