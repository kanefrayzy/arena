import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SYSTEM_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { LedgerService } from '../wallet/ledger.service';

/**
 * AdminService — privileged operations. Every mutation that touches money
 * goes through LedgerService (no direct wallet writes).
 */
@Injectable()
export class AdminService {
  private readonly log = new Logger('Admin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────────────────── Dashboard ─────────────────────────
  async dashboard() {
    const [users, banned, matchesTotal, matchesRunning, matchesDisputed, gross, commission, pendingPayouts] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isBanned: true } }),
        this.prisma.match.count(),
        this.prisma.match.count({ where: { status: 'RUNNING' } }),
        this.prisma.match.count({ where: { status: 'DISPUTED' } }),
        this.prisma.ledger.aggregate({
          where: { type: { in: ['MATCH_STAKE_LOCK', 'SHOP_PURCHASE'] }, amount: { lt: 0 } },
          _sum: { amount: true },
        }),
        this.prisma.ledger.aggregate({
          where: { type: 'COMMISSION' },
          _sum: { amount: true },
        }),
        this.prisma.payment.count({ where: { type: 'WITHDRAW', status: 'PENDING' } }),
      ]);
    return {
      users,
      banned,
      matchesTotal,
      matchesRunning,
      matchesDisputed,
      grossVolumeUsd: gross._sum.amount ? gross._sum.amount.abs().toString() : '0',
      commissionUsd: commission._sum.amount ? commission._sum.amount.toString() : '0',
      pendingPayouts,
    };
  }

  // ───────────────────────── Users ─────────────────────────
  async listUsers(opts: { search?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const where: Prisma.UserWhereInput = opts.search
      ? {
          OR: [
            { email: { contains: opts.search, mode: 'insensitive' } },
            { username: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { wallet: true, stats: true },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        isBanned: u.isBanned,
        createdAt: u.createdAt.toISOString(),
        balance: u.wallet?.balance.toString() ?? '0',
        locked: u.wallet?.locked.toString() ?? '0',
        mmr: u.stats?.mmr ?? 1000,
        wins: u.stats?.wins ?? 0,
        losses: u.stats?.losses ?? 0,
      })),
    };
  }

  async banUser(userId: number, _adminId: number, reason?: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'user not found' });
    if (u.role === 'ADMIN') throw new BadRequestException({ code: 'CANNOT_BAN_ADMIN', message: 'cannot ban admin' });
    await this.prisma.user.update({ where: { id: userId }, data: { isBanned: true } });
    this.log.warn(`user ${userId} banned: ${reason ?? '-'}`);
    return { id: userId, isBanned: true };
  }

  async unbanUser(userId: number) {
    await this.prisma.user.update({ where: { id: userId }, data: { isBanned: false } });
    return { id: userId, isBanned: false };
  }

  /** ADJUSTMENT through ledger — never write Wallet directly. */
  async adjustBalance(userId: number, adminId: number, amountUsd: string, reason: string) {
    const amount = new Prisma.Decimal(amountUsd);
    if (amount.isZero()) throw new BadRequestException({ code: 'ZERO_AMOUNT', message: 'amount must be non-zero' });
    const idempotencyKey = `admin:adjust:${adminId}:${userId}:${Date.now()}`;
    if (amount.isPositive()) {
      // credit user; debit nothing (free money / bonus)
      await this.ledger.record({
        userId,
        amount,
        type: 'ADJUSTMENT',
        refType: 'admin',
        refId: String(adminId),
        idempotencyKey,
        meta: { reason, adminId },
      });
    } else {
      // debit user; credit system mirror
      await this.ledger.record({
        userId,
        amount,
        type: 'ADJUSTMENT',
        refType: 'admin',
        refId: String(adminId),
        idempotencyKey,
        meta: { reason, adminId },
      });
      await this.ledger.record({
        userId: SYSTEM_USER_ID,
        amount: amount.negated(),
        type: 'ADJUSTMENT',
        refType: 'admin',
        refId: String(adminId),
        idempotencyKey: `${idempotencyKey}:system`,
        meta: { reason, adminId, fromUserId: userId },
      });
    }
    const w = await this.prisma.wallet.findUnique({ where: { userId } });
    return { userId, balance: w ? w.balance.toString() : '0', amount: amount.toString(), reason };
  }

  // ───────────────────────── Rooms ─────────────────────────
  async listRooms() {
    const rows = await this.prisma.room.findMany({ orderBy: { id: 'asc' } });
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        mode: r.mode,
        stakeUsd: r.stakeUsd ? r.stakeUsd.toString() : null,
        commissionPct: r.commissionPct,
        matchDurationS: r.matchDurationS,
        winCondition: r.winCondition,
        isActive: r.isActive,
        minBalanceRequired: r.minBalanceRequired,
        obstacles: Array.isArray(r.obstacles) ? r.obstacles : [],
      })),
    };
  }

  async createRoom(input: {
    name: string;
    mode: 'FREE' | 'CASUAL' | 'STAKE';
    stakeUsd?: string | null;
    commissionPct?: number;
    matchDurationS?: number;
    winCondition?: 'KILL' | 'BEST_OF_3' | 'TIMEOUT_HP';
    minBalanceRequired?: boolean;
    obstacles?: unknown;
  }) {
    return this.prisma.room.create({
      data: {
        name: input.name,
        mode: input.mode,
        stakeUsd: input.stakeUsd ? new Prisma.Decimal(input.stakeUsd) : null,
        commissionPct: input.commissionPct ?? 20,
        matchDurationS: input.matchDurationS ?? 120,
        winCondition: input.winCondition ?? 'KILL',
        minBalanceRequired: input.minBalanceRequired ?? input.mode !== 'FREE',
        obstacles: (input.obstacles as Prisma.InputJsonValue) ?? [],
      },
    });
  }

  async updateRoom(id: number, patch: Partial<{
    name: string;
    stakeUsd: string | null;
    commissionPct: number;
    matchDurationS: number;
    isActive: boolean;
    minBalanceRequired: boolean;
    obstacles: unknown;
  }>) {
    const data: Prisma.RoomUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.stakeUsd !== undefined) data.stakeUsd = patch.stakeUsd ? new Prisma.Decimal(patch.stakeUsd) : null;
    if (patch.commissionPct !== undefined) data.commissionPct = patch.commissionPct;
    if (patch.matchDurationS !== undefined) data.matchDurationS = patch.matchDurationS;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.minBalanceRequired !== undefined) data.minBalanceRequired = patch.minBalanceRequired;
    if (patch.obstacles !== undefined) data.obstacles = patch.obstacles as Prisma.InputJsonValue;
    return this.prisma.room.update({ where: { id }, data });
  }

  async deleteRoom(id: number) {
    // Soft-delete via deactivation; physical delete forbidden if matches reference it.
    await this.prisma.room.update({ where: { id }, data: { isActive: false } });
    return { id, isActive: false };
  }

  // ───────────────────────── Characters ─────────────────────────
  async createCharacter(input: {
    slug: string;
    name: string;
    baseHp: number;
    baseSpeed: number;
    baseDamage: number;
    weaponType: string;
    abilityType?: string | null;
    abilityCooldownS?: number;
  }) {
    return this.prisma.character.create({
      data: {
        slug: input.slug,
        name: input.name,
        baseHp: input.baseHp,
        baseSpeed: input.baseSpeed,
        baseDamage: input.baseDamage,
        weaponType: input.weaponType,
        abilityType: input.abilityType ?? null,
        abilityCooldownS: input.abilityCooldownS ?? 10,
      },
    });
  }

  async updateCharacter(id: number, patch: Partial<{
    name: string;
    baseHp: number;
    baseSpeed: number;
    baseDamage: number;
    weaponType: string;
    abilityType: string | null;
    abilityCooldownS: number;
    isActive: boolean;
  }>) {
    return this.prisma.character.update({ where: { id }, data: patch });
  }

  // ───────────────────────── Skins ─────────────────────────
  async createSkin(input: {
    characterId: number;
    name: string;
    rarity: string;
    spriteSetUrl: string;
    tint?: string | null;
    statModifiers?: Record<string, number> | null;
    priceUsd?: string | null;
  }) {
    return this.prisma.skin.create({
      data: {
        characterId: input.characterId,
        name: input.name,
        rarity: input.rarity,
        spriteSetUrl: input.spriteSetUrl,
        tint: input.tint ?? null,
        statModifiers: (input.statModifiers ?? null) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
        priceUsd: input.priceUsd ? new Prisma.Decimal(input.priceUsd) : null,
      },
    });
  }

  async updateSkin(id: number, patch: Partial<{
    name: string;
    rarity: string;
    spriteSetUrl: string;
    tint: string | null;
    statModifiers: Record<string, number> | null;
    priceUsd: string | null;
    isActive: boolean;
  }>) {
    const data: Prisma.SkinUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.rarity !== undefined) data.rarity = patch.rarity;
    if (patch.spriteSetUrl !== undefined) data.spriteSetUrl = patch.spriteSetUrl;
    if (patch.tint !== undefined) data.tint = patch.tint;
    if (patch.statModifiers !== undefined) {
      data.statModifiers = (patch.statModifiers ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (patch.priceUsd !== undefined) data.priceUsd = patch.priceUsd ? new Prisma.Decimal(patch.priceUsd) : null;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    return this.prisma.skin.update({ where: { id }, data });
  }

  // ───────────────────────── Matches ─────────────────────────
  async listMatches(opts: { status?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = await this.prisma.match.findMany({
      where: opts.status ? { status: opts.status as Prisma.MatchWhereInput['status'] } : {},
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return {
      items: rows.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        winnerId: m.winnerId,
        status: m.status,
        stakeUsd: m.stakeUsd.toString(),
        startedAt: m.startedAt?.toISOString() ?? null,
        finishedAt: m.finishedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Force-finish: set winner manually + settle (or refund both via null winner). */
  async forceFinishMatch(matchId: string, adminId: number, winnerId: number | null, reason: string) {
    const m = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!m) throw new NotFoundException({ code: 'MATCH_NOT_FOUND', message: 'match not found' });
    if (m.status === 'FINISHED' || m.status === 'CANCELLED') {
      throw new BadRequestException({ code: 'MATCH_ALREADY_TERMINATED', message: `match is ${m.status}` });
    }
    if (winnerId != null && winnerId !== m.player1Id && winnerId !== m.player2Id) {
      throw new BadRequestException({ code: 'INVALID_WINNER', message: 'winnerId not in match' });
    }
    const room = await this.prisma.room.findUnique({ where: { id: m.roomId } });
    const stake = m.stakeUsd;
    if (winnerId == null) {
      // Refund both: unlock stakes (idempotent on match key), cancel.
      await this.ledger.unlockStake(matchId, m.player1Id, stake);
      await this.ledger.unlockStake(matchId, m.player2Id, stake);
      await this.prisma.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', finishedAt: new Date(), meta: { adminAction: 'refund', adminId, reason } },
      });
      return { id: matchId, status: 'CANCELLED', refunded: true };
    }
    const loserId = winnerId === m.player1Id ? m.player2Id : m.player1Id;
    await this.ledger.unlockStake(matchId, m.player1Id, stake);
    await this.ledger.unlockStake(matchId, m.player2Id, stake);
    await this.ledger.settleMatch({
      matchId,
      winnerId,
      loserId,
      stake,
      commissionPct: room?.commissionPct ?? 20,
    });
    await this.prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'FINISHED',
        winnerId,
        finishedAt: new Date(),
        meta: { adminAction: 'force-finish', adminId, reason },
      },
    });
    return { id: matchId, status: 'FINISHED', winnerId };
  }

  /** Refund-only shortcut (alias of force-finish with winnerId=null). */
  async refundMatch(matchId: string, adminId: number, reason: string) {
    return this.forceFinishMatch(matchId, adminId, null, reason);
  }

  // ───────────────────────── Payments ─────────────────────────
  async listPayments(opts: { status?: string; type?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const where: Prisma.PaymentWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.type) where.type = opts.type;
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        userId: p.userId,
        type: p.type,
        status: p.status,
        amountUsd: p.amountUsd.toString(),
        provider: p.provider,
        externalId: p.externalId,
        createdAt: p.createdAt.toISOString(),
        finishedAt: p.finishedAt?.toISOString() ?? null,
      })),
    };
  }

  async approvePayment(paymentId: string, adminId: number) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'payment not found' });
    if (p.status !== 'PENDING') {
      throw new BadRequestException({ code: 'NOT_PENDING', message: `payment is ${p.status}` });
    }
    if (p.type !== 'WITHDRAW') {
      throw new BadRequestException({ code: 'NOT_WITHDRAW', message: 'only WITHDRAW can be approved here' });
    }
    // Funds were already locked at request time. On approve: convert lock → debit (WITHDRAWAL).
    const idempotencyKey = `payment:${paymentId}:approve`;
    await this.prisma.$transaction(async (tx) => {
      const w = await tx.wallet.findUnique({ where: { userId: p.userId } });
      if (!w) throw new BadRequestException({ code: 'WALLET_MISSING', message: 'wallet missing' });
      const amount = new Prisma.Decimal(p.amountUsd.toString());
      const newLocked = new Prisma.Decimal(w.locked.toString()).minus(amount);
      if (newLocked.isNegative()) {
        throw new BadRequestException({ code: 'LOCK_UNDERFLOW', message: 'locked underflow' });
      }
      await tx.wallet.update({ where: { userId: p.userId }, data: { locked: newLocked } });
      const dup = await tx.ledger.findUnique({ where: { idempotencyKey } });
      if (!dup) {
        await tx.ledger.create({
          data: {
            userId: p.userId,
            amount: amount.negated(),
            type: 'WITHDRAWAL',
            refType: 'payment',
            refId: paymentId,
            idempotencyKey,
            meta: { adminId },
          },
        });
      }
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'APPROVED', finishedAt: new Date(), meta: { ...((p.meta as object) ?? {}), adminId } },
      });
    });
    return { id: paymentId, status: 'APPROVED' };
  }

  async rejectPayment(paymentId: string, adminId: number, reason: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'payment not found' });
    if (p.status !== 'PENDING') {
      throw new BadRequestException({ code: 'NOT_PENDING', message: `payment is ${p.status}` });
    }
    // Unlock the held funds back to balance.
    await this.prisma.$transaction(async (tx) => {
      const w = await tx.wallet.findUnique({ where: { userId: p.userId } });
      if (!w) throw new BadRequestException({ code: 'WALLET_MISSING', message: 'wallet missing' });
      const amount = new Prisma.Decimal(p.amountUsd.toString());
      const newLocked = new Prisma.Decimal(w.locked.toString()).minus(amount);
      const newBalance = new Prisma.Decimal(w.balance.toString()).plus(amount);
      if (newLocked.isNegative()) {
        throw new BadRequestException({ code: 'LOCK_UNDERFLOW', message: 'locked underflow' });
      }
      await tx.wallet.update({
        where: { userId: p.userId },
        data: { locked: newLocked, balance: newBalance },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'REJECTED', finishedAt: new Date(), meta: { ...((p.meta as object) ?? {}), adminId, reason } },
      });
    });
    return { id: paymentId, status: 'REJECTED' };
  }

  // ───────────────────────── Settings ─────────────────────────
  async listSettings() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return { items: rows };
  }

  async upsertSetting(key: string, value: unknown) {
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }

  async deleteSetting(key: string) {
    await this.prisma.setting.delete({ where: { key } });
    return { key, deleted: true };
  }
}
