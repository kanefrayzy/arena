import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const API_URL = (process.env.BETRA_API_URL ?? 'https://betra1.com/api/h2h').replace(/\/$/, '');
const API_KEY = process.env.BETRA_API_KEY ?? '';
const SECRET = process.env.BETRA_SECRET ?? '';

interface CreateDepositInput {
  orderId: string;
  amount: string;
  currency: string;
  callbackUrl: string;
  userId: number;
  email?: string;
  aggregators?: string[];
}

export interface BetraDepositReqs {
  id: number;
  status: string;
  card: string | null;
  cardHolder: string | null;
  bank: string | null;
  qrLink: string | null;
  expiredAt: string | null;
  amount: number;
  currency: string;
}

interface CreatePayoutInput {
  orderId: string;
  amount: string;
  currency: string;
  card: string;
  receiverName?: string;
  receiverPhone?: string;
  callbackUrl: string;
}

@Injectable()
export class BetraService {
  private readonly log = new Logger('Betra');

  isConfigured(): boolean {
    return Boolean(API_KEY && SECRET);
  }

  private async req(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; data: any; status: number }> {
    if (!API_KEY) throw new ServiceUnavailableException({ code: 'BETRA_NOT_CONFIGURED' });
    const init: RequestInit = {
      method,
      headers: {
        'X-Api-Key': API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(`${API_URL}${path}`, init);
    let data: any = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    if (!r.ok) {
      this.log.warn(`Betra ${method} ${path} -> ${r.status} ${JSON.stringify(data)}`);
    }
    return { ok: r.ok && data?.success !== false, data, status: r.status };
  }

  async createDeposit(input: CreateDepositInput): Promise<BetraDepositReqs> {
    const body = {
      order_id: input.orderId,
      amount: Number(input.amount),
      currency: input.currency,
      callback_url: input.callbackUrl,
      aggregators: input.aggregators,
      customer: {
        user_id: String(input.userId),
        email: input.email,
      },
    };
    const r = await this.req('POST', '/create', body);
    if (!r.ok) {
      throw new ServiceUnavailableException({
        code: 'BETRA_CREATE_FAILED',
        status: r.status,
        error: r.data?.error ?? r.data,
      });
    }
    const d = r.data?.data ?? r.data;
    return {
      id: d.id,
      status: d.status,
      card: d.card ?? null,
      cardHolder: d.card_holder ?? null,
      bank: d.bank ?? null,
      qrLink: d.qr_link ?? null,
      expiredAt: d.expired_at ?? null,
      amount: Number(d.amount ?? input.amount),
      currency: d.currency ?? input.currency,
    };
  }

  async getDepositStatus(id: number): Promise<{ status: string; raw: any }> {
    const r = await this.req('GET', `/status/${id}`);
    if (!r.ok) throw new ServiceUnavailableException({ code: 'BETRA_STATUS_FAILED' });
    return { status: r.data?.data?.status ?? 'unknown', raw: r.data?.data };
  }

  async cancelDeposit(id: number): Promise<void> {
    await this.req('POST', `/cancel/${id}`);
  }

  async createPayout(input: CreatePayoutInput): Promise<{ id: number; status: string }> {
    const body = {
      order_id: input.orderId,
      amount: Number(input.amount),
      currency: input.currency,
      card: input.card,
      receiver_name: input.receiverName,
      receiver_phone: input.receiverPhone,
      callback_url: input.callbackUrl,
    };
    const r = await this.req('POST', '/payout/create', body);
    if (!r.ok) {
      throw new ServiceUnavailableException({
        code: 'BETRA_PAYOUT_FAILED',
        error: r.data?.error ?? r.data,
      });
    }
    const d = r.data?.data ?? r.data;
    return { id: d.id, status: d.status };
  }

  /**
   * Verify deposit-callback signature. Tries multiple schemes Betra may use:
   *   A) X-Signature header HMAC_SHA256 over raw body (same as payout).
   *   B) `signature` field in body computed as HMAC_SHA256(id+order_id+status+timestamp, secret).
   *   C) `signature` field in body computed as HMAC_SHA256(rawBody-without-signature-field, secret).
   * Logs (sanitized) on mismatch so we can adapt to provider's actual scheme.
   */
  verifyDepositSignature(
    payload: { id?: number | string; order_id?: string; status?: string; timestamp?: number | string; signature?: string } & Record<string, unknown>,
    rawBody?: Buffer | string,
    headerSig?: string,
  ): boolean {
    if (!SECRET) {
      this.log.error('BETRA_SECRET not configured — cannot verify deposit callbacks');
      return false;
    }

    const tryEqual = (expectedHex: string, receivedHex: string): boolean => {
      if (!receivedHex) return false;
      const a = Buffer.from(expectedHex, 'utf8');
      const b = Buffer.from(receivedHex.toLowerCase(), 'utf8');
      if (a.length !== b.length) return false;
      try { return timingSafeEqual(a, b); } catch { return false; }
    };

    // Scheme A: X-Signature header over raw body.
    if (rawBody && headerSig) {
      const expA = createHmac('sha256', SECRET).update(rawBody).digest('hex');
      if (tryEqual(expA, headerSig)) return true;
    }

    // Scheme B: concatenated fields in body.
    const sigB = `${payload.id ?? ''}${payload.order_id ?? ''}${payload.status ?? ''}${payload.timestamp ?? ''}`;
    const expB = createHmac('sha256', SECRET).update(sigB).digest('hex');
    const received = String(payload.signature ?? '');
    if (tryEqual(expB, received)) return true;

    // Scheme C: HMAC over body JSON minus the `signature` field.
    if (rawBody) {
      try {
        const obj = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
        delete obj.signature;
        const canon = JSON.stringify(obj);
        const expC = createHmac('sha256', SECRET).update(canon).digest('hex');
        if (tryEqual(expC, received)) return true;
      } catch { /* not JSON */ }
    }

    // Diagnostic dump on mismatch: sanitized raw body (mask card numbers) + computed candidates.
    // This is critical for debugging real provider payloads when they don't match the docs.
    let bodyDump = '';
    if (rawBody) {
      const s = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      bodyDump = s.replace(/(\d{6})\d{6,9}(\d{4})/g, '$1******$2').slice(0, 600);
    }
    this.log.warn(
      `Betra deposit-callback signature mismatch.\n` +
      `  received=${received}\n` +
      `  expA(raw+header)=${rawBody && headerSig ? createHmac('sha256', SECRET).update(rawBody).digest('hex') : '<n/a>'}\n` +
      `  expB(fields ${sigB.length}b)=${expB}\n` +
      `  signed-string="${sigB}"\n` +
      `  payload-keys=${Object.keys(payload).join(',')}\n` +
      `  rawBody=${bodyDump}`,
    );
    return false;
  }

  /** Verify payout-callback or any X-Signature header against raw body. */
  verifyHeaderSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!SECRET || !signature) return false;
    const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
