import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.module';
import { LedgerService } from '../wallet/ledger.service';

const PROVIDER = process.env.PAYMENT_PROVIDER ?? 'mock';

const MIN_DEPOSIT = new Prisma.Decimal('0.01');
const MAX_DEPOSIT = new Prisma.Decimal('10000');
const MIN_WITHDRAWAL = new Prisma.Decimal('1');

/**
 * PaymentsService — gateway between user-facing /api/payments/* and the ledger.
 *
 * In M2 we ship a `mock` provider only:
 *   - deposit  → instantly COMPLETED + ledger DEPOSIT
 *   - withdraw → instantly COMPLETED + ledger WITHDRAWAL (after balance check)
 *
 * `betra` (or another real provider) plugs in here in M3+. The contract:
 *   - createDeposit() returns redirect URL + pending Payment row
 *   - webhook (separate controller) verifies signature → calls confirmDeposit()
 *   - confirmDeposit() writes the Ledger entry idempotently using payment.id
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async deposit(userId: number, amountUsd: string): Promise<{ paymentId: string; status: string; balance: string }> {
    const amount = this.parseAmount(amountUsd);
    if (amount.lt(MIN_DEPOSIT)) throw new BadRequestException(`min deposit is ${MIN_DEPOSIT}`);
    if (amount.gt(MAX_DEPOSIT)) throw new BadRequestException(`max deposit is ${MAX_DEPOSIT}`);

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        type: 'DEPOSIT',
        status: PROVIDER === 'mock' ? 'COMPLETED' : 'PENDING',
        amountUsd: amount,
        provider: PROVIDER,
        externalId: randomUUID(),
        finishedAt: PROVIDER === 'mock' ? new Date() : null,
      },
    });

    if (PROVIDER === 'mock') {
      await this.ledger.record({
        userId,
        amount,
        type: 'DEPOSIT',
        refType: 'payment',
        refId: payment.id,
        idempotencyKey: `payment:${payment.id}:deposit`,
      });
      this.log.log(`mock deposit ${payment.id} user=${userId} amount=${amount}`);
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      paymentId: payment.id,
      status: payment.status,
      balance: wallet?.balance.toString() ?? '0',
    };
  }

  async withdraw(userId: number, amountUsd: string): Promise<{ paymentId: string; status: string; balance: string }> {
    const amount = this.parseAmount(amountUsd);
    if (amount.lt(MIN_WITHDRAWAL)) throw new BadRequestException(`min withdrawal is ${MIN_WITHDRAWAL}`);

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException('wallet missing');
    const balance = new Prisma.Decimal(wallet.balance.toString());
    if (balance.lt(amount)) {
      throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', have: balance.toString(), need: amount.toString() });
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        type: 'WITHDRAWAL',
        status: PROVIDER === 'mock' ? 'COMPLETED' : 'PENDING',
        amountUsd: amount,
        provider: PROVIDER,
        externalId: randomUUID(),
        finishedAt: PROVIDER === 'mock' ? new Date() : null,
      },
    });

    if (PROVIDER === 'mock') {
      await this.ledger.record({
        userId,
        amount: amount.negated(),
        type: 'WITHDRAWAL',
        refType: 'payment',
        refId: payment.id,
        idempotencyKey: `payment:${payment.id}:withdraw`,
      });
      this.log.log(`mock withdraw ${payment.id} user=${userId} amount=${amount}`);
    }

    const after = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      paymentId: payment.id,
      status: payment.status,
      balance: after?.balance.toString() ?? '0',
    };
  }

  async list(userId: number, limit = 50) {
    const rows = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        amountUsd: p.amountUsd.toString(),
        provider: p.provider,
        createdAt: p.createdAt.toISOString(),
        finishedAt: p.finishedAt?.toISOString() ?? null,
      })),
    };
  }

  private parseAmount(input: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(input);
    } catch {
      throw new BadRequestException('invalid amount');
    }
    if (amount.isNaN() || !amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('amount must be positive');
    }
    // Clamp to 8 decimals to match schema.
    return amount.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  }
}
