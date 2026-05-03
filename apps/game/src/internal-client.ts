import * as crypto from 'node:crypto';

const HMAC_HEADER = 'x-arena-signature';
const TS_HEADER = 'x-arena-timestamp';

export interface InternalClientOpts {
  baseUrl: string;
  secret: string;
}

export class InternalApiClient {
  constructor(private readonly opts: InternalClientOpts) {}

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const ts = String(Date.now());
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const sig = crypto.createHmac('sha256', this.opts.secret).update(`${ts}.`).update(raw).digest('hex');
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HMAC_HEADER]: sig,
        [TS_HEADER]: ts,
      },
      body: raw,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`internal ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
