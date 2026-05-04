import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.module';
import { LedgerService } from '../wallet/ledger.service';
import { BetraService, BetraDepositReqs } from './betra.service';
import { WestwalletService } from './westwallet.service';

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? 'http://localhost').replace(/\/$/, '');

const MIN_DEPOSIT_USD = new Prisma.Decimal('0.01');
const MAX_DEPOSIT_USD = new Prisma.Decimal('100000');
const MIN_WITHDRAW_USD = new Prisma.Decimal('1');

interface DepositResult {
  paymentId: string;
  status: string;
  betra?: BetraDepositReqs;
  crypto?: { address: string; destTag?: string; currency: string };
}

interface WithdrawResult {
  paymentId: string;
  status: string;
  balance: string;
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly betra: BetraService,
    private readonly west: WestwalletService,
  ) {}

  async listMethods() {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((m) => ({
      slug: m.slug,
      label: m.label,
      kind: m.kind,
      currency: m.currency,
      iconUrl: m.iconUrl,
      minAmount: m.minAmount?.toString() ?? null,
      maxAmount: m.maxAmount?.toString() ?? null,
      isDeposit: m.isDeposit,
      isWithdraw: m.isWithdraw,
    }));
  }

  async deposit(userId: number, methodSlug: string, amountRaw: string, opts?: { email?: string }): Promise<DepositResult> {
    const method = await this.prisma.paymentMethod.findUnique({ where: { slug: methodSlug } });
    if (!method || !method.isActive || !method.isDeposit) {
      throw new BadRequestException({ code: 'METHOD_NOT_AVAILABLE' });
    }
    const amount = this.parseAmount(amountRaw);
    if (method.minAmount && amount.lt(new Prisma.Decimal(method.minAmount.toString()))) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_LOW', min: method.minAmount.toString() });
    }
    if (method.maxAmount && amount.gt(new Prisma.Decimal(method.maxAmount.toString()))) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_HIGH', max: method.maxAmount.toString() });
    }
    const usdAmount = this.toUsd(amount, method.usdRate);
    if (usdAmount.lt(MIN_DEPOSIT_USD)) throw new BadRequestException({ code: 'AMOUNT_TOO_LOW' });
    if (usdAmount.gt(MAX_DEPOSIT_USD)) throw new BadRequestException({ code: 'AMOUNT_TOO_HIGH' });

    const orderId = randomUUID();

    if (method.kind === 'betra_card') {
      const callbackUrl = `${PUBLIC_BASE_URL}/internal/payments/betra/deposit-callback`;
      const payment = await this.prisma.payment.create({
        data: {
          id: orderId, userId, type: 'DEPOSIT', status: 'PENDING',
          amountUsd: usdAmount, amountRaw: amount, currency: method.currency,
          provider: 'betra', methodSlug: method.slug,
        },
      });
      try {
        const reqs = await this.betra.createDeposit({
          orderId, amount: amount.toFixed(2), currency: method.currency, callbackUrl,
          userId, email: opts?.email,
        });
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { externalId: String(reqs.id), status: this.mapBetraDepositStatus(reqs.status), meta: { betra: reqs as unknown as Prisma.InputJsonValue } },
        });
        return { paymentId: payment.id, status: reqs.status, betra: reqs };
      } catch (err) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', meta: { error: String((err as Error).message) } as Prisma.InputJsonValue } });
        throw err;
      }
    }

    if (method.kind === 'westwallet') {
      const addr = await this.ensureCryptoAddress(userId, method.currency);
      const payment = await this.prisma.payment.create({
        data: {
          id: orderId, userId, type: 'DEPOSIT', status: 'PENDING',
          amountUsd: usdAmount, amountRaw: amount, currency: method.currency,
          provider: 'westwallet', methodSlug: method.slug,
          meta: { address: addr.address } as Prisma.InputJsonValue,
        },
      });
      return { paymentId: payment.id, status: 'AWAITING', crypto: { address: addr.address, destTag: addr.destTag ?? undefined, currency: method.currency } };
    }

    throw new BadRequestException({ code: 'UNSUPPORTED_DEPOSIT_KIND' });
  }

  async withdraw(userId: number, methodSlug: string, amountRaw: string, opts: { card?: string; address?: string; destTag?: string; receiverName?: string; receiverPhone?: string }): Promise<WithdrawResult> {
    const method = await this.prisma.paymentMethod.findUnique({ where: { slug: methodSlug } });
    if (!method || !method.isActive || !method.isWithdraw) {
      throw new BadRequestException({ code: 'METHOD_NOT_AVAILABLE' });
    }
    const amount = this.parseAmount(amountRaw);
    if (method.minAmount && amount.lt(new Prisma.Decimal(method.minAmount.toString()))) {
      throw new BadRequestException({ code: 'AMOUNT_TOO_LOW', min: method.minAmount.toString() });
    }
    const usdAmount = this.toUsd(amount, method.usdRate);
    if (usdAmount.lt(MIN_WITHDRAW_USD)) throw new BadRequestException({ code: 'AMOUNT_TOO_LOW' });

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new BadRequestException({ code: 'WALLET_MISSING' });
    const balance = new Prisma.Decimal(wallet.balance.toString());
    if (balance.lt(usdAmount)) {
      throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', have: balance.toString(), need: usdAmount.toString() });
    }

    const orderId = randomUUID();
    const payoutMode = (method as any).payoutMode ?? 'manual';

    if (method.kind === 'betra_payout') {
      if (!opts.card) throw new BadRequestException({ code: 'CARD_REQUIRED' });
      const callbackUrl = `${PUBLIC_BASE_URL}/internal/payments/betra/payout-callback`;
      const payment = await this.prisma.payment.create({
        data: {
          id: orderId, userId, type: 'WITHDRAWAL', status: 'PENDING',
          amountUsd: usdAmount, amountRaw: amount, currency: method.currency,
          provider: 'betra', methodSlug: method.slug,
        },
      });
      await this.ledger.record({
        userId, amount: usdAmount.negated(), type: 'WITHDRAWAL',
        refType: 'payment', refId: payment.id, idempotencyKey: `payment:${payment.id}:lock`,
      });
      // instant: auto-submit to provider. manual/semi_auto: hold for admin approval.
      if (payoutMode === 'instant') {
        try {
          const r = await this.betra.createPayout({
            orderId, amount: amount.toFixed(2), currency: method.currency, card: opts.card,
            receiverName: opts.receiverName, receiverPhone: opts.receiverPhone, callbackUrl,
          });
          await this.prisma.payment.update({ where: { id: payment.id }, data: { externalId: String(r.id), status: this.mapBetraPayoutStatus(r.status) } });
        } catch (err) {
          await this.refund(payment.id, payment.userId, usdAmount, 'betra_payout_failed');
          throw err;
        }
      }
      const after = await this.prisma.wallet.findUnique({ where: { userId } });
      return { paymentId: payment.id, status: 'PENDING', balance: after?.balance.toString() ?? '0' };
    }

    if (method.kind === 'westwallet') {
      if (!opts.address) throw new BadRequestException({ code: 'ADDRESS_REQUIRED' });
      const payment = await this.prisma.payment.create({
        data: {
          id: orderId, userId, type: 'WITHDRAWAL', status: 'PENDING',
          amountUsd: usdAmount, amountRaw: amount, currency: method.currency,
          provider: 'westwallet', methodSlug: method.slug,
        },
      });
      await this.ledger.record({
        userId, amount: usdAmount.negated(), type: 'WITHDRAWAL',
        refType: 'payment', refId: payment.id, idempotencyKey: `payment:${payment.id}:lock`,
      });
      if (payoutMode === 'instant') {
        try {
          const r = await this.west.createWithdrawal({
            currency: method.currency, amount: amount.toFixed(8),
            address: opts.address, destTag: opts.destTag, description: payment.id,
            ipnUrl: `${PUBLIC_BASE_URL}/internal/payments/westwallet/payout-ipn?paymentId=${payment.id}`,
          });
          await this.prisma.payment.update({ where: { id: payment.id }, data: { externalId: String(r.id), status: r.status === 'completed' ? 'COMPLETED' : 'PENDING' } });
        } catch (err) {
          await this.refund(payment.id, payment.userId, usdAmount, 'west_withdraw_failed');
          throw err;
        }
      }
      const after = await this.prisma.wallet.findUnique({ where: { userId } });
      return { paymentId: payment.id, status: 'PENDING', balance: after?.balance.toString() ?? '0' };
    }

    throw new BadRequestException({ code: 'UNSUPPORTED_WITHDRAW_KIND' });
  }

  async ensureCryptoAddress(userId: number, currency: string): Promise<{ address: string; destTag?: string | null; currency: string; label: string }> {
    const existing = await this.prisma.cryptoAddress.findFirst({ where: { userId, currency, provider: 'westwallet' } });
    if (existing) return { address: existing.address, destTag: existing.destTag, currency, label: existing.label };

    const label = `u${userId}_${currency}`.slice(0, 30);
    const ipnUrl = `${PUBLIC_BASE_URL}/internal/payments/westwallet/deposit-ipn`;
    const r = await this.west.generateAddress({ currency, ipnUrl, label });
    const row = await this.prisma.cryptoAddress.create({
      data: { userId, currency, address: r.address, destTag: r.destTag, label, provider: 'westwallet' },
    });
    return { address: row.address, destTag: row.destTag, currency, label: row.label };
  }

  // Webhooks ------------------------------------------------------------

  async handleBetraDepositCallback(payload: any) {
    if (!this.betra.verifyDepositSignature(payload)) {
      throw new BadRequestException('invalid signature');
    }
    const orderId = String(payload.order_id);
    const status = String(payload.status);
    const payment = await this.prisma.payment.findUnique({ where: { id: orderId } });
    if (!payment || payment.type !== 'DEPOSIT' || payment.status === 'COMPLETED') return { ok: true };

    if (status === 'paid') {
      await this.ledger.record({
        userId: payment.userId,
        amount: new Prisma.Decimal(payment.amountUsd.toString()),
        type: 'DEPOSIT', refType: 'payment', refId: payment.id,
        idempotencyKey: `payment:${payment.id}:deposit`,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', finishedAt: new Date(), meta: { ...((payment.meta as any) ?? {}), webhook: payload } as Prisma.InputJsonValue },
      });
    } else if (['expired', 'cancelled', 'error'].includes(status)) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', finishedAt: new Date() } });
    }
    return { ok: true };
  }

  async handleBetraPayoutCallback(payload: any, signature: string | undefined, rawBody: Buffer | undefined) {
    if (!rawBody || !this.betra.verifyHeaderSignature(rawBody, signature)) {
      throw new BadRequestException('invalid signature');
    }
    const data = payload?.data ?? payload;
    const orderId = String(data.order_id);
    const status = String(data.status);
    const payment = await this.prisma.payment.findUnique({ where: { id: orderId } });
    if (!payment || payment.type !== 'WITHDRAWAL') return { ok: true };
    if (payment.status === 'COMPLETED' || payment.status === 'FAILED') return { ok: true };

    if (status === 'success') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED', finishedAt: new Date() } });
    } else if (['failed', 'cancelled'].includes(status)) {
      await this.refund(payment.id, payment.userId, new Prisma.Decimal(payment.amountUsd.toString()), `betra_payout_${status}`);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', finishedAt: new Date() } });
    }
    return { ok: true };
  }

  async handleWestDepositIpn(payload: any) {
    const id = payload?.id;
    if (!id) return { ok: true };
    const tx = await this.west.getTransaction(id);
    if (tx.status !== 'completed') return { ok: true };

    const label = String(payload.label ?? '');
    const addr = await this.prisma.cryptoAddress.findUnique({ where: { label } });
    if (!addr) return { ok: true };

    const idempotencyKey = `west:tx:${id}`;
    const existing = await this.prisma.ledger.findUnique({ where: { idempotencyKey } });
    if (existing) return { ok: true };

    const method = await this.prisma.paymentMethod.findFirst({ where: { kind: 'westwallet', currency: tx.currency, isActive: true } });
    const amountRaw = new Prisma.Decimal(String(tx.amount));
    const usdAmount = this.toUsd(amountRaw, method?.usdRate ?? null);

    const payment = await this.prisma.payment.create({
      data: {
        userId: addr.userId, type: 'DEPOSIT', status: 'COMPLETED',
        amountUsd: usdAmount, amountRaw, currency: tx.currency,
        provider: 'westwallet', methodSlug: method?.slug ?? null, externalId: String(id),
        finishedAt: new Date(),
        meta: { ipn: payload, tx: tx.raw } as Prisma.InputJsonValue,
      },
    });
    await this.ledger.record({
      userId: addr.userId, amount: usdAmount, type: 'DEPOSIT',
      refType: 'payment', refId: payment.id, idempotencyKey,
    });
    return { ok: true };
  }

  async handleWestPayoutIpn(paymentId: string, payload: any) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.type !== 'WITHDRAWAL') return { ok: true };
    if (payment.status === 'COMPLETED' || payment.status === 'FAILED') return { ok: true };

    const status = String(payload?.status ?? '');
    if (status === 'completed') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'COMPLETED', finishedAt: new Date() } });
    } else if (status === 'network_error') {
      await this.refund(payment.id, payment.userId, new Prisma.Decimal(payment.amountUsd.toString()), 'west_payout_failed');
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', finishedAt: new Date() } });
    }
    return { ok: true };
  }

  async list(userId: number, limit = 50) {
    const rows = await this.prisma.payment.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return {
      items: rows.map((p) => ({
        id: p.id, type: p.type, status: p.status,
        amountUsd: p.amountUsd.toString(), amountRaw: p.amountRaw?.toString() ?? null,
        currency: p.currency, provider: p.provider, methodSlug: p.methodSlug,
        createdAt: p.createdAt.toISOString(),
        finishedAt: p.finishedAt?.toISOString() ?? null,
      })),
    };
  }

  // Helpers ------------------------------------------------------------

  private async refund(paymentId: string, userId: number, amount: Prisma.Decimal, reason: string) {
    await this.ledger.record({
      userId, amount, type: 'ADJUSTMENT',
      refType: 'payment', refId: paymentId,
      idempotencyKey: `payment:${paymentId}:refund`,
      meta: { reason },
    });
  }

  private parseAmount(input: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try { amount = new Prisma.Decimal(input); }
    catch { throw new BadRequestException('invalid amount'); }
    if (amount.isNaN() || !amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('amount must be positive');
    }
    return amount.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  }

  private toUsd(amount: Prisma.Decimal, rate: Prisma.Decimal | null | undefined): Prisma.Decimal {
    if (!rate) return amount.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    return amount.mul(new Prisma.Decimal(rate.toString())).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
  }

  private mapBetraDepositStatus(s: string): string {
    if (s === 'paid') return 'COMPLETED';
    if (['expired', 'cancelled', 'error'].includes(s)) return 'FAILED';
    return 'PENDING';
  }
  private mapBetraPayoutStatus(s: string): string {
    if (s === 'success') return 'COMPLETED';
    if (['failed', 'cancelled'].includes(s)) return 'FAILED';
    return 'PENDING';
  }
}
