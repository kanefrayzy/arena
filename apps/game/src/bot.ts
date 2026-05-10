import type { PlayerInput, PlayerState, Sim } from './sim.js';
import type { Obstacle } from '@arena/protocol';
import { MAP_WIDTH, MAP_HEIGHT } from '@arena/shared';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

export interface BotConfig {
  difficulty: BotDifficulty;
  /** Bot stays idle (no inputs / no fire) until matchStart + startDelayMs.
   *  Honors the client-side 3-2-1-FIGHT countdown. */
  startDelayMs: number;
}

interface DifficultyParams {
  reactionMs: number;
  aimNoise: number;       // radians std-dev
  fireProb: number;
  dodgeMinMs: number;
  dodgeMaxMs: number;
  abilityUseProb: number;
  desiredRange: number;
  panicHpPct: number;
  speedScale: number;
}

const PRESETS: Record<BotDifficulty, DifficultyParams> = {
  easy: {
    reactionMs: 600, aimNoise: 0.45, fireProb: 0.32,
    dodgeMinMs: 800, dodgeMaxMs: 1500, abilityUseProb: 0.25,
    desiredRange: 320, panicHpPct: 0.25, speedScale: 0.85,
  },
  medium: {
    reactionMs: 320, aimNoise: 0.22, fireProb: 0.55,
    dodgeMinMs: 500, dodgeMaxMs: 1000, abilityUseProb: 0.65,
    desiredRange: 280, panicHpPct: 0.35, speedScale: 1.0,
  },
  hard: {
    reactionMs: 140, aimNoise: 0.07, fireProb: 0.85,
    dodgeMinMs: 280, dodgeMaxMs: 700, abilityUseProb: 0.92,
    desiredRange: 240, panicHpPct: 0.45, speedScale: 1.0,
  },
};

/**
 * Realistic bot AI with reaction time, aim noise, kiting, and ability-aware
 * tactics. Stays idle through the client countdown via `startDelayMs`.
 */
export class Bot {
  private inputSeq = 0;
  private nextDodgeAt = 0;
  private dodgeDir: 1 | -1 = 1;
  private firstSeenAt = 0;
  private startedAt = 0;
  private recentDamageAt = 0;
  private prevHp = -1;
  private params: DifficultyParams;

  constructor(
    private readonly sim: Sim,
    private readonly botId: number,
    private readonly humanId: number,
    private readonly config: BotConfig = { difficulty: 'medium', startDelayMs: 3500 },
  ) {
    this.params = PRESETS[config.difficulty] ?? PRESETS.medium;
  }

  step(now: number): void {
    const me = this.sim.players.get(this.botId);
    const target = this.sim.players.get(this.humanId);
    if (!me || !target || me.hp <= 0) return;

    if (this.startedAt === 0) this.startedAt = now;

    if (this.prevHp < 0) this.prevHp = me.hp;
    if (me.hp < this.prevHp) this.recentDamageAt = now;
    this.prevHp = me.hp;

    // Honor client countdown — idle no-op input keeps the AFK timer alive.
    const sinceStart = now - this.startedAt;
    if (sinceStart < this.config.startDelayMs) {
      this.sim.setInput(this.botId, {
        seq: ++this.inputSeq,
        dx: 0, dy: 0,
        angle: Math.atan2(target.y - me.y, target.x - me.x),
        fire: false, ability: false,
        receivedAt: now,
      });
      return;
    }

    if (this.firstSeenAt === 0) this.firstSeenAt = now;
    const reacted = now - this.firstSeenAt >= this.params.reactionMs;

    const dxRaw = target.x - me.x;
    const dyRaw = target.y - me.y;
    const dist = Math.hypot(dxRaw, dyRaw) || 1;
    const angleToTarget = Math.atan2(dyRaw, dxRaw);

    // Line-of-sight: shrink obstacles slightly so we don't refuse shots
    // through tiny corner gaps, but still respect every wall/crate/barrel.
    const hasLos = segmentClear(me.x, me.y, target.x, target.y, this.sim.obstacles);

    // Kiting at desired range with sideways dodge.
    const desired = this.params.desiredRange;
    const closing = dist > desired + 30 ? 1 : dist < desired - 30 ? -1 : 0;
    if (now > this.nextDodgeAt) {
      const span = this.params.dodgeMaxMs - this.params.dodgeMinMs;
      this.nextDodgeAt = now + this.params.dodgeMinMs + Math.random() * span;
      this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const perpX = -Math.sin(angleToTarget) * this.dodgeDir;
    const perpY = Math.cos(angleToTarget) * this.dodgeDir;

    // If line of sight is blocked, push toward the target more aggressively
    // and use perpendicular probing to find an angle without a wall in the
    // way. This stops the bot from standing in front of a crate firing into it.
    let mx: number;
    let my: number;
    if (!hasLos) {
      // Try sidestepping in current dodgeDir to peek past the obstacle.
      const peekX = (dxRaw / dist) * 0.6 + perpX * 1.0;
      const peekY = (dyRaw / dist) * 0.6 + perpY * 1.0;
      mx = peekX;
      my = peekY;
    } else {
      mx = (dxRaw / dist) * closing + perpX * 0.7;
      my = (dyRaw / dist) * closing + perpY * 0.7;
    }

    if (me.x < 80) mx += 1;
    if (me.x > MAP_WIDTH - 80) mx -= 1;
    if (me.y < 80) my += 1;
    if (me.y > MAP_HEIGHT - 80) my -= 1;

    const m = Math.hypot(mx, my);
    if (m > 0) {
      mx = (mx / m) * this.params.speedScale;
      my = (my / m) * this.params.speedScale;
    }

    const aimAngle = angleToTarget + (Math.random() - 0.5) * 2 * this.params.aimNoise;
    // Don't waste bullets on walls. Also gate ability LOS for projectile-like
    // abilities (bomb / triple_shot / slow); melee/self ones don't need LOS.
    const fire = reacted && hasLos && dist < 480 && Math.random() < this.params.fireProb;
    const ability = reacted
      && me.abilityCdLeftMs <= 0
      && this.shouldUseAbility(me, target, dist, now, hasLos);

    this.sim.setInput(this.botId, {
      seq: ++this.inputSeq,
      dx: mx, dy: my,
      angle: aimAngle,
      fire, ability,
      receivedAt: now,
    });
  }

  private shouldUseAbility(
    me: PlayerState,
    target: PlayerState,
    dist: number,
    now: number,
    hasLos: boolean,
  ): boolean {
    if (Math.random() > this.params.abilityUseProb) return false;
    const hpPct = me.hp / Math.max(1, me.maxHp);
    const recentHit = now - this.recentDamageAt < 1500;
    const range = me.abilityRange > 0 ? me.abilityRange : 200;
    const facingTarget = Math.abs(
      angleDiff(me.angle, Math.atan2(target.y - me.y, target.x - me.x)),
    ) < 0.35;

    switch (me.abilityType) {
      case 'heal':
        return hpPct < this.params.panicHpPct;
      case 'shield':
        return recentHit || hpPct < this.params.panicHpPct || dist < 250;
      case 'dash':
        if (hpPct < this.params.panicHpPct && dist < 280) return true;
        return dist > 350 && Math.random() < 0.35;
      case 'blink':
        // Use blink to escape low-HP corner OR to bypass a wall the bot can't shoot through.
        if (dist > 380) return true;
        if (!hasLos && dist < 500) return true;
        if (hpPct < this.params.panicHpPct && dist < 200) return true;
        return false;
      case 'bomb':
        return hasLos && dist <= range * 0.9;
      case 'triple_shot':
        return hasLos && dist < 420 && facingTarget;
      case 'slow':
        return hasLos && dist > 240 && dist < 600;
      default:
        return false;
    }
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Slab-method ray/segment vs AABB. Returns true when the segment from (x1,y1)
 *  to (x2,y2) does NOT intersect any obstacle (i.e. line of sight is clear). */
function segmentClear(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: ReadonlyArray<Obstacle>,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return true;
  for (const ob of obstacles) {
    // Shrink ~2 px so razor-thin grazes don't cancel valid line-up shots.
    const minX = ob.x + 2;
    const minY = ob.y + 2;
    const maxX = ob.x + ob.w - 2;
    const maxY = ob.y + ob.h - 2;
    if (maxX <= minX || maxY <= minY) continue;

    let t0 = 0;
    let t1 = 1;
    let blocked = true;

    if (dx === 0) {
      if (x1 < minX || x1 > maxX) { blocked = false; }
    } else {
      const txa = (minX - x1) / dx;
      const txb = (maxX - x1) / dx;
      const txn = Math.min(txa, txb);
      const txf = Math.max(txa, txb);
      if (txn > t0) t0 = txn;
      if (txf < t1) t1 = txf;
      if (t0 > t1) blocked = false;
    }

    if (blocked) {
      if (dy === 0) {
        if (y1 < minY || y1 > maxY) blocked = false;
      } else {
        const tya = (minY - y1) / dy;
        const tyb = (maxY - y1) / dy;
        const tyn = Math.min(tya, tyb);
        const tyf = Math.max(tya, tyb);
        if (tyn > t0) t0 = tyn;
        if (tyf < t1) t1 = tyf;
        if (t0 > t1) blocked = false;
      }
    }

    if (blocked && t1 >= 0 && t0 <= 1) return false;
  }
  return true;
}

const REALISTIC_BOT_NAMES = [
  'shadow_fox', 'pixel_warden', 'krait', 'nightowl', 'arc_wolf', 'orion',
  'tundra', 'voidstep', 'crimson', 'echo_one', 'spectre', 'glitchy',
  'kestrel', 'razorbyte', 'paperjet', 'mirage', 'icarus', 'ronin77',
  'flux', 'doppler', 'cobra', 'phantasm', 'reckoner', 'novak', 'zephyr',
  'kairo', 'mistral', 'tempest', 'hexbloom', 'lunar', 'volt', 'nyx',
];

export function pickBotName(): string {
  const base = REALISTIC_BOT_NAMES[Math.floor(Math.random() * REALISTIC_BOT_NAMES.length)] ?? 'player';
  if (Math.random() < 0.3) return `${base}${Math.floor(10 + Math.random() * 990)}`;
  return base;
}

export function buildBotPlayer(
  botUserId: number,
  spawn: { x: number; y: number },
  username = 'Bot',
): PlayerState {
  return {
    id: botUserId,
    characterId: 1,
    skinId: 1,
    username,
    isBot: true,
    x: spawn.x,
    y: spawn.y,
    angle: Math.PI,
    hp: 100,
    maxHp: 100,
    speed: 200,
    damage: 14,
    abilityCooldownMs: 8000,
    abilityCdLeftMs: 0,
    abilityType: 'dash',
    abilityDamageAmount: 0,
    abilityDurationMs: 0,
    abilityRange: 0,
    fireCooldownLeftMs: 0,
    dashLeftMs: 0,
    dashVx: 0,
    dashVy: 0,
    buffLeftMs: 0,
    lastInputSeq: 0,
    lastInputAt: Date.now(),
    buffs: [],
  };
}
