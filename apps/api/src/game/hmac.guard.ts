import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';

const HMAC_HEADER = 'x-arena-signature';
const TS_HEADER = 'x-arena-timestamp';
const TOLERANCE_MS = 60_000;

/**
 * Verifies HMAC-SHA256 over `${timestamp}.${rawBody}` using INTERNAL_SECRET.
 * Used for /internal/* called by game-server.
 *
 * The raw body must be present on req — we attach it via a custom rawBody
 * parser middleware in main.ts for /internal routes.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const sig = (req.headers[HMAC_HEADER] as string | undefined) ?? '';
    const ts = (req.headers[TS_HEADER] as string | undefined) ?? '';
    if (!sig || !ts) throw new UnauthorizedException('missing hmac headers');

    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > TOLERANCE_MS) {
      throw new UnauthorizedException('stale request');
    }
    const secret = process.env.INTERNAL_SECRET ?? '';
    if (!secret) throw new UnauthorizedException('internal secret not set');

    const raw = req.rawBody ?? Buffer.from('');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${ts}.`)
      .update(raw)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException('bad signature');
    }
    return true;
  }
}
