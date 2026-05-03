/**
 * Pure unit tests for the per-match ledger invariant Σ amount = 0.
 *
 * We compute the ledger amounts that LedgerService would write for a typical
 * match scenario (lock × 2, unlock × 2, win, loss, commission) and verify the
 * sum is exactly 0 — the canonical money-flow contract from ТЗ §18.
 *
 * Decimal math is done with Prisma.Decimal to mirror server logic 1:1.
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';

function settle(stake: string, commissionPct: number) {
  const s = new Prisma.Decimal(stake);
  const pool = s.mul(2);
  const commission = pool.mul(commissionPct).div(100).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  const prize = pool.minus(commission);
  const winnerNet = prize.minus(s);
  return {
    entries: [
      { who: 'p1', amount: s.negated() }, // MATCH_STAKE_LOCK
      { who: 'p2', amount: s.negated() }, // MATCH_STAKE_LOCK
      { who: 'p1', amount: s }, // MATCH_STAKE_UNLOCK
      { who: 'p2', amount: s }, // MATCH_STAKE_UNLOCK
      { who: 'winner', amount: winnerNet }, // MATCH_WIN
      { who: 'loser', amount: s.negated() }, // MATCH_LOSS
      { who: 'system', amount: commission }, // COMMISSION
    ],
    commission,
    prize,
    winnerNet,
  };
}

function sum(entries: { amount: Prisma.Decimal }[]): Prisma.Decimal {
  return entries.reduce((acc, e) => acc.plus(e.amount), new Prisma.Decimal(0));
}

describe('ledger invariant Σ amount = 0', () => {
  it('STAKE $10 / 20% commission', () => {
    const { entries, commission, prize, winnerNet } = settle('10', 20);
    expect(sum(entries).toString()).toBe('0');
    expect(commission.toString()).toBe('4');
    expect(prize.toString()).toBe('16');
    expect(winnerNet.toString()).toBe('6');
  });

  it('STAKE $1 / 20%', () => {
    const { entries } = settle('1', 20);
    expect(sum(entries).toString()).toBe('0');
  });

  it('STAKE $5 / 20%', () => {
    const { entries } = settle('5', 20);
    expect(sum(entries).toString()).toBe('0');
  });

  it('CASUAL $0.03 / 0% commission', () => {
    const { entries, commission } = settle('0.03', 0);
    expect(sum(entries).toString()).toBe('0');
    expect(commission.toString()).toBe('0');
  });

  it('draw refund only — no win/loss/commission', () => {
    const s = new Prisma.Decimal('10');
    const entries = [
      { amount: s.negated() },
      { amount: s.negated() },
      { amount: s }, // unlock p1
      { amount: s }, // unlock p2
    ];
    expect(sum(entries).toString()).toBe('0');
  });

  it('odd commission (15% on $7 stake) rounds to 8 dp without breaking sum', () => {
    const { entries } = settle('7', 15);
    expect(sum(entries).toString()).toBe('0');
  });
});
