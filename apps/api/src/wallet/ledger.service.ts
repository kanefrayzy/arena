import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';
import { SYSTEM_USER_ID } from '@arena/shared';

export type LedgerType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'MATCH_STAKE_LOCK'
  | 'MATCH_STAKE_UNLOCK'
  | 'MATCH_WIN'
  | 'MATCH_LOSS'
  | 'COMMISSION'
  | 'ADJUSTMENT'
  | 'BONUS'
  | 'SHOP_PURCHASE';

export interface LedgerEntryInput {
  userId: number;
  amount: Prisma.Decimal | string | number;
  type: LedgerType;
  refType?: string;
  refId?: string;
  idempotencyKey: string;
  meta?: Record<string, unknown>;
}

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * LedgerService — the only sanctioned way to mutate Wallet balances.
 *
 * Invariants (per match):
 *   Σ ledger.amount = 0 across all entries with the same (refType='match', refId=matchId).
 *
 * Rules:
 *   - Every write is paired with a matching Wallet update inside the same transaction.
 *   - Idempotency: duplicate idempotencyKey ⇒ no-op (returns existing entry).
 *   - Balance/locked never goes negative (BadRequest on insufficient funds).
 *
 * Decimal note: we use Prisma.Decimal everywhere, never JS floats. Strings are
 * accepted as input (recommended) — server parses to Decimal.
 */
@Injectable()
export class LedgerService {
  private readonly log = new Logger('Ledger');
  constructor(private readonly prisma: PrismaService) {}

  /** Add a single ledger entry + apply wallet delta in one transaction. */
  async record(entry: LedgerEntryInput): Promise<void> {
    const { userId, type, idempotencyKey } = entry;
    const amount = new Prisma.Decimal(entry.amount as Prisma.Decimal.Value);

    await this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const dup = await tx.ledger.findUnique({ where: { idempotencyKey } });
      if (dup) {
        this.log.debug(`idempotent skip ${idempotencyKey} (${type})`);
        return;
      }

      // Apply wallet delta. amount > 0 → balance += amount; amount < 0 → balance -= |amount| (must have funds).
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException(`wallet missing for user ${userId}`);

      const newBalance = new Prisma.Decimal(wallet.balance.toString()).plus(amount);
      if (newBalance.isNegative()) {
        throw new BadRequestException(`insufficient balance for user ${userId}`);
      }

      await tx.wallet.update({
        where: { userId },
        data: { balance: newBalance },
      });

      await tx.ledger.create({
        data: {
          userId,
          amount,
          type,
          refType: entry.refType ?? null,
          refId: entry.refId ?? null,
          idempotencyKey,
          meta: (entry.meta as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
    });
  }

  /**
   * Lock a stake for a match: balance -= stake, locked += stake, ledger -= stake (MATCH_STAKE_LOCK).
   * Idempotent on (matchId, userId).
   */
  async lockStake(matchId: string, userId: number, stake: Prisma.Decimal | string): Promise<void> {
    const amount = new Prisma.Decimal(stake);
    if (amount.lte(0)) return; // nothing to lock for free matches
    const idempotencyKey = `match:${matchId}:lock:${userId}`;

    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.ledger.findUnique({ where: { idempotencyKey } });
      if (dup) return;

      const w = await tx.wallet.findUnique({ where: { userId } });
      if (!w) throw new BadRequestException(`wallet missing for user ${userId}`);

      const balance = new Prisma.Decimal(w.balance.toString());
      if (balance.lessThan(amount)) {
        throw new ConflictException('insufficient_balance');
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: balance.minus(amount),
          locked: new Prisma.Decimal(w.locked.toString()).plus(amount),
        },
      });
      await tx.ledger.create({
        data: {
          userId,
          amount: amount.negated(),
          type: 'MATCH_STAKE_LOCK',
          refType: 'match',
          refId: matchId,
          idempotencyKey,
        },
      });
    });
  }

  /**
   * Unlock a stake (refund into balance — for both winner and loser at match end,
   * or full refund on cancel/abort).
   * locked -= stake, balance += stake, ledger += stake (MATCH_STAKE_UNLOCK).
   */
  async unlockStake(matchId: string, userId: number, stake: Prisma.Decimal | string): Promise<void> {
    const amount = new Prisma.Decimal(stake);
    if (amount.lte(0)) return;
    const idempotencyKey = `match:${matchId}:unlock:${userId}`;

    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.ledger.findUnique({ where: { idempotencyKey } });
      if (dup) return;

      const w = await tx.wallet.findUnique({ where: { userId } });
      if (!w) throw new BadRequestException(`wallet missing for user ${userId}`);

      const locked = new Prisma.Decimal(w.locked.toString());
      // Tolerate over-unlock (shouldn't happen, but don't go negative).
      const refund = locked.lessThan(amount) ? locked : amount;

      await tx.wallet.update({
        where: { userId },
        data: {
          balance: new Prisma.Decimal(w.balance.toString()).plus(refund),
          locked: locked.minus(refund),
        },
      });
      await tx.ledger.create({
        data: {
          userId,
          amount: refund,
          type: 'MATCH_STAKE_UNLOCK',
          refType: 'match',
          refId: matchId,
          idempotencyKey,
        },
      });
    });
  }

  /**
   * Match settlement (KILL/TIMEOUT_HP):
   *   pool = stake * 2
   *   commission = pool * commissionPct / 100  (rounded to 8 decimals)
   *   prize = pool - commission
   *
   * After unlocks (already done), we transfer:
   *   loser  -> system: stake          (MATCH_LOSS for loser)
   *   loser  -> winner: stake - share  (already on winner via prize - stake net)
   *
   * Actual ledger entries written here:
   *   winner: +(prize − stake)  (MATCH_WIN)
   *   loser : −stake            (MATCH_LOSS)
   *   system: +commission       (COMMISSION)
   *
   * Combined with two MATCH_STAKE_LOCK (-stake each) and two MATCH_STAKE_UNLOCK (+stake each)
   * the per-match sum is exactly 0.
   */
  async settleMatch(opts: {
    matchId: string;
    winnerId: number;
    loserId: number;
    stake: Prisma.Decimal | string;
    commissionPct: number;
  }): Promise<void> {
    const stake = new Prisma.Decimal(opts.stake);
    if (stake.lte(0)) return; // free / casual no-stake — nothing to settle

    const pool = stake.mul(2);
    const commission = pool.mul(opts.commissionPct).div(100).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    const prize = pool.minus(commission);
    const winnerNet = prize.minus(stake); // what winner actually gains over their unlocked stake

    const winnerKey = `match:${opts.matchId}:win:${opts.winnerId}`;
    const loserKey = `match:${opts.matchId}:loss:${opts.loserId}`;
    const sysKey = `match:${opts.matchId}:commission`;

    await this.prisma.$transaction(async (tx) => {
      const present = await tx.ledger.findMany({
        where: { idempotencyKey: { in: [winnerKey, loserKey, sysKey] } },
        select: { idempotencyKey: true },
      });
      const have = new Set(present.map((p) => p.idempotencyKey));

      if (!have.has(winnerKey) && winnerNet.gt(0)) {
        await this.applyDelta(tx, opts.winnerId, winnerNet);
        await tx.ledger.create({
          data: {
            userId: opts.winnerId,
            amount: winnerNet,
            type: 'MATCH_WIN',
            refType: 'match',
            refId: opts.matchId,
            idempotencyKey: winnerKey,
            meta: { commission: commission.toString(), prize: prize.toString() },
          },
        });
      }

      if (!have.has(loserKey)) {
        await this.applyDelta(tx, opts.loserId, stake.negated());
        await tx.ledger.create({
          data: {
            userId: opts.loserId,
            amount: stake.negated(),
            type: 'MATCH_LOSS',
            refType: 'match',
            refId: opts.matchId,
            idempotencyKey: loserKey,
          },
        });
      }

      if (!have.has(sysKey) && commission.gt(0)) {
        await this.applyDelta(tx, SYSTEM_USER_ID, commission);
        await tx.ledger.create({
          data: {
            userId: SYSTEM_USER_ID,
            amount: commission,
            type: 'COMMISSION',
            refType: 'match',
            refId: opts.matchId,
            idempotencyKey: sysKey,
          },
        });
      }
    });

    this.log.log(
      `match ${opts.matchId} settled: winner=${opts.winnerId} (+${winnerNet}), loser=${opts.loserId} (−${stake}), commission=${commission}`,
    );
  }

  /** Draw / disconnect: full refund — both players already got MATCH_STAKE_UNLOCK. No further entries. */
  async settleDraw(matchId: string): Promise<void> {
    this.log.log(`match ${matchId} draw — only unlocks recorded (sum=0)`);
  }

  /** Cancellation before start: just unlock; settled here means we do nothing extra. */
  async settleCancel(matchId: string): Promise<void> {
    this.log.log(`match ${matchId} cancelled — only unlocks recorded`);
  }

  /** Verify Σ amount = 0 for a match. Used by tests and admin tools. */
  async verifyInvariant(matchId: string): Promise<{ ok: boolean; sum: string; entries: number }> {
    const rows = await this.prisma.ledger.findMany({
      where: { refType: 'match', refId: matchId },
      select: { amount: true },
    });
    const sum = rows.reduce(
      (acc, r) => acc.plus(new Prisma.Decimal(r.amount.toString())),
      new Prisma.Decimal(0),
    );
    return { ok: sum.isZero(), sum: sum.toString(), entries: rows.length };
  }

  private async applyDelta(tx: Tx, userId: number, delta: Prisma.Decimal): Promise<void> {
    const w = await tx.wallet.findUnique({ where: { userId } });
    if (!w) throw new BadRequestException(`wallet missing for user ${userId}`);
    const next = new Prisma.Decimal(w.balance.toString()).plus(delta);
    if (next.isNegative()) {
      throw new BadRequestException(`insufficient balance for user ${userId}`);
    }
    await tx.wallet.update({ where: { userId }, data: { balance: next } });
  }
}
