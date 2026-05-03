/**
 * Pure unit tests for character/skin stat composition.
 *
 * Mirrors the formulas used in MatchCreationService.computeStats — base stats
 * from Character × percentage modifiers from Skin.statModifiers.
 */
import { describe, it, expect } from 'vitest';

interface CharacterRow {
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  weaponType: string;
  abilityType: string | null;
  abilityCooldownS: number;
}
interface SkinRow {
  statModifiers: { hpPct?: number; speedPct?: number; damagePct?: number } | null;
}

function computeStats(char: CharacterRow, skin: SkinRow) {
  const mods = skin.statModifiers ?? {};
  const hp = Math.max(1, Math.round(char.baseHp * (1 + (mods.hpPct ?? 0) / 100)));
  const speed = Math.max(50, char.baseSpeed * (1 + (mods.speedPct ?? 0) / 100));
  const damage = Math.max(1, Math.round(char.baseDamage * (1 + (mods.damagePct ?? 0) / 100)));
  return { hp, speed, damage, weaponType: char.weaponType, abilityType: char.abilityType, abilityCooldownMs: char.abilityCooldownS * 1000 };
}

const SHOOTER: CharacterRow = { baseHp: 100, baseSpeed: 220, baseDamage: 18, weaponType: 'ranged', abilityType: 'dash', abilityCooldownS: 8 };
const TANK: CharacterRow = { baseHp: 160, baseSpeed: 160, baseDamage: 22, weaponType: 'rocket', abilityType: 'shield', abilityCooldownS: 12 };
const SCOUT: CharacterRow = { baseHp: 80, baseSpeed: 270, baseDamage: 14, weaponType: 'shotgun', abilityType: 'dash', abilityCooldownS: 6 };

describe('character stat composition', () => {
  it('cosmetic-only skin (no modifiers) yields base stats', () => {
    const out = computeStats(SHOOTER, { statModifiers: null });
    expect(out).toEqual({ hp: 100, speed: 220, damage: 18, weaponType: 'ranged', abilityType: 'dash', abilityCooldownMs: 8000 });
  });

  it('+10% hp skin on Tank: 160 → 176', () => {
    const out = computeStats(TANK, { statModifiers: { hpPct: 10 } });
    expect(out.hp).toBe(176);
    expect(out.damage).toBe(22);
    expect(out.speed).toBeCloseTo(160);
  });

  it('-15% speed skin on Scout: 270 → 229.5', () => {
    const out = computeStats(SCOUT, { statModifiers: { speedPct: -15 } });
    expect(out.speed).toBeCloseTo(229.5);
  });

  it('clamps lower bounds (hp >= 1, speed >= 50, damage >= 1)', () => {
    const out = computeStats(SHOOTER, { statModifiers: { hpPct: -200, speedPct: -100, damagePct: -200 } });
    expect(out.hp).toBe(1);
    expect(out.speed).toBe(50);
    expect(out.damage).toBe(1);
  });

  it('all three characters distinct from each other', () => {
    const a = computeStats(SHOOTER, { statModifiers: null });
    const b = computeStats(TANK, { statModifiers: null });
    const c = computeStats(SCOUT, { statModifiers: null });
    expect(a.hp).not.toBe(b.hp);
    expect(b.hp).not.toBe(c.hp);
    expect(a.speed).not.toBe(b.speed);
    expect(b.weaponType).not.toBe(a.weaponType);
    expect(c.weaponType).not.toBe(b.weaponType);
  });
});
