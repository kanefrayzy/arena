import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SYSTEM_USER_ID } from '@arena/shared';
import { PrismaService } from '../common/prisma/prisma.module';
import { LedgerService } from '../wallet/ledger.service';

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
  spriteUrl: string | null;
  priceUsd: string | null;
  isStarter: boolean;
  skins: SkinDto[];
}

export interface WeaponDto {
  id: number;
  slug: string;
  name: string;
  spriteUrl: string | null;
  damage: number;
  fireRateMs: number;
  bulletSpeed: number;
  priceUsd: string | null;
  isStarter: boolean;
  isActive: boolean;
}

export interface SkinDto {
  id: number;
  characterId: number;
  name: string;
  rarity: string;
  spriteSetUrl: string;
  tint: string | null;
  statModifiers: Record<string, number> | null;
  priceUsd: string | null;
  isActive: boolean;
}

export interface InventoryDto {
  skins: Array<{ skinId: number; characterId: number; source: string; acquiredAt: string }>;
}

export interface LoadoutDto {
  characterId: number;
  skinId: number;
  weaponId: number | null;
}

@Injectable()
export class ContentService {
  private readonly log = new Logger('Content');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

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
      spriteUrl: c.spriteUrl ?? null,
      priceUsd: c.priceUsd ? c.priceUsd.toString() : null,
      isStarter: c.isStarter,
      skins: c.skins.filter((s) => s.isActive).map((s) => this.toSkinDto(s)),
    }));
  }

  async listWeapons(): Promise<WeaponDto[]> {
    const rows = await this.prisma.weapon.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((w) => this.toWeaponDto(w));
  }

  async getWeapon(weaponId: number) {
    return this.prisma.weapon.findUnique({ where: { id: weaponId } });
  }

  async getCharacterById(characterId: number) {
    return this.prisma.character.findUnique({ where: { id: characterId } });
  }

  async listShop(): Promise<SkinDto[]> {
    const rows = await this.prisma.skin.findMany({
      where: { isActive: true, priceUsd: { not: null } },
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

  /** Owned characters and weapons. */
  async getMyShopInventory(userId: number) {
    const [chars, weapons] = await Promise.all([
      this.prisma.userCharacter.findMany({ where: { userId } }),
      this.prisma.userWeapon.findMany({ where: { userId } }),
    ]);
    return {
      characters: chars.map((r) => ({ characterId: r.characterId, acquiredAt: r.acquiredAt.toISOString() })),
      weapons: weapons.map((r) => ({ weaponId: r.weaponId, acquiredAt: r.acquiredAt.toISOString() })),
    };
  }

  async getLoadout(userId: number): Promise<LoadoutDto> {
    const row = await this.prisma.userLoadout.findUnique({ where: { userId } });
    if (row) return { characterId: row.characterId, skinId: row.skinId, weaponId: row.weaponId ?? null };
    // Fallback: ensure a starter loadout (first owned default skin).
    const fallback = await this.ensureStarterAndLoadout(userId);
    return fallback;
  }

  async setLoadout(userId: number, characterId: number, skinId: number, weaponId?: number): Promise<LoadoutDto> {
    return this.setLoadoutPartial(userId, { characterId, skinId, weaponId });
  }

  /**
   * Partial loadout update: any field omitted is kept from existing loadout.
   * Only validates fields that change vs current loadout.
   */
  async setLoadoutPartial(
    userId: number,
    patch: { characterId?: number; skinId?: number; weaponId?: number | null },
  ): Promise<LoadoutDto> {
    const current = await this.prisma.userLoadout.findUnique({ where: { userId } });
    let baseChar: number;
    let baseSkin: number;
    let baseWeapon: number | null;
    if (current) {
      baseChar = current.characterId;
      baseSkin = current.skinId;
      baseWeapon = current.weaponId ?? null;
    } else {
      // No loadout yet — bootstrap with starter, then apply patch.
      const starter = await this.ensureStarterAndLoadout(userId);
      baseChar = starter.characterId;
      baseSkin = starter.skinId;
      baseWeapon = starter.weaponId ?? null;
    }

    const characterId = patch.characterId ?? baseChar;
    // If character changed but skin not specified, pick a sensible default skin for the new character:
    // prefer an owned skin of the new character, else the first active skin.
    let skinId: number;
    if (patch.skinId != null) {
      skinId = patch.skinId;
    } else if (characterId !== baseChar) {
      const ownedSkin = await this.prisma.userInventory.findFirst({
        where: { userId, skinId: { in: (await this.prisma.skin.findMany({ where: { characterId, isActive: true }, select: { id: true } })).map((s) => s.id) } },
        orderBy: { id: 'asc' },
      });
      if (ownedSkin) {
        skinId = ownedSkin.skinId;
      } else {
        const firstSkin = await this.prisma.skin.findFirst({
          where: { characterId, isActive: true },
          orderBy: { id: 'asc' },
        });
        if (!firstSkin) throw new NotFoundException({ code: 'SKIN_NOT_FOUND', message: 'no skin for character' });
        skinId = firstSkin.id;
      }
    } else {
      skinId = baseSkin;
    }
    const weaponId = patch.weaponId !== undefined ? patch.weaponId : baseWeapon;

    const charChanged = characterId !== baseChar;
    const skinChanged = skinId !== baseSkin;
    const weaponChanged = weaponId !== baseWeapon;

    if (charChanged || skinChanged) {
      const skin = await this.prisma.skin.findUnique({ where: { id: skinId } });
      if (!skin || !skin.isActive) throw new NotFoundException({ code: 'SKIN_NOT_FOUND', message: 'skin not found' });
      if (skin.characterId !== characterId) {
        throw new BadRequestException({ code: 'SKIN_MISMATCH', message: 'skin does not belong to character' });
      }
      const owned = await this.prisma.userInventory.findUnique({
        where: { userId_skinId: { userId, skinId } },
      });
      if (!owned) throw new BadRequestException({ code: 'NOT_OWNED', message: 'skin not in inventory' });

      const char = await this.prisma.character.findUnique({ where: { id: characterId } });
      if (!char || !char.isActive) throw new NotFoundException({ code: 'CHARACTER_NOT_FOUND', message: 'character not found' });
      if (!char.isStarter) {
        const ownedC = await this.prisma.userCharacter.findUnique({
          where: { userId_characterId: { userId, characterId } },
        });
        if (!ownedC) throw new BadRequestException({ code: 'CHARACTER_NOT_OWNED', message: 'character not owned' });
      }
    }

    if (weaponChanged && weaponId != null) {
      const weapon = await this.prisma.weapon.findUnique({ where: { id: weaponId } });
      if (!weapon || !weapon.isActive) throw new NotFoundException({ code: 'WEAPON_NOT_FOUND', message: 'weapon not found' });
      if (!weapon.isStarter) {
        const ownedW = await this.prisma.userWeapon.findUnique({
          where: { userId_weaponId: { userId, weaponId } },
        });
        if (!ownedW) throw new BadRequestException({ code: 'WEAPON_NOT_OWNED', message: 'weapon not owned' });
      }
    }

    await this.prisma.userLoadout.upsert({
      where: { userId },
      create: { userId, characterId, skinId, weaponId },
      update: { characterId, skinId, weaponId },
    });
    return { characterId, skinId, weaponId };
  }

  /**
   * Idempotent: grants every "Default" skin (one per character) to user as starters,
   * and sets a default loadout if missing.
   */
  async ensureStarterAndLoadout(userId: number): Promise<LoadoutDto> {
    // Only grant Default skins for STARTER characters.
    const starterChars = await this.prisma.character.findMany({
      where: { isActive: true, isStarter: true },
      select: { id: true },
    });
    const starterCharIds = starterChars.map((c) => c.id);
    const defaults = starterCharIds.length === 0
      ? []
      : await this.prisma.skin.findMany({
          where: {
            isActive: true,
            name: 'Default',
            priceUsd: null,
            characterId: { in: starterCharIds },
          },
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
    if (existing) return { characterId: existing.characterId, skinId: existing.skinId, weaponId: existing.weaponId ?? null };
    const first = defaults[0];
    if (!first) throw new Error('no starter character seeded');
    // Pick a starter weapon if any exists.
    const starterWeapon = await this.prisma.weapon.findFirst({
      where: { isActive: true, isStarter: true },
      orderBy: { id: 'asc' },
    });
    await this.prisma.userLoadout.create({
      data: { userId, characterId: first.characterId, skinId: first.id, weaponId: starterWeapon?.id ?? null },
    });
    this.log.log(`granted ${defaults.length} starter skins to user ${userId}`);
    return { characterId: first.characterId, skinId: first.id, weaponId: starterWeapon?.id ?? null };
  }

  /** Buy a skin with USD balance. Throws ALREADY_OWNED if duplicate. */
  async buySkin(userId: number, skinId: number): Promise<{ skinId: number; balance: string }> {
    const skin = await this.prisma.skin.findUnique({ where: { id: skinId } });
    if (!skin || !skin.isActive) {
      throw new NotFoundException({ code: 'SKIN_NOT_FOUND', message: 'skin not found' });
    }
    if (skin.priceUsd == null) {
      throw new BadRequestException({ code: 'NOT_FOR_SALE', message: 'skin not for sale' });
    }
    const price = new Prisma.Decimal(skin.priceUsd.toString());
    if (price.lte(0)) {
      throw new BadRequestException({ code: 'NOT_FOR_SALE', message: 'skin not for sale' });
    }

    // Pre-check ownership / balance outside ledger to give a nice error code.
    const owned = await this.prisma.userInventory.findUnique({
      where: { userId_skinId: { userId, skinId } },
    });
    if (owned) {
      throw new BadRequestException({ code: 'ALREADY_OWNED', message: 'skin already owned' });
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || new Prisma.Decimal(wallet.balance.toString()).lt(price)) {
      throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'not enough balance' });
    }

    // Debit user (idempotent on key) and credit system as commission/revenue.
    const idemUser = `shop:skin:${userId}:${skinId}`;
    const idemSystem = `shop:skin:${userId}:${skinId}:system`;
    await this.ledger.record({
      userId,
      amount: price.negated(),
      type: 'SHOP_PURCHASE',
      refType: 'skin',
      refId: String(skinId),
      idempotencyKey: idemUser,
      meta: { skinId, name: skin.name },
    });
    try {
      await this.ledger.record({
        userId: SYSTEM_USER_ID,
        amount: price,
        type: 'SHOP_PURCHASE',
        refType: 'skin',
        refId: String(skinId),
        idempotencyKey: idemSystem,
        meta: { fromUserId: userId, skinId },
      });
      await this.prisma.userInventory.create({
        data: { userId, skinId, source: 'purchase' },
      });
    } catch (err) {
      // P2002 means inventory was inserted by a duplicate concurrent request — accept it.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }

    const updated = await this.prisma.wallet.findUnique({ where: { userId } });
    return { skinId, balance: updated ? updated.balance.toString() : '0' };
  }

  /** List characters available in shop (any active, non-starter). priceUsd may be null = not yet for sale. */
  async listShopCharacters(): Promise<CharacterDto[]> {
    const all = await this.listCharacters();
    return all.filter((c) => !c.isStarter);
  }

  /** List weapons available in shop (any active, non-starter). */
  async listShopWeapons(): Promise<WeaponDto[]> {
    const rows = await this.prisma.weapon.findMany({
      where: { isActive: true, isStarter: false },
      orderBy: { id: 'asc' },
    });
    return rows.map((w) => this.toWeaponDto(w));
  }

  async buyCharacter(userId: number, characterId: number): Promise<{ characterId: number; balance: string }> {
    const char = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!char || !char.isActive) throw new NotFoundException({ code: 'CHARACTER_NOT_FOUND', message: 'character not found' });
    const price = char.priceUsd == null ? new Prisma.Decimal(0) : new Prisma.Decimal(char.priceUsd.toString());
    const isFree = price.lte(0);

    const owned = await this.prisma.userCharacter.findUnique({
      where: { userId_characterId: { userId, characterId } },
    });
    if (owned) throw new BadRequestException({ code: 'ALREADY_OWNED', message: 'character already owned' });

    if (!isFree) {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || new Prisma.Decimal(wallet.balance.toString()).lt(price)) {
        throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'not enough balance' });
      }
    }

    if (!isFree) {
      const idemUser = `shop:character:${userId}:${characterId}`;
      const idemSystem = `shop:character:${userId}:${characterId}:system`;
      await this.ledger.record({
        userId,
        amount: price.negated(),
        type: 'SHOP_PURCHASE',
        refType: 'character',
        refId: String(characterId),
        idempotencyKey: idemUser,
        meta: { characterId, name: char.name },
      });
      try {
        await this.ledger.record({
          userId: SYSTEM_USER_ID,
          amount: price,
          type: 'SHOP_PURCHASE',
          refType: 'character',
          refId: String(characterId),
          idempotencyKey: idemSystem,
          meta: { fromUserId: userId, characterId },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    try {
      await this.prisma.userCharacter.create({
        data: { userId, characterId, source: isFree ? 'free' : 'purchase' },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }

    const updated = await this.prisma.wallet.findUnique({ where: { userId } });
    return { characterId, balance: updated ? updated.balance.toString() : '0' };
  }

  async buyWeapon(userId: number, weaponId: number): Promise<{ weaponId: number; balance: string }> {
    const weapon = await this.prisma.weapon.findUnique({ where: { id: weaponId } });
    if (!weapon || !weapon.isActive) throw new NotFoundException({ code: 'WEAPON_NOT_FOUND', message: 'weapon not found' });
    const price = weapon.priceUsd == null ? new Prisma.Decimal(0) : new Prisma.Decimal(weapon.priceUsd.toString());
    const isFree = price.lte(0);

    const owned = await this.prisma.userWeapon.findUnique({
      where: { userId_weaponId: { userId, weaponId } },
    });
    if (owned) throw new BadRequestException({ code: 'ALREADY_OWNED', message: 'weapon already owned' });

    if (!isFree) {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || new Prisma.Decimal(wallet.balance.toString()).lt(price)) {
        throw new BadRequestException({ code: 'INSUFFICIENT_BALANCE', message: 'not enough balance' });
      }
      const idemUser = `shop:weapon:${userId}:${weaponId}`;
      const idemSystem = `shop:weapon:${userId}:${weaponId}:system`;
      await this.ledger.record({
        userId,
        amount: price.negated(),
        type: 'SHOP_PURCHASE',
        refType: 'weapon',
        refId: String(weaponId),
        idempotencyKey: idemUser,
        meta: { weaponId, name: weapon.name },
      });
      try {
        await this.ledger.record({
          userId: SYSTEM_USER_ID,
          amount: price,
          type: 'SHOP_PURCHASE',
          refType: 'weapon',
          refId: String(weaponId),
          idempotencyKey: idemSystem,
          meta: { fromUserId: userId, weaponId },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    try {
      await this.prisma.userWeapon.create({
        data: { userId, weaponId, source: isFree ? 'free' : 'purchase' },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    }

    const updated = await this.prisma.wallet.findUnique({ where: { userId } });
    return { weaponId, balance: updated ? updated.balance.toString() : '0' };
  }

  private toWeaponDto(w: {
    id: number;
    slug: string;
    name: string;
    spriteUrl: string | null;
    damage: number;
    fireRateMs: number;
    bulletSpeed: number;
    priceUsd: Prisma.Decimal | null;
    isStarter: boolean;
    isActive: boolean;
  }): WeaponDto {
    return {
      id: w.id,
      slug: w.slug,
      name: w.name,
      spriteUrl: w.spriteUrl ?? null,
      damage: w.damage,
      fireRateMs: w.fireRateMs,
      bulletSpeed: w.bulletSpeed,
      priceUsd: w.priceUsd ? w.priceUsd.toString() : null,
      isStarter: w.isStarter,
      isActive: w.isActive,
    };
  }

  private toSkinDto(s: {
    id: number;
    characterId: number;
    name: string;
    rarity: string;
    spriteSetUrl: string;
    tint: string | null;
    statModifiers: Prisma.JsonValue | null;
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
      priceUsd: s.priceUsd ? s.priceUsd.toString() : null,
      isActive: s.isActive,
    };
  }
}
