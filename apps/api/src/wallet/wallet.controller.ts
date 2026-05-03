import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WalletService } from './wallet.service';

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  async get(@Req() req: Request) {
    const userId = (req as Request & { user?: { sub: number } }).user?.sub as number;
    return this.wallet.get(userId);
  }

  @Get('ledger')
  async ledger(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = (req as Request & { user?: { sub: number } }).user?.sub as number;
    const lim = Math.min(100, Math.max(1, Number(limit ?? 50)));
    return this.wallet.listLedger(userId, lim);
  }
}
