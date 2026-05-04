import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { WestwalletService } from './westwallet.service';

interface RawRequest extends Request { rawBody?: Buffer }

/**
 * Public webhook endpoints — mounted under /internal/payments/* so they bypass /api prefix.
 * No auth: providers authenticate via signed payloads or IP allowlist.
 */
@Controller('internal/payments')
export class PaymentWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly west: WestwalletService,
  ) {}

  @Post('betra/deposit-callback')
  @HttpCode(200)
  async betraDeposit(@Body() body: any) {
    return this.payments.handleBetraDepositCallback(body);
  }

  @Post('betra/payout-callback')
  @HttpCode(200)
  async betraPayout(
    @Body() body: any,
    @Headers('x-signature') sig: string | undefined,
    @Req() req: RawRequest,
  ) {
    return this.payments.handleBetraPayoutCallback(body, sig, req.rawBody);
  }

  @Post('westwallet/deposit-ipn')
  @HttpCode(200)
  async westDeposit(@Body() body: any, @Ip() ip: string) {
    if (!this.west.isIpAllowed(ip)) return { ok: true };
    return this.payments.handleWestDepositIpn(body);
  }

  @Post('westwallet/payout-ipn')
  @HttpCode(200)
  async westPayout(
    @Body() body: any,
    @Query('paymentId') paymentId: string,
    @Ip() ip: string,
  ) {
    if (!this.west.isIpAllowed(ip)) return { ok: true };
    if (!paymentId) return { ok: true };
    return this.payments.handleWestPayoutIpn(paymentId, body);
  }
}
