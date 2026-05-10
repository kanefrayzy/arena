import type { PlayerInput, PlayerState, Sim } from './sim.js';
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

    let mx = (dxRaw / dist) * closing + perpX * 0.7;
    let my = (dyRaw / dist) * closing + perpY * 0.7;

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
    const fire = reacted && dist < 480 && Math.random() < this.params.fireProb;
    const ability = reacted
      && me.abilityCdLeftMs <= 0
      && this.shouldUseAbility(me, target, dist, now);

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
        if (dist > 380) return true;
        if (hpPct < this.params.panicHpPct && dist < 200) return true;
        return false;
      case 'bomb':
        return dist <= range * 0.9;
      case 'triple_shot':
        return dist < 420 && facingTarget;
      case 'slow':
        return dist > 240 && dist < 600;
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
