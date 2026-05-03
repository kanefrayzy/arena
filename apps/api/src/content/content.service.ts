import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.module';

export interface CharacterDto {
  id: number;
  slug: string;
  name: string;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  weaponType: string;
  abilityType: string | null;
  abilityCooldownS: number;
  isActive: boolean;
  skins: SkinDto[];
}

export interface SkinDto {
  id: number;
  characterId: number;
  name: string;
  rarity: string;
  spriteSetUrl: string;
  tint: string | null;
  statModifiers: Record<string, number> | null;
  priceCoin: number | null;
  priceUsd: string | null;
  isActive: boolean;
}

export interface InventoryDto {
  skins: Array<{ skinId: number; characterId: number; source: string; acquiredAt: string }>;
}

export interface LoadoutDto {
  characterId: number;
  skinId: number;
}

@Injectable()
export class ContentService {
  private readonly log = new Logger('Content');

  constructor(private readonly prisma: PrismaService) {}

  async listCharacters(): Promise<CharacterDto[]> {
    const rows = await this.prisma.character.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      include: { skins: { orderBy: { id: 'asc' } } },
    });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      baseHp: c.baseHp,
      baseSpeed: c.baseSpeed,
      baseDamage: c.baseDamage,
      weaponType: c.weaponType,
      abilityType: c.abilityType,
      abilityCooldownS: c.abilityCooldownS,
      isActive: c.isActive,
      skins: c.skins.filter((s) => s.isActive).map((s) => this.toSkinDto(s)),
    }));
  }

  async listShop(): Promise<SkinDto[]> {
    const rows = await this.prisma.skin.findMany({
      where: { isActive: true, OR: [{ priceCoin: { not: null } }, { priceUsd: { not: null } }] },
      orderBy: [{ characterId: 'asc' }, { id: 'asc' }],
    });
    return rows.map((s) => this.toSkinDto(s));
  }

  async getInventory(userId: number): Promise<InventoryDto> {
    const rows = await this.prisma.userInventory.findMany({
      where: { userId },
      orderBy: { acquiredAt: 'asc' },
    });
    const skinIds = rows.map((r) => r.skinId);
    const skins = skinIds.length
      ? await this.prisma.skin.findMany({ where: { id: { in: skinIds } } })
      : [];
    const charBySkin = new Map(skins.map((s) => [s.id, s.characterId]));
    return {
      skins: rows.map((r) => ({
        skinId: r.skinId,
        characterId: charBySkin.get(r.skinId) ?? 0,
        source: r.source,
        acquiredAt: r.acquiredAt.toISOString(),
      })),
    };
  }

  async getLoadout(userId: number): Promise<LoadoutDto> {
    const row = await this.prisma.userLoadout.findUnique({ where: { userId } });
    if (row) return { characterId: row.characterId, skinId: row.skinId };
    // Fallback: ensure a starter loadout (first owned default skin).
    const fallback = await this.ensureStarterAndLoadout(userId);
    return fallback;
  }

  async setLoadout(userId: number, characterId: number, skinId: number): Promise<LoadoutDto> {
    const skin = await this.prisma.skin.findUnique({ where: { id: skinId } });
    if (!skin || !skin.isActive) throw new NotFoundException({ code: 'SKIN_NOT_FOUND', message: 'skin not found' });
    if (skin.characterId !== characterId) {
      throw new BadRequestException({ code: 'SKIN_MISMATCH', message: 'skin does not belong to character' });
    }
    const owned = await this.prisma.userInventory.findUnique({
      where: { userId_skinId: { userId, skinId } },
    });
    if (!owned) throw new BadRequestException({ code: 'NOT_OWNED', message: 'skin not in inventory' });
    await this.prisma.userLoadout.upsert({
      where: { userId },
      create: { userId, characterId, skinId },
      update: { characterId, skinId },
    });
    return { characterId, skinId };
  }

  /**
   * Idempotent: grants every "Default" skin (one per character) to user as starters,
   * and sets a default loadout if missing.
   */
  async ensureStarterAndLoadout(userId: number): Promise<LoadoutDto> {
    const defaults = await this.prisma.skin.findMany({
      where: { isActive: true, name: 'Default', priceCoin: null, priceUsd: null },
      orderBy: { characterId: 'asc' },
    });
    for (const skin of defaults) {
      try {
        await this.prisma.userInventory.create({
          data: { userId, skinId: skin.id, source: 'starter' },
        });
      } catch (err) {
        // Unique violation = already owned, ignore.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    const existing = await this.prisma.userLoadout.findUnique({ where: { userId } });
    if (existing) return { characterId: existing.characterId, skinId: existing.skinId };
    const first = defaults[0];
    if (!first) throw new Error('no default skins seeded');
    await this.prisma.userLoadout.create({
      data: { userId, characterId: first.characterId, skinId: first.id },
    });
    this.log.log(`granted ${defaults.length} starter skins to user ${userId}`);
    return { characterId: first.characterId, skinId: first.id };
  }

  /** Buy a skin with coins. Idempotent if already owned (returns ALREADY_OWNED). */
  async buySkin(userId: number, skinId: number): Promise<{ skinId: number; coinsLeft: number }> {
    const skin = await this.prisma.skin.findUnique({ where: { id: skinId } });
    if (!skin || !skin.isActive) {
      throw new NotFoundException({ code: 'SKIN_NOT_FOUND', message: 'skin not found' });
    }
    if (skin.priceCoin == null) {
      throw new BadRequestException({ code: 'NOT_FOR_SALE', message: 'skin not for sale (coins)' });
    }
    const price = skin.priceCoin;

    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.userInventory.findUnique({
        where: { userId_skinId: { userId, skinId } },
      });
      if (owned) {
        throw new BadRequestException({ code: 'ALREADY_OWNED', message: 'skin already owned' });
      }
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.coins < price) {
        throw new BadRequestException({ code: 'INSUFFICIENT_COINS', message: 'not enough coins' });
      }
      const updated = await tx.wallet.update({
        where: { userId },
        data: { coins: { decrement: price } },
      });
      await tx.userInventory.create({
        data: { userId, skinId, source: 'purchase' },
      });
      return { skinId, coinsLeft: updated.coins };
    });
  }

  private toSkinDto(s: {
    id: number;
    characterId: number;
    name: string;
    rarity: string;
    spriteSetUrl: string;
    tint: string | null;
    statModifiers: Prisma.JsonValue | null;
    priceCoin: number | null;
    priceUsd: Prisma.Decimal | null;
    isActive: boolean;
  }): SkinDto {
    return {
      id: s.id,
      characterId: s.characterId,
      name: s.name,
      rarity: s.rarity,
      spriteSetUrl: s.spriteSetUrl,
      tint: s.tint,
      statModifiers: (s.statModifiers as Record<string, number> | null) ?? null,
      priceCoin: s.priceCoin,
      priceUsd: s.priceUsd ? s.priceUsd.toString() : null,
      isActive: s.isActive,
    };
  }
}
