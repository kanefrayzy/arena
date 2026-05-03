/**
 * Database seed.
 *
 * Creates:
 *   - System user  (id=1, role=ADMIN, isBanned=true) — used for COMMISSION/ADJUSTMENT ledger entries
 *   - Bot user     (id=2, role=PLAYER, meta.hidden=true) — used in FREE-mode bot matches
 *   - Admin user   (from env)
 *   - 3 characters: shooter / tank / scout
 *   - 6 skins (1 base + 1 cosmetic per character)
 *   - 3 STAKE rooms (1$, 5$, 10$) + 1 CASUAL room + 1 FREE room
 *   - Default Settings (tickRate, bot_in_free, casualEnabled, etc.)
 */

import { PrismaClient, Role, RoomMode, WinCondition } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function ensureUser(opts: {
  id: number;
  email: string;
  username: string;
  role: Role;
  password: string;
  isBanned: boolean;
  meta?: Record<string, unknown>;
}) {
  const passwordHash = await argon2.hash(opts.password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { id: opts.id },
    update: {
      email: opts.email,
      username: opts.username,
      role: opts.role,
      isBanned: opts.isBanned,
      meta: opts.meta ?? null,
    },
    create: {
      id: opts.id,
      email: opts.email,
      username: opts.username,
      passwordHash,
      role: opts.role,
      isBanned: opts.isBanned,
      meta: opts.meta ?? null,
      acceptedTosAt: new Date(),
      wallet: { create: {} },
      stats: { create: {} },
    },
  });
}

async function main() {
  // ---------- System users ----------
  await ensureUser({
    id: 1,
    email: 'system@internal',
    username: 'system',
    role: Role.ADMIN,
    password: crypto.randomUUID(), // unguessable, account is banned anyway
    isBanned: true,
    meta: { system: true, hidden: true },
  });

  await ensureUser({
    id: 2,
    email: 'bot@internal',
    username: 'Bot',
    role: Role.PLAYER,
    password: crypto.randomUUID(),
    isBanned: true,
    meta: { bot: true, hidden: true },
  });

  // Bump the autoincrement sequence past reserved system ids.
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"User"', 'id'), GREATEST(2, (SELECT COALESCE(MAX(id),0) FROM "User")));`,
  );

  // ---------- Admin user ----------
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@arena1v1.local';
  const adminUsername = process.env.ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD_INITIAL ?? 'ChangeMeNow!2026';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash: await argon2.hash(adminPassword, { type: argon2.argon2id }),
        role: Role.ADMIN,
        acceptedTosAt: new Date(),
        wallet: { create: {} },
        stats: { create: {} },
      },
    });
    console.log(`✓ admin user created: ${adminEmail}`);
  }

  // ---------- Characters ----------
  const characters = [
    {
      slug: 'shooter',
      name: 'Стрелок',
      baseHp: 100,
      baseSpeed: 220,
      baseDamage: 18,
      weaponType: 'ranged',
      abilityType: 'dash',
      abilityCooldownS: 8,
    },
    {
      slug: 'tank',
      name: 'Танк',
      baseHp: 160,
      baseSpeed: 160,
      baseDamage: 22,
      weaponType: 'rocket',
      abilityType: 'shield',
      abilityCooldownS: 12,
    },
    {
      slug: 'scout',
      name: 'Скаут',
      baseHp: 80,
      baseSpeed: 270,
      baseDamage: 14,
      weaponType: 'shotgun',
      abilityType: 'dash',
      abilityCooldownS: 6,
    },
  ];

  const charBySlug = new Map<string, number>();
  for (const c of characters) {
    const row = await prisma.character.upsert({
      where: { slug: c.slug },
      update: c,
      create: c,
    });
    charBySlug.set(c.slug, row.id);
  }

  // ---------- Skins (1 base + 1 cosmetic per character = 6) ----------
  const skins = [
    { slug: 'shooter-default', characterSlug: 'shooter', name: 'Default', rarity: 'common', tint: '#ffffff' },
    { slug: 'shooter-neon', characterSlug: 'shooter', name: 'Neon', rarity: 'rare', tint: '#00e0ff', priceCoin: 500 },
    { slug: 'tank-default', characterSlug: 'tank', name: 'Default', rarity: 'common', tint: '#ffffff' },
    { slug: 'tank-gold', characterSlug: 'tank', name: 'Gold', rarity: 'epic', tint: '#ffcc33', priceCoin: 1500 },
    { slug: 'scout-default', characterSlug: 'scout', name: 'Default', rarity: 'common', tint: '#ffffff' },
    { slug: 'scout-shadow', characterSlug: 'scout', name: 'Shadow', rarity: 'rare', tint: '#444466', priceCoin: 500 },
  ] as const;

  for (const s of skins) {
    const characterId = charBySlug.get(s.characterSlug);
    if (!characterId) continue;
    // unique by (characterId, name) — find or create.
    const existing = await prisma.skin.findFirst({
      where: { characterId, name: s.name },
    });
    if (!existing) {
      await prisma.skin.create({
        data: {
          characterId,
          name: s.name,
          rarity: s.rarity,
          spriteSetUrl: `/assets/skins/${s.slug}.json`,
          tint: s.tint,
          priceCoin: 'priceCoin' in s ? s.priceCoin : null,
        },
      });
    }
  }

  // ---------- Rooms ----------
  const rooms = [
    { name: 'Free for All', mode: RoomMode.FREE, stakeUsd: null, commissionPct: 0, minBalanceRequired: false },
    { name: 'Casual', mode: RoomMode.CASUAL, stakeUsd: '0.03', commissionPct: 0, minBalanceRequired: true },
    { name: 'Stake $1', mode: RoomMode.STAKE, stakeUsd: '1', commissionPct: 20, minBalanceRequired: true },
    { name: 'Stake $5', mode: RoomMode.STAKE, stakeUsd: '5', commissionPct: 20, minBalanceRequired: true },
    { name: 'Stake $10', mode: RoomMode.STAKE, stakeUsd: '10', commissionPct: 20, minBalanceRequired: true },
  ] as const;

  for (const r of rooms) {
    const existing = await prisma.room.findFirst({ where: { name: r.name } });
    if (!existing) {
      await prisma.room.create({
        data: {
          name: r.name,
          mode: r.mode,
          stakeUsd: r.stakeUsd,
          commissionPct: r.commissionPct,
          matchDurationS: 120,
          winCondition: WinCondition.KILL,
          isActive: true,
          minBalanceRequired: r.minBalanceRequired,
        },
      });
    }
  }

  // ---------- Default settings ----------
  const defaultSettings: Array<{ key: string; value: unknown }> = [
    { key: 'gameplay.tickRate', value: 30 },
    { key: 'gameplay.bot_in_free', value: true },
    { key: 'rooms.casualEnabled', value: true },
    { key: 'wallet.auto_withdrawal', value: false },
    { key: 'legal.minAge', value: 18 },
    { key: 'legal.blockedCountries', value: [] },
    { key: 'legal.kycRequiredFromUsd', value: 1000 },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value as never },
      create: { key: s.key, value: s.value as never },
    });
  }

  // ---------- Backfill: starter skins + loadout for ALL existing users ----------
  const allUsers = await prisma.user.findMany({ select: { id: true } });
  const defaultSkins = await prisma.skin.findMany({
    where: { isActive: true, name: 'Default', priceCoin: null, priceUsd: null },
    orderBy: { characterId: 'asc' },
  });
  if (defaultSkins.length > 0) {
    let granted = 0;
    let loadouts = 0;
    for (const u of allUsers) {
      // Skip system + bot users (ids 1, 2 are reserved for SYSTEM/BOT and don't play).
      if (u.id === 1 || u.id === 2) continue;
      for (const skin of defaultSkins) {
        try {
          await prisma.userInventory.create({
            data: { userId: u.id, skinId: skin.id, source: 'starter' },
          });
          granted++;
        } catch (err) {
          // P2002 unique violation = already owned, ignore.
          if (
            !(err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002')
          ) {
            throw err;
          }
        }
      }
      const existing = await prisma.userLoadout.findUnique({ where: { userId: u.id } });
      if (!existing) {
        const first = defaultSkins[0];
        await prisma.userLoadout.create({
          data: { userId: u.id, characterId: first.characterId, skinId: first.id },
        });
        loadouts++;
      }
    }
    console.log(`✓ starter backfill: ${granted} skins granted, ${loadouts} loadouts created`);
  }

  console.log('✓ seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
