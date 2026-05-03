import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}
