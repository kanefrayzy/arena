import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.module';

interface RatesPayload {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
}

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const REFRESH_MS = 60 * 60 * 1000; // 1 hour
// Always-on USD-pegged stablecoins. Provider data may be missing or noisy.
const USD_PEGGED = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD']);
// Last-resort fallback if DB is empty AND ER-API is unreachable on first boot.
const FALLBACK_RATES: Record<string, number> = {
  USD: 1, EUR: 0.92, GBP: 0.79, RUB: 95, UAH: 41, KZT: 470, BYN: 3.3, AZN: 1.7,
  TRY: 32, PLN: 4.0, CNY: 7.2, INR: 83, BRL: 5.0, USDT: 1, USDC: 1,
};

@Injectable()
export class ExchangeService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Exchange');
  private cache: Record<string, number> = {};
  private lastRefresh = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.loadFromDb();
    // Refresh in background; do not block boot.
    void this.refreshIfStale();
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns rates table where rates[CUR] = how many CUR per 1 USD. */
  getRates(): Record<string, number> {
    return { ...this.cache };
  }

  getLastRefresh(): number {
    return this.lastRefresh;
  }

  /** Convert `amount` from `from` currency to `to` currency using USD as pivot. */
  convert(amount: number, from: string, to: string): number {
    const f = (from || 'USD').toUpperCase();
    const t = (to || 'USD').toUpperCase();
    if (f === t) return amount;
    const rf = this.rateOf(f);
    const rt = this.rateOf(t);
    if (!rf || !rt) return amount;
    return (amount / rf) * rt;
  }

  /** How many USD is `amount` of `from` worth? */
  toUsd(amount: number, from: string): number {
    const f = (from || 'USD').toUpperCase();
    if (USD_PEGGED.has(f)) return amount;
    const rf = this.rateOf(f);
    if (!rf) return amount;
    return amount / rf;
  }

  /** How many `to` does `amountUsd` (USD) buy? */
  fromUsd(amountUsd: number, to: string): number {
    const t = (to || 'USD').toUpperCase();
    if (USD_PEGGED.has(t)) return amountUsd;
    const rt = this.rateOf(t);
    if (!rt) return amountUsd;
    return amountUsd * rt;
  }

  private rateOf(code: string): number | undefined {
    if (USD_PEGGED.has(code)) return 1;
    return this.cache[code];
  }

  private async loadFromDb(): Promise<void> {
    try {
      const rows = await this.prisma.exchangeRate.findMany();
      const map: Record<string, number> = { USD: 1 };
      let newest = 0;
      for (const r of rows) {
        map[r.code] = Number(r.rate.toString());
        const ts = r.updatedAt.getTime();
        if (ts > newest) newest = ts;
      }
      this.cache = { ...FALLBACK_RATES, ...map };
      this.lastRefresh = newest;
      if (rows.length > 0) {
        this.log.log(`loaded ${rows.length} rates from DB (newest=${new Date(newest).toISOString()})`);
      } else {
        this.log.warn('no rates in DB yet, using fallback table');
      }
    } catch (err) {
      this.log.warn(`loadFromDb failed: ${(err as Error).message}`);
      this.cache = { ...FALLBACK_RATES };
    }
  }

  private async refreshIfStale(): Promise<void> {
    if (Date.now() - this.lastRefresh < REFRESH_MS) return;
    await this.refresh();
  }

  async refresh(): Promise<{ ok: boolean; count: number; error?: string }> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      let json: RatesPayload;
      try {
        const res = await fetch(ENDPOINT, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = (await res.json()) as RatesPayload;
      } finally {
        clearTimeout(t);
      }
      if (json.result !== 'success' || !json.rates) throw new Error('bad payload');
      const rates: Record<string, number> = { ...json.rates, USD: 1 };
      for (const code of USD_PEGGED) rates[code] = 1;

      // Persist to DB (upsert each).
      const now = new Date();
      const ops = Object.entries(rates).map(([code, rate]) =>
        this.prisma.exchangeRate.upsert({
          where: { code },
          create: { code, rate: new Prisma.Decimal(String(rate)), updatedAt: now },
          update: { rate: new Prisma.Decimal(String(rate)), updatedAt: now },
        }),
      );
      // Run in chunks to avoid huge transactions.
      for (let i = 0; i < ops.length; i += 25) {
        await this.prisma.$transaction(ops.slice(i, i + 25));
      }

      this.cache = { ...this.cache, ...rates };
      this.lastRefresh = Date.now();
      this.log.log(`rates refreshed, ${Object.keys(rates).length} currencies stored`);
      return { ok: true, count: Object.keys(rates).length };
    } catch (err) {
      this.log.warn(`refresh failed: ${(err as Error).message}`);
      return { ok: false, count: 0, error: (err as Error).message };
    }
  }
}
