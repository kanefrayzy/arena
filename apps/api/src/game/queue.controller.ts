import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { queueJoinSchema, type QueueJoinInput } from '@arena/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { QueueService } from './queue.service';

interface AuthedRequest extends Request {
  user: { sub: number };
}

@Controller('queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Post('join')
  @HttpCode(200)
  async join(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(queueJoinSchema)) body: QueueJoinInput,
  ): Promise<{ ok: true }> {
    await this.queue.join(req.user.sub, body.mode, body.roomId);
    return { ok: true };
  }

  @Post('leave')
  @HttpCode(200)
  async leave(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    await this.queue.leave(req.user.sub);
    return { ok: true };
  }
}
