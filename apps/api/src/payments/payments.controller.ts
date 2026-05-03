import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

const amountSchema = z.object({
  amountUsd: z.string().regex(/^\d+(\.\d+)?$/, 'must be a positive decimal string'),
});
type AmountInput = z.infer<typeof amountSchema>;

interface AuthedRequest extends Request {
  user: { sub: number };
}

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('deposit')
  @HttpCode(200)
  async deposit(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(amountSchema)) body: AmountInput) {
    return this.payments.deposit(req.user.sub, body.amountUsd);
  }

  @Post('withdraw')
  @HttpCode(200)
  async withdraw(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(amountSchema)) body: AmountInput) {
    return this.payments.withdraw(req.user.sub, body.amountUsd);
  }

  @Get('me')
  async list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    return this.payments.list(req.user.sub, Number(limit ?? 50));
  }
}
