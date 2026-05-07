import type { PlayerInput, PlayerState, Sim } from './sim.js';
import { MAP_WIDTH, MAP_HEIGHT } from '@arena/shared';

/**
 * Simple bot AI for FREE mode opponent.
 * Strategy: face the human player, keep mid-range distance (~280px),
 * dodge sideways, fire when in line of sight, dash randomly.
 */
export class Bot {
  private inputSeq = 0;
  private nextDodgeAt = 0;
  private dodgeDir: 1 | -1 = 1;

  constructor(
    private readonly sim: Sim,
    private readonly botId: number,
    private readonly humanId: number,
  ) {}

  step(now: number): void {
    const me = this.sim.players.get(this.botId);
    const target = this.sim.players.get(this.humanId);
    if (!me || !target || me.hp <= 0) return;

    const dxRaw = target.x - me.x;
    const dyRaw = target.y - me.y;
    const dist = Math.hypot(dxRaw, dyRaw) || 1;
    const angle = Math.atan2(dyRaw, dxRaw);

    // Move toward / away to keep ~280 units
    const desired = 280;
    const closing = dist > desired + 30 ? 1 : dist < desired - 30 ? -1 : 0;

    // Sideways dodge
    if (now > this.nextDodgeAt) {
      this.nextDodgeAt = now + 600 + Math.random() * 800;
      this.dodgeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const perpX = -Math.sin(angle) * this.dodgeDir;
    const perpY = Math.cos(angle) * this.dodgeDir;

    let mx = (dxRaw / dist) * closing + perpX * 0.7;
    let my = (dyRaw / dist) * closing + perpY * 0.7;

    // Stay away from edges
    if (me.x < 80) mx += 1;
    if (me.x > MAP_WIDTH - 80) mx -= 1;
    if (me.y < 80) my += 1;
    if (me.y > MAP_HEIGHT - 80) my -= 1;

    const m = Math.hypot(mx, my) || 1;
    mx /= m;
    my /= m;

    // Fire when in range, with reaction-time gating so the bot isn't perfect.
    // Add larger aim noise to make it beatable.
    const fire = dist < 480 && Math.random() < 0.55;

    // Random dash escape if low hp
    const ability = me.hp < 35 && Math.random() < 0.02;

    const input: PlayerInput = {
      seq: ++this.inputSeq,
      dx: mx,
      dy: my,
      angle: angle + (Math.random() - 0.5) * 0.35, // ±0.17 rad noise (~10°)
      fire,
      ability,
      receivedAt: now,
    };
    this.sim.setInput(this.botId, input);
  }
}

export function buildBotPlayer(botUserId: number, spawn: { x: number; y: number }): PlayerState {
  return {
    id: botUserId,
    characterId: 1,
    skinId: 1,
    username: 'Bot',
    isBot: true,
    x: spawn.x,
    y: spawn.y,
    angle: Math.PI, // facing left initially
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
