import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only wallet view (M0).
   * Money mutations (deposit/withdraw/match-stake) are added in M2 via ledger.
   */
  async get(userId: number) {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!w) throw new NotFoundException('wallet not found');
    return {
      balance: w.balance.toString(),
      locked: w.locked.toString(),
      coins: w.coins,
      updatedAt: w.updatedAt.toISOString(),
    };
  }
}
