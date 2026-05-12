import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { loginSchema, registerSchema } from '@arena/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';

const ACCESS_COOKIE = 'arena_access';
const REFRESH_COOKIE = 'arena_refresh';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: maxAgeMs,
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip ?? req.socket.remoteAddress ?? undefined;
    // Referral source: either explicit body.ref, ?ref= query param, or arena_ref cookie.
    const bodyRef =
      typeof (body as { ref?: unknown }).ref === 'string'
        ? ((body as { ref?: string }).ref as string)
        : null;
    const queryRef = typeof req.query?.ref === 'string' ? (req.query.ref as string) : null;
    const cookieRef = (req.cookies?.['arena_ref'] ?? null) as string | null;
    const refCode = bodyRef || queryRef || cookieRef;
    const out = await this.auth.register(body as never, ip, refCode);
    this.setAuthCookies(res, out.tokens);
    // Best-effort: clear the referral cookie once consumed.
    if (cookieRef) res.clearCookie('arena_ref', { path: '/' });
    return { user: out.user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(body as never);
    this.setAuthCookies(res, out.tokens);
    return { user: out.user };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.[REFRESH_COOKIE] ?? '') as string;
    const tokens = await this.auth.refresh(token);
    this.setAuthCookies(res, tokens);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    const userId = (req as Request & { user?: { sub: number } }).user?.sub;
    return this.auth.getMe(userId as number);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Req() req: Request,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    const userId = (req as Request & { user?: { sub: number } }).user?.sub as number;
    return this.auth.changePassword(userId, body.currentPassword, body.newPassword);
  }

  private setAuthCookies(res: Response, tokens: { access: string; refresh: string }) {
    res.cookie(ACCESS_COOKIE, tokens.access, cookieOpts(15 * 60 * 1000));
    res.cookie(REFRESH_COOKIE, tokens.refresh, cookieOpts(30 * 24 * 60 * 60 * 1000));
  }
}
