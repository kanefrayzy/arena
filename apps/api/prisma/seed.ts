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

  // ---------- Abilities ----------
  const abilitySeedData = [
    { slug: 'dash', name: 'Рывок', description: 'Быстрый рывок в направлении движения.', type: 'dash', cooldownMs: 8000, damageAmount: 0, durationMs: 0, range: 200 },
    { slug: 'blink', name: 'Телепорт', description: 'Мгновенный прыжок на 300 пикселей в сторону прицела.', type: 'blink', cooldownMs: 10000, damageAmount: 0, durationMs: 0, range: 300 },
    { slug: 'shield', name: 'Щит', description: 'Временный щит на 1.5 секунды, блокирующий входящий урон.', type: 'shield', cooldownMs: 12000, damageAmount: 0, durationMs: 1500, range: 0 },
    { slug: 'slow', name: 'Замедление', description: 'Замедляет противника на 2 секунды (скорость ×0.4).', type: 'slow', cooldownMs: 10000, damageAmount: 0, durationMs: 2000, range: 0 },
    { slug: 'triple_shot', name: 'Тройной выстрел', description: 'Выпускает три пули веером одновременно.', type: 'triple_shot', cooldownMs: 7000, damageAmount: 0, durationMs: 0, range: 0 },
    { slug: 'bomb', name: 'Бомба', description: 'Взрыв в радиусе 200 пикселей, наносящий 50 урона.', type: 'bomb', cooldownMs: 14000, damageAmount: 50, durationMs: 0, range: 200 },
    { slug: 'heal', name: 'Лечение', description: 'Восстанавливает 30 HP.', type: 'heal', cooldownMs: 15000, damageAmount: 30, durationMs: 0, range: 0 },
  ];
  for (const a of abilitySeedData) {
    await prisma.ability.upsert({
      where: { slug: a.slug },
      update: { name: a.name, description: a.description, type: a.type, cooldownMs: a.cooldownMs, damageAmount: a.damageAmount, durationMs: a.durationMs, range: a.range },
      create: a,
    });
  }

  // ---------- Characters ----------
  // Single base character — the only one that's a starter (granted to everyone).
  // All other content is created via Admin → Content.
  const dashAbility = await prisma.ability.findUnique({ where: { slug: 'dash' } });

  const charData = {
    slug: 'default',
    name: 'Боец',
    baseHp: 100,
    baseSpeed: 220,
    baseDamage: 18,
    weaponType: 'ranged',
    isStarter: true,
    ...(dashAbility ? { abilityId: dashAbility.id } : {}),
  };

  const charBySlug = new Map<string, number>();
  const row = await prisma.character.upsert({
    where: { slug: 'default' },
    update: charData,
    create: charData,
  });
  charBySlug.set('default', row.id);

  // Deactivate ONLY known legacy seed slugs (shooter/tank/scout).
  // Do NOT touch admin-created characters — they must persist across redeploys.
  const legacySlugs = ['shooter', 'tank', 'scout'];
  const legacy = await prisma.character.findMany({
    where: { slug: { in: legacySlugs } },
    select: { id: true },
  });
  if (legacy.length > 0) {
    await prisma.character.updateMany({
      where: { slug: { in: legacySlugs } },
      data: { isActive: false, isStarter: false },
    });
    await prisma.skin.updateMany({
      where: { characterId: { in: legacy.map((r) => r.id) } },
      data: { isActive: false },
    });
  }

  // Recovery: reactivate admin-created characters that were wrongfully
  // deactivated by previous seed versions (anything not in legacy list).
  await prisma.character.updateMany({
    where: { slug: { notIn: legacySlugs }, isActive: false },
    data: { isActive: true },
  });
  const reactivated = await prisma.character.findMany({
    where: { slug: { notIn: legacySlugs } },
    select: { id: true },
  });
  if (reactivated.length > 0) {
    await prisma.skin.updateMany({
      where: { characterId: { in: reactivated.map((r) => r.id) }, isActive: false },
      data: { isActive: true },
    });
  }

  // ---------- Skins (only one Default skin for the base character) ----------
  const skins = [
    { slug: 'default-default', characterSlug: 'default', name: 'Default', rarity: 'common', tint: '#ffffff' },
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
          priceUsd: 'priceUsd' in s ? s.priceUsd : null,
        },
      });
    }
  }

  // ---------- Weapons ----------
  const weapons = [
    { slug: 'pistol', name: 'Pistol', isStarter: true, damage: 18, fireRateMs: 280, bulletSpeed: 600, priceUsd: null },
    { slug: 'smg', name: 'SMG', isStarter: false, damage: 12, fireRateMs: 120, bulletSpeed: 720, priceUsd: '5' },
    { slug: 'rifle', name: 'Rifle', isStarter: false, damage: 28, fireRateMs: 360, bulletSpeed: 800, priceUsd: '10' },
  ] as const;
  for (const w of weapons) {
    await prisma.weapon.upsert({
      where: { slug: w.slug },
      update: {
        name: w.name,
        isStarter: w.isStarter,
        damage: w.damage,
        fireRateMs: w.fireRateMs,
        bulletSpeed: w.bulletSpeed,
        priceUsd: w.priceUsd,
      },
      create: {
        slug: w.slug,
        name: w.name,
        isStarter: w.isStarter,
        damage: w.damage,
        fireRateMs: w.fireRateMs,
        bulletSpeed: w.bulletSpeed,
        priceUsd: w.priceUsd,
      },
    });
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
    { key: 'gameplay.cup_win', value: 25 },
    { key: 'gameplay.cup_loss', value: 15 },
    { key: 'rooms.casualEnabled', value: true },
    { key: 'wallet.auto_withdrawal', value: false },
    { key: 'legal.minAge', value: 18 },
    { key: 'legal.blockedCountries', value: [] },
    { key: 'legal.kycRequiredFromUsd', value: 1000 },
    // Bots
    { key: 'bots.enabled', value: true },
    { key: 'bots.difficulty', value: 'medium' },
    { key: 'bots.queue_min_wait_s', value: 30 },
    { key: 'bots.queue_max_wait_s', value: 40 },
    // SEO
    { key: 'seo.site_name', value: 'Arena1v1' },
    { key: 'seo.title', value: 'Arena1v1 — Skill PvP 1 на 1 на реальные деньги' },
    { key: 'seo.description', value: 'Браузерная PvP-игра 1 на 1. Skill-based, никакого RNG. Играй и зарабатывай реальные деньги.' },
    { key: 'seo.keywords', value: 'arena, pvp, 1v1, skill, browser game, real money, esports' },
    { key: 'seo.og_image_url', value: '' },
    { key: 'seo.twitter_handle', value: '' },
    { key: 'seo.canonical_url', value: '' },
    { key: 'seo.theme_color', value: '#1a1450' },
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
    where: {
      isActive: true,
      name: 'Default',
      priceUsd: null,
      character: { isStarter: true, isActive: true },
    },
    orderBy: { characterId: 'asc' },
  });

  // Cleanup: revoke 'starter' inventory entries for skins that no longer belong to a starter character.
  const badSkins = await prisma.skin.findMany({
    where: {
      OR: [
        { isActive: false },
        { character: { isStarter: false } },
        { character: { isActive: false } },
      ],
    },
    select: { id: true },
  });
  const badSkinIds = badSkins.map((s) => s.id);
  const cleanup = badSkinIds.length === 0
    ? { count: 0 }
    : await prisma.userInventory.deleteMany({
        where: { source: 'starter', skinId: { in: badSkinIds } },
      });
  if (cleanup.count > 0) console.log(`✓ revoked ${cleanup.count} stale starter skins`);
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
      } else {
        // If existing loadout points to a now-inactive skin/char, redirect to the base default.
        const skin = await prisma.skin.findUnique({ where: { id: existing.skinId } });
        const char = await prisma.character.findUnique({ where: { id: existing.characterId } });
        if (!skin?.isActive || !char?.isActive) {
          const first = defaultSkins[0];
          await prisma.userLoadout.update({
            where: { userId: u.id },
            data: { characterId: first.characterId, skinId: first.id },
          });
          loadouts++;
        }
      }
    }
    console.log(`✓ starter backfill: ${granted} skins granted, ${loadouts} loadouts created`);
  }

  // ---------- Payment methods (idempotent) ----------
  const paymentMethods = [
    { slug: 'betra_card_azn', label: 'Карта (AZN)', kind: 'betra_card', currency: 'AZN', isDeposit: true, isWithdraw: false, sortOrder: 10 },
    { slug: 'betra_card_rub', label: 'Карта (RUB)', kind: 'betra_card', currency: 'RUB', isDeposit: true, isWithdraw: false, sortOrder: 11 },
    { slug: 'betra_card_kzt', label: 'Карта (KZT)', kind: 'betra_card', currency: 'KZT', isDeposit: true, isWithdraw: false, sortOrder: 12 },
    { slug: 'betra_payout_azn', label: 'Выплата на карту (AZN)', kind: 'betra_payout', currency: 'AZN', isDeposit: false, isWithdraw: true, sortOrder: 20 },
    { slug: 'betra_payout_kzt', label: 'Выплата на карту (KZT)', kind: 'betra_payout', currency: 'KZT', isDeposit: false, isWithdraw: true, sortOrder: 21 },
    { slug: 'betra_payout_usdt', label: 'Выплата USDT (TRC20)', kind: 'betra_payout', currency: 'USDT', isDeposit: false, isWithdraw: true, sortOrder: 22 },
    { slug: 'west_btc', label: 'Bitcoin', kind: 'westwallet', currency: 'BTC', isDeposit: true, isWithdraw: true, sortOrder: 30 },
    { slug: 'west_usdt_trc', label: 'USDT TRC-20', kind: 'westwallet', currency: 'USDTTRC', isDeposit: true, isWithdraw: true, sortOrder: 31 },
    { slug: 'west_eth', label: 'Ethereum', kind: 'westwallet', currency: 'ETH', isDeposit: true, isWithdraw: true, sortOrder: 32 },
    { slug: 'west_ltc', label: 'Litecoin', kind: 'westwallet', currency: 'LTC', isDeposit: true, isWithdraw: true, sortOrder: 33 },
  ] as const;
  for (const pm of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { slug: pm.slug },
      update: {}, // do not overwrite admin edits
      create: pm,
    });
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
