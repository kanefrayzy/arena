import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';

const API_URL = (process.env.WESTWALLET_API_URL ?? 'https://api.westwallet.io').replace(/\/$/, '');
const PUBLIC_KEY = process.env.WESTWALLET_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.WESTWALLET_PRIVATE_KEY ?? '';
// Comma-separated list of WestWallet IPs allowed to call our IPN endpoint.
// As of docs, IPN is sent from 5.188.51.47 only.
const IPN_ALLOWED_IPS = (process.env.WESTWALLET_IPN_IPS ?? '5.188.51.47')
  .split(',').map((s) => s.trim()).filter(Boolean);

/** WestWallet auth — X-API-KEY + HMAC-SHA256(timestamp + body, privateKey). */
@Injectable()
export class WestwalletService {
  private readonly log = new Logger('WestWallet');

  isConfigured(): boolean {
    return Boolean(PUBLIC_KEY && PRIVATE_KEY);
  }

  isIpAllowed(ip: string | undefined): boolean {
    if (!ip) return false;
    // Strip IPv6-mapped prefix.
    const norm = ip.replace(/^::ffff:/, '');
    return IPN_ALLOWED_IPS.includes(norm);
  }

  private sign(body: string, ts: string): string {
    return createHmac('sha256', PRIVATE_KEY).update(ts + body).digest('hex');
  }

  private async req<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!PUBLIC_KEY || !PRIVATE_KEY) {
      throw new ServiceUnavailableException({ code: 'WESTWALLET_NOT_CONFIGURED' });
    }
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = body ? JSON.stringify(body) : '';
    const sig = this.sign(payload, ts);

    const url = `${API_URL}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'X-API-KEY': PUBLIC_KEY,
        'X-ACCESS-SIGN': sig,
        'X-ACCESS-TIMESTAMP': ts,
        'Content-Type': 'application/json',
      },
    };
    if (payload) init.body = payload;
    const r = await fetch(url, init);
    let data: any = null;
    try { data = await r.json(); } catch { /* */ }
    if (!r.ok || (data && data.error && data.error !== 'ok')) {
      this.log.warn(`WW ${method} ${path} -> ${r.status} ${JSON.stringify(data)}`);
      throw new ServiceUnavailableException({ code: 'WESTWALLET_ERROR', status: r.status, error: data?.error ?? 'http_error' });
    }
    return data as T;
  }

  /** Generate a new permanent address for a given currency, attached to a label and IPN URL. */
  async generateAddress(input: { currency: string; ipnUrl: string; label: string }): Promise<{ address: string; destTag?: string }> {
    const data = await this.req<{ address: string; dest_tag?: string; currency: string }>('POST', '/address/generate', {
      currency: input.currency,
      ipn_url: input.ipnUrl,
      label: input.label,
    });
    return { address: data.address, destTag: data.dest_tag || undefined };
  }

  /** Look up a single transaction by id (idempotency / spoof check). */
  async getTransaction(id: number | string): Promise<{ status: string; amount: string | number; currency: string; address?: string; raw: any }> {
    const data = await this.req<any>('POST', '/wallet/transaction', { id });
    return {
      status: String(data.status ?? 'unknown'),
      amount: data.amount,
      currency: data.currency,
      address: data.address,
      raw: data,
    };
  }

  async createWithdrawal(input: { currency: string; amount: string; address: string; destTag?: string; description?: string; ipnUrl: string }): Promise<{ id: number; status: string }> {
    const data = await this.req<any>('POST', '/wallet/create_withdrawal', {
      currency: input.currency,
      amount: input.amount,
      address: input.address,
      dest_tag: input.destTag,
      description: input.description,
      ipn_url: input.ipnUrl,
      priority: 'medium',
    });
    return { id: Number(data.id), status: String(data.status ?? 'pending') };
  }
}
