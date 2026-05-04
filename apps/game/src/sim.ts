/**
 * Pure game simulation — server-authoritative.
 *
 * Coordinate system: world units = pixels. Origin top-left, Y down.
 * Map size: 1280x720.
 */

import {
  MAP_WIDTH,
  MAP_HEIGHT,
  PLAYER_RADIUS,
  BULLET_RADIUS,
  AFK_TIMEOUT_MS,
  DEFAULT_MATCH_DURATION_MS,
} from '@arena/shared';
import type { SnapshotEvent, Obstacle } from '@arena/protocol';

export interface PlayerInput {
  seq: number;
  dx: number;
  dy: number;
  angle: number;
  fire: boolean;
  ability: boolean;
  receivedAt: number;
}

export interface PlayerState {
  id: number;
  characterId: number;
  skinId: number;
  username: string;
  isBot: boolean;

  x: number;
  y: number;
  angle: number;

  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  abilityCooldownMs: number;
  abilityCdLeftMs: number;

  fireCooldownLeftMs: number;
  dashLeftMs: number;
  dashVx: number;
  dashVy: number;

  lastInputSeq: number;
  lastInputAt: number; // ms

  buffs: string[];
}

export interface BulletState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttlMs: number;
  damage: number;
}

export interface MatchInitOpts {
  matchId: string;
  durationMs?: number;
  players: [PlayerState, PlayerState];
  obstacles?: Obstacle[];
}

export type EndReason = 'kill' | 'timeout' | 'disconnect' | 'draw';

export interface MatchResult {
  winnerId: number | null;
  reason: EndReason;
  durationMs: number;
  score: Record<string, number>;
}

const FIRE_COOLDOWN_MS = 250;
const BULLET_SPEED = 600;
const BULLET_TTL_MS = 1500;
const BULLET_DAMAGE = 20;
const DASH_DURATION_MS = 200;
const DASH_SPEED = 720; // adds on top of base
const DASH_CD_MS = 8_000;

export class Sim {
  matchId: string;
  startedAt = 0;
  elapsedMs = 0;
  durationMs: number;
  tick = 0;
  bulletSeq = 1;
  players: Map<number, PlayerState> = new Map();
  bullets: Map<number, BulletState> = new Map();
  pendingInputs: Map<number, PlayerInput> = new Map();
  events: SnapshotEvent[] = [];
  finished = false;
  result: MatchResult | null = null;
  /** Players that have already dropped out (disconnect). */
  droppedPlayers: Set<number> = new Set();
  obstacles: Obstacle[] = [];

  constructor(opts: MatchInitOpts) {
    this.matchId = opts.matchId;
    this.durationMs = opts.durationMs ?? DEFAULT_MATCH_DURATION_MS;
    for (const p of opts.players) {
      this.players.set(p.id, p);
    }
    this.obstacles = sanitizeObstacles(opts.obstacles ?? []);
  }

  start(now: number): void {
    this.startedAt = now;
  }

  setInput(playerId: number, input: PlayerInput): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (input.seq <= p.lastInputSeq) return;
    this.pendingInputs.set(playerId, input);
    p.lastInputAt = input.receivedAt;
  }

  markDisconnect(playerId: number, now: number): void {
    if (this.finished) return;
    if (this.droppedPlayers.has(playerId)) return;
    this.droppedPlayers.add(playerId);
    // The disconnected player loses immediately.
    const winner = [...this.players.values()].find((p) => p.id !== playerId);
    this.finish('disconnect', winner?.id ?? null, now);
  }

  /** Reset the AFK timer for a player (e.g. on reconnect). */
  refreshInputAt(playerId: number, now: number): void {
    const p = this.players.get(playerId);
    if (p) p.lastInputAt = now;
  }

  /** Advance simulation by `dt` ms. Mutates state, populates `events`. */
  step(dt: number, now: number): void {
    if (this.finished) return;
    this.tick++;
    this.elapsedMs += dt;
    this.events = [];
    const dtS = dt / 1000;

    // Apply inputs
    for (const [pid, input] of this.pendingInputs) {
      const p = this.players.get(pid);
      if (!p) continue;
      p.lastInputSeq = input.seq;
      p.angle = input.angle;
      // Clamp dx/dy to unit
      const mag = Math.hypot(input.dx, input.dy);
      const ndx = mag > 1 ? input.dx / mag : input.dx;
      const ndy = mag > 1 ? input.dy / mag : input.dy;
      this.movePlayer(p, ndx * p.speed * dtS, ndy * p.speed * dtS);

      // Fire
      if (input.fire && p.fireCooldownLeftMs <= 0 && p.hp > 0) {
        this.spawnBullet(p);
        p.fireCooldownLeftMs = FIRE_COOLDOWN_MS;
      }

      // Ability — dash
      if (input.ability && p.abilityCdLeftMs <= 0 && p.hp > 0) {
        p.abilityCdLeftMs = DASH_CD_MS;
        p.dashLeftMs = DASH_DURATION_MS;
        p.dashVx = Math.cos(p.angle) * DASH_SPEED;
        p.dashVy = Math.sin(p.angle) * DASH_SPEED;
        p.buffs = ['dash'];
        this.events.push({ kind: 'ability', who: p.id, type: 'dash' });
      }
    }
    this.pendingInputs.clear();

    // Cooldowns + dash motion
    for (const p of this.players.values()) {
      if (p.fireCooldownLeftMs > 0) p.fireCooldownLeftMs = Math.max(0, p.fireCooldownLeftMs - dt);
      if (p.abilityCdLeftMs > 0) p.abilityCdLeftMs = Math.max(0, p.abilityCdLeftMs - dt);
      if (p.dashLeftMs > 0) {
        this.movePlayer(p, p.dashVx * dtS, p.dashVy * dtS);
        p.dashLeftMs = Math.max(0, p.dashLeftMs - dt);
        if (p.dashLeftMs === 0) {
          p.buffs = [];
          p.dashVx = 0;
          p.dashVy = 0;
        }
      }
      // Clamp to map bounds
      p.x = clamp(p.x, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      p.y = clamp(p.y, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
    }

    // Bullets
    for (const [bid, b] of this.bullets) {
      b.x += b.vx * dtS;
      b.y += b.vy * dtS;
      b.ttlMs -= dt;
      if (
        b.ttlMs <= 0 ||
        b.x < -BULLET_RADIUS ||
        b.x > MAP_WIDTH + BULLET_RADIUS ||
        b.y < -BULLET_RADIUS ||
        b.y > MAP_HEIGHT + BULLET_RADIUS
      ) {
        this.bullets.delete(bid);
        continue;
      }
      // Collision with obstacles → bullet absorbed
      let absorbed = false;
      for (const ob of this.obstacles) {
        if (circleAabbHit(b.x, b.y, BULLET_RADIUS, ob)) {
          this.events.push({ kind: 'hit', victim: 0, attacker: b.ownerId, dmg: 0, x: b.x, y: b.y, obstacle: true });
          this.bullets.delete(bid);
          absorbed = true;
          break;
        }
      }
      if (absorbed) continue;
      // Collision with players
      for (const target of this.players.values()) {
        if (target.id === b.ownerId) continue;
        if (target.hp <= 0) continue;
        const r = PLAYER_RADIUS + BULLET_RADIUS;
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        if (dx * dx + dy * dy <= r * r) {
          target.hp = Math.max(0, target.hp - b.damage);
          this.events.push({
            kind: 'hit',
            victim: target.id,
            attacker: b.ownerId,
            dmg: b.damage,
            x: target.x,
            y: target.y,
          });
          this.bullets.delete(bid);
          if (target.hp <= 0) {
            this.events.push({ kind: 'death', who: target.id });
            this.finish('kill', b.ownerId, now);
            return;
          }
          break;
        }
      }
    }

    // AFK detection (only if match has been running >2s)
    if (this.elapsedMs > 2000) {
      for (const p of this.players.values()) {
        if (p.isBot) continue;
        if (now - p.lastInputAt > AFK_TIMEOUT_MS) {
          const winner = [...this.players.values()].find((o) => o.id !== p.id);
          this.finish('disconnect', winner?.id ?? null, now);
          return;
        }
      }
    }

    // Match timeout — TIMEOUT_HP
    if (this.elapsedMs >= this.durationMs) {
      const arr = [...this.players.values()];
      const [a, b] = arr;
      if (!a || !b) {
        this.finish('timeout', null, now);
        return;
      }
      if (a.hp > b.hp) this.finish('timeout', a.id, now);
      else if (b.hp > a.hp) this.finish('timeout', b.id, now);
      else this.finish('draw', null, now);
    }
  }

  private spawnBullet(owner: PlayerState): void {
    const id = this.bulletSeq++;
    const b: BulletState = {
      id,
      ownerId: owner.id,
      x: owner.x + Math.cos(owner.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 1),
      y: owner.y + Math.sin(owner.angle) * (PLAYER_RADIUS + BULLET_RADIUS + 1),
      vx: Math.cos(owner.angle) * BULLET_SPEED,
      vy: Math.sin(owner.angle) * BULLET_SPEED,
      ttlMs: BULLET_TTL_MS,
      damage: BULLET_DAMAGE,
    };
    this.bullets.set(id, b);
    this.events.push({ kind: 'shoot', who: owner.id, x: b.x, y: b.y });
  }

  /** Move a player by (dx,dy) with axis-separated obstacle resolution. */
  private movePlayer(p: PlayerState, dx: number, dy: number): void {
    // X axis
    p.x += dx;
    for (const ob of this.obstacles) {
      const r = circleAabbResolve(p.x, p.y, PLAYER_RADIUS, ob);
      if (r) p.x += r.x;
    }
    // Y axis
    p.y += dy;
    for (const ob of this.obstacles) {
      const r = circleAabbResolve(p.x, p.y, PLAYER_RADIUS, ob);
      if (r) p.y += r.y;
    }
  }

  private finish(reason: EndReason, winnerId: number | null, now: number): void {
    this.finished = true;
    const score: Record<string, number> = {};
    for (const p of this.players.values()) score[String(p.id)] = p.hp;
    this.result = {
      winnerId,
      reason,
      durationMs: now - this.startedAt,
      score,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Circle (cx,cy,r) vs AABB hit-test. */
function circleAabbHit(cx: number, cy: number, r: number, ob: Obstacle): boolean {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** If circle penetrates AABB, return push-out vector (smallest separation). Else null. */
function circleAabbResolve(
  cx: number,
  cy: number,
  r: number,
  ob: Obstacle,
): { x: number; y: number } | null {
  const nx = clamp(cx, ob.x, ob.x + ob.w);
  const ny = clamp(cy, ob.y, ob.y + ob.h);
  const dx = cx - nx;
  const dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return { x: (dx / d) * push, y: (dy / d) * push };
  }
  // Center-inside fallback: push out along nearest edge
  const left = cx - ob.x;
  const right = ob.x + ob.w - cx;
  const top = cy - ob.y;
  const bottom = ob.y + ob.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: -(left + r), y: 0 };
  if (m === right) return { x: right + r, y: 0 };
  if (m === top) return { x: 0, y: -(top + r) };
  return { x: 0, y: bottom + r };
}

/** Validates and clips obstacles to map bounds. Drops degenerate ones. */
function sanitizeObstacles(list: Obstacle[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const o of list) {
    if (
      typeof o?.x !== 'number' ||
      typeof o?.y !== 'number' ||
      typeof o?.w !== 'number' ||
      typeof o?.h !== 'number'
    )
      continue;
    const x = clamp(Math.round(o.x), 0, MAP_WIDTH);
    const y = clamp(Math.round(o.y), 0, MAP_HEIGHT);
    const w = clamp(Math.round(o.w), 1, MAP_WIDTH - x);
    const h = clamp(Math.round(o.h), 1, MAP_HEIGHT - y);
    if (w < 8 || h < 8) continue;
    const kind: Obstacle['kind'] =
      o.kind === 'crate' || o.kind === 'barrel' || o.kind === 'wall' ? o.kind : 'crate';
    out.push({ x, y, w, h, kind });
  }
  return out.slice(0, 32); // hard cap
}

/** Default spawn positions: portrait map → p1 bottom, p2 top. */
export function defaultSpawns(): { p1: { x: number; y: number }; p2: { x: number; y: number } } {
  return {
    p1: { x: MAP_WIDTH / 2, y: MAP_HEIGHT - 140 },
    p2: { x: MAP_WIDTH / 2, y: 140 },
  };
}
