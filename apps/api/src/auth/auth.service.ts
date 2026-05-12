import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import type { LoginInput, RegisterInput } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { ContentService } from '../content/content.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly content: ContentService,
  ) {}

  async register(input: RegisterInput, ip?: string, refCode?: string | null) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      if (existing.email === input.email) {
        throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Этот email уже зарегистрирован' });
      }
      throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Это имя пользователя уже занято' });
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });

    // Validate referral code if provided. Unknown codes silently dropped so a
    // stale cookie never blocks signup.
    let boundRefCode: string | null = null;
    if (refCode && /^[a-zA-Z0-9_-]{1,40}$/.test(refCode)) {
      const ref = await this.prisma.referral.findUnique({
        where: { code: refCode },
        select: { code: true, isActive: true },
      });
      if (ref && ref.isActive) boundRefCode = ref.code;
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        acceptedTosAt: new Date(),
        meta: { acceptedFromIp: ip ?? null },
        refCode: boundRefCode,
        wallet: { create: {} },
        stats: { create: {} },
      },
    });

    // Grant starter skins (Default per character) + default loadout.
    try {
      await this.content.ensureStarterAndLoadout(user.id);
    } catch (err) {
      // Non-fatal: account is usable, but log it.
      console.error(`failed to grant starter content for user ${user.id}:`, err);
    }

    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.publicUser(user), tokens };
  }

  async login(input: LoginInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.isBanned) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' });
    }
    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Неверный email или пароль' });
    const tokens = await this.issueTokens(user.id, user.role);
    return { user: this.publicUser(user), tokens };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: number; role: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      });
    } catch {
      throw new UnauthorizedException('invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.isBanned) throw new UnauthorizedException();
    return this.issueTokens(user.id, user.role);
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const stats = await this.prisma.userStats.findUnique({ where: { userId } });
    return {
      ...this.publicUser(user),
      cup: stats?.cup ?? 0,
      mmr: stats?.mmr ?? 1000,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      draws: stats?.draws ?? 0,
      matchesPlayed: stats?.matchesPlayed ?? 0,
    };
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('current password is incorrect');
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  private async issueTokens(userId: number, role: string) {
    const access = await this.jwt.signAsync(
      { sub: userId, role },
      { secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access', expiresIn: '15m' },
    );
    const refresh = await this.jwt.signAsync(
      { sub: userId, role },
      { secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh', expiresIn: '30d' },
    );
    return { access, refresh };
  }

  private publicUser(u: { id: number; email: string; username: string; role: string; createdAt: Date }) {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
