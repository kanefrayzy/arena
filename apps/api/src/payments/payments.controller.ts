import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PaymentsService } from './payments.service';

const amountRe = /^\d+(\.\d{1,8})?$/;

const depositSchema = z.object({
  method: z.string().min(1).max(50),
  amount: z.string().regex(amountRe),
  email: z.string().email().optional(),
});
type DepositInput = z.infer<typeof depositSchema>;

const withdrawSchema = z.object({
  method: z.string().min(1).max(50),
  amount: z.string().regex(amountRe),
  card: z.string().min(8).max(40).optional(),
  address: z.string().min(8).max(200).optional(),
  destTag: z.string().max(50).optional(),
  receiverName: z.string().max(100).optional(),
  receiverPhone: z.string().max(30).optional(),
});
type WithdrawInput = z.infer<typeof withdrawSchema>;

const cryptoAddrSchema = z.object({
  currency: z.string().min(2).max(20),
});
type CryptoAddrInput = z.infer<typeof cryptoAddrSchema>;

interface AuthedRequest extends Request {
  user: { sub: number };
}

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('methods')
  async methods() {
    return { items: await this.payments.listMethods() };
  }

  @Post('deposit')
  @HttpCode(200)
  async deposit(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(depositSchema)) body: DepositInput) {
    return this.payments.deposit(req.user.sub, body.method, body.amount, { email: body.email });
  }

  @Post('withdraw')
  @HttpCode(200)
  async withdraw(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(withdrawSchema)) body: WithdrawInput) {
    return this.payments.withdraw(req.user.sub, body.method, body.amount, {
      card: body.card,
      address: body.address,
      destTag: body.destTag,
      receiverName: body.receiverName,
      receiverPhone: body.receiverPhone,
    });
  }

  @Post('crypto-address')
  @HttpCode(200)
  async cryptoAddress(@Req() req: AuthedRequest, @Body(new ZodValidationPipe(cryptoAddrSchema)) body: CryptoAddrInput) {
    const r = await this.payments.ensureCryptoAddress(req.user.sub, body.currency);
    return { address: r.address, destTag: r.destTag, currency: r.currency };
  }

  @Get('me')
  async list(@Req() req: AuthedRequest, @Query('limit') limit?: string) {
    return this.payments.list(req.user.sub, Number(limit ?? 50));
  }
}
