import { Injectable, Logger } from '@nestjs/common';

interface RatesPayload {
  result?: string;
  base_code?: string;
  rates?: Record<string, number>;
  time_last_update_unix?: number;
}

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  RUB: 95,
  UAH: 41,
  KZT: 470,
  BYN: 3.3,
  GBP: 0.79,
  // Crypto stays USD-pegged regardless of upstream:
  USDT: 1,
  USDC: 1,
};

@Injectable()
export class ExchangeService {
  private readonly log = new Logger('Exchange');
  private cache: { rates: Record<string, number>; ts: number } | null = null;
  private inFlight: Promise<Record<string, number>> | null = null;

  /** Returns rates table where rates[CUR] = how many CUR per 1 USD. */
  async getRates(): Promise<Record<string, number>> {
    const now = Date.now();
    if (this.cache && now - this.cache.ts < TTL_MS) return this.cache.rates;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchRates()
      .then((rates) => {
        this.cache = { rates, ts: Date.now() };
        return rates;
      })
      .catch((err) => {
        this.log.warn(`fetch rates failed: ${(err as Error).message}`);
        if (this.cache) return this.cache.rates;
        return FALLBACK_RATES;
      })
      .finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async fetchRates(): Promise<Record<string, number>> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(ENDPOINT, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as RatesPayload;
      if (json.result !== 'success' || !json.rates) throw new Error('bad payload');
      // Force USD-peg for stablecoins regardless of provider data.
      const rates = { ...json.rates, USDT: 1, USDC: 1, USD: 1 };
      this.log.log(`rates updated, ${Object.keys(rates).length} currencies`);
      return rates;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Convert `amount` from `from` currency to `to` currency using USD as pivot.
   * Crypto symbols (BTC, ETH, etc.) that have no fiat rate fall back to amount as-is
   * (caller is responsible for pegging crypto separately, per business rule
   *  "Криптовалюты просто в USD").
   */
  async convert(amount: number, from: string, to: string): Promise<number> {
    const f = (from || 'USD').toUpperCase();
    const t = (to || 'USD').toUpperCase();
    if (f === t) return amount;
    const rates = await this.getRates();
    const rf = rates[f];
    const rt = rates[t];
    if (!rf || !rt) return amount;
    // amount * (1 USD per `from`) * (`to` per 1 USD)
    return (amount / rf) * rt;
  }

  /** How many USD is `amount` of `from` worth? */
  async toUsd(amount: number, from: string): Promise<number> {
    const f = (from || 'USD').toUpperCase();
    if (f === 'USD' || f === 'USDT' || f === 'USDC') return amount;
    const rates = await this.getRates();
    const rf = rates[f];
    if (!rf) return amount;
    return amount / rf;
  }
}
