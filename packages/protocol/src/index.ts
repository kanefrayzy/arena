/**
 * Game match WS protocol message types (msgpack-encoded).
 * Wire format: 1-byte type tag + msgpack-encoded payload.
 */

import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack';

// ----- Message type tags -----
export const MSG = {
  // Client → Server
  C_HELLO: 0x01,
  C_INPUT: 0x02,
  C_PING: 0x03,
  C_LEAVE: 0x04,
  // Server → Client
  S_WELCOME: 0x10,
  S_SNAPSHOT: 0x11,
  S_HIT: 0x12,
  S_MATCH_END: 0x13,
  S_PONG: 0x14,
  S_ERROR: 0x15,
} as const;

export type MsgTag = (typeof MSG)[keyof typeof MSG];

// ----- C → S payloads -----
export interface CHello {
  matchToken: string;
}

export interface CInput {
  /** monotonic input sequence number */
  seq: number;
  /** desired horizontal direction in [-1, 1] */
  dx: number;
  /** desired vertical direction in [-1, 1] */
  dy: number;
  /** facing angle in [0, 2π] */
  angle: number;
  fire: boolean;
  ability: boolean;
}

export interface CPing {
  t: number;
}

// ----- S → C payloads -----
export interface PlayerStats {
  hp: number;
  speed: number;
  damage: number;
  abilityCooldownS: number;
}

export interface WelcomePlayer {
  id: number;
  characterId: number;
  skinId: number;
  username: string;
  stats: PlayerStats;
  spawnX: number;
  spawnY: number;
  /** Per-character avatar URL (set by admin in CMS), nullable. */
  characterSpriteUrl?: string | null;
  /** Per-weapon sprite URL (resolved from loadout/starter), nullable. */
  weaponSpriteUrl?: string | null;
}

export interface Obstacle {
  /** axis-aligned rectangle, world coordinates (top-left origin, Y down) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** visual variant — affects rendering only */
  kind?: 'crate' | 'barrel' | 'wall';
}

export interface SWelcome {
  matchId: string;
  you: WelcomePlayer;
  opponent: WelcomePlayer;
  mapW: number;
  mapH: number;
  tickRate: number;
  matchDurationMs: number;
  room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
  obstacles: Obstacle[];
}

export interface SnapshotPlayer {
  id: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  ammo: number;
  abilityCdMs: number;
  buffs?: string[] | undefined;
}

export interface SnapshotBullet {
  id: number;
  x: number;
  y: number;
  owner: number;
  type: string;
  ttl: number;
}

export interface SnapshotEvent {
  kind: 'shoot' | 'hit' | 'pickup' | 'ability' | 'death';
  [k: string]: unknown;
}

export interface SSnapshot {
  tick: number;
  ackInputSeq: number;
  remainingMs: number;
  players: SnapshotPlayer[];
  bullets: SnapshotBullet[];
  events: SnapshotEvent[];
}

export interface SHit {
  victim: number;
  attacker: number;
  dmg: number;
  x: number;
  y: number;
}

export interface SMatchEnd {
  winnerId: number | null;
  reason: 'kill' | 'timeout' | 'disconnect' | 'draw';
  durationMs: number;
  score: Record<string, number>;
}

export interface SError {
  code: string;
  message: string;
}

// ----- Encode / decode helpers -----

/** Encode a frame: [1 byte type][msgpack payload]. */
export function encodeMsg(tag: MsgTag, payload: unknown): Uint8Array {
  const body = mpEncode(payload);
  const out = new Uint8Array(body.length + 1);
  out[0] = tag;
  out.set(body, 1);
  return out;
}

export interface DecodedMsg {
  tag: MsgTag;
  payload: unknown;
}

export function decodeMsg(buf: Uint8Array | ArrayBuffer): DecodedMsg {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 1) throw new Error('frame too short');
  const tag = u8[0] as MsgTag;
  const payload = u8.length > 1 ? mpDecode(u8.subarray(1)) : undefined;
  return { tag, payload };
}
