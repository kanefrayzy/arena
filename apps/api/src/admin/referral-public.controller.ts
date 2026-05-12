import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminService } from '../admin/admin.service';

/**
 * Public referral redirect: `GET /r/:code` (excluded from /api prefix).
 *
 *  - increments Referral.clicks (best-effort)
 *  - sets `arena_ref` cookie (90d) — read by auth.service on register
 *  - 302 redirects to /register?ref=<code>
 *
 * If the code is unknown or inactive, we still redirect to /register without
 * setting the cookie (no broken-link UX).
 */
@Controller('r')
export class ReferralPublicController {
  constructor(private readonly admin: AdminService) {}

  @Get(':code')
  async track(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cleaned = (code ?? '').slice(0, 40);
    let ok = false;
    if (/^[a-zA-Z0-9_-]{1,40}$/.test(cleaned)) {
      ok = await this.admin.trackReferralClick(cleaned);
    }
    if (ok) {
      res.cookie('arena_ref', cleaned, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 90 * 24 * 60 * 60 * 1000,
      });
    }
    // Preserve any extra utm_* params on the redirect target so the marketer
    // can layer them on top of the campaign code.
    const passThru = new URL(req.url, 'http://x').searchParams;
    const qs = new URLSearchParams();
    for (const [k, v] of passThru.entries()) qs.set(k, v);
    res.redirect(302, `/${qs.toString() ? `?${qs.toString()}` : ''}`);
  }
}
