import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.module';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: number) {
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!w) throw new NotFoundException('wallet not found');
    return {
      balance: w.balance.toString(),
      locked: w.locked.toString(),
      updatedAt: w.updatedAt.toISOString(),
    };
  }

  /** Recent ledger entries for this user (newest first). */
  async listLedger(userId: number, limit = 50) {
    const rows = await this.prisma.ledger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        amount: true,
        type: true,
        refType: true,
        refId: true,
        meta: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id.toString(),
        amount: r.amount.toString(),
        type: r.type,
        refType: r.refType,
        refId: r.refId,
        meta: r.meta,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
