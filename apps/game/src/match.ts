import pino from 'pino';
import {
  MSG,
  encodeMsg,
  type CHello,
  type CInput,
  type CPing,
  type SWelcome,
  type SSnapshot,
  type SHit,
  type SMatchEnd,
  type SnapshotEvent,
  type WelcomePlayer,
  type Obstacle,
} from '@arena/protocol';
import { MAP_HEIGHT, MAP_WIDTH, DEFAULT_MATCH_DURATION_MS } from '@arena/shared';
import { Sim, defaultSpawns, type PlayerInput, type PlayerState, type EndReason } from './sim.js';
import { Bot, buildBotPlayer } from './bot.js';
import { ReplayWriter } from './replay.js';
import { InternalApiClient } from './internal-client.js';

const log = pino({ name: 'match', level: process.env.LOG_LEVEL ?? 'info' });

export interface MatchPlayerSeed {
  userId: number;
  username: string;
  characterId: number;
  skinId: number;
  stats?: PlayerStatsSeed;
  /** Per-character sprite URL (uploaded by admin). */
  characterSpriteUrl?: string | null;
  /** Per-weapon sprite URL (resolved from loadout/starter). */
  weaponSpriteUrl?: string | null;
  /** Custom bullet sprite for this character. */
  bulletSpriteUrl?: string | null;
}

export interface PlayerStatsSeed {
  hp: number;
  speed: number;
  damage: number;
  weaponType: string;
  abilityType: string | null;
  abilityCooldownMs: number;
}

export interface MatchSeed {
  matchId: string;
  mode: 'FREE' | 'CASUAL' | 'STAKE';
  roomId: number;
  stakeUsd?: string;
  tickRate: number;
  durationMs?: number;
  player1: MatchPlayerSeed;
  player2: MatchPlayerSeed;
  /** When player2.userId equals BOT_USER_ID we drive it locally. */
  isBotMatch: boolean;
  obstacles?: Obstacle[];
}

interface ClientSocket {
  send(data: ArrayBuffer | Uint8Array, isBinary: boolean, compress?: boolean): void;
  close(): void;
}

export interface ConnectedClient {
  userId: number;
  ws: ClientSocket;
  alive: boolean;
}

const SNAPSHOT_RATE_HZ = 30;
/** Milliseconds a disconnected player has to reconnect before losing. */
const RECONNECT_TIMEOUT_MS = 10_000;

export class Match {
  readonly matchId: string;
  private sim: Sim;
  private bot: Bot | null = null;
  private replay: ReplayWriter;
  private clients: Map<number, ConnectedClient> = new Map();
  private timer: NodeJS.Timeout | null = null;
  /** Pending reconnect timeouts keyed by userId. Cleared on re-attach or match end. */
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  private lastTick = 0;
  private snapshotAccum = 0;
  private finishCalled = false;
  private startNotified = false;

  constructor(
    private readonly seed: MatchSeed,
    private readonly api: InternalApiClient,
  ) {
    this.matchId = seed.matchId;
    const spawns = defaultSpawns();
    const p1 = buildPlayer(seed.player1, spawns.p1);
    const p2 = seed.isBotMatch
      ? buildBotPlayer(seed.player2.userId, spawns.p2)
      : buildPlayer(seed.player2, spawns.p2);
    this.sim = new Sim({
      matchId: seed.matchId,
      durationMs: seed.durationMs ?? DEFAULT_MATCH_DURATION_MS,
      players: [p1, p2],
      ...(seed.obstacles ? { obstacles: seed.obstacles } : {}),
    });
    if (seed.isBotMatch) {
      this.bot = new Bot(this.sim, seed.player2.userId, seed.player1.userId);
    }
    this.replay = new ReplayWriter(seed.matchId);
    this.replay.meta(0, {
      matchId: seed.matchId,
      mapW: MAP_WIDTH,
      mapH: MAP_HEIGHT,
      tickRate: seed.tickRate,
      durationMs: this.sim.durationMs,
      obstacles: this.sim.obstacles,
      players: [
        { id: p1.id, username: p1.username, characterId: p1.characterId, skinId: p1.skinId },
        { id: p2.id, username: p2.username, characterId: p2.characterId, skinId: p2.skinId },
      ],
    });
  }

  /** Returns true if match accepts this user. */
  hasPlayer(userId: number): boolean {
    return this.sim.players.has(userId);
  }

  isBotPlayer(userId: number): boolean {
    return this.sim.players.get(userId)?.isBot ?? false;
  }

  isFinished(): boolean {
    return this.sim.finished;
  }

  attachClient(userId: number, ws: ClientSocket): void {
    if (!this.sim.players.has(userId)) {
      log.warn({ matchId: this.matchId, userId }, 'reject: not a participant');
      ws.close();
      return;
    }
    // Cancel any pending reconnect timer — player made it back in time.
    this.clearReconnectTimer(userId);
    const old = this.clients.get(userId);
    if (old) {
      try {
        old.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.set(userId, { userId, ws, alive: true });
    log.info({ matchId: this.matchId, userId }, 'client attached');
    // Reset AFK timer so a reconnecting player doesn't get kicked
    // before they have a chance to send their first input.
    this.sim.refreshInputAt(userId, Date.now());
    this.sendWelcome(userId);
    if (this.sim.finished && this.sim.result) {
      // Match already over — deliver the result immediately so the reconnecting
      // player can navigate to the result screen instead of getting a blank page.
      const result = this.sim.result;
      const c = this.clients.get(userId);
      if (c) {
        const end: SMatchEnd = {
          winnerId: result.winnerId,
          reason: result.reason,
          durationMs: result.durationMs,
          score: result.score,
        };
        log.info({ matchId: this.matchId, userId }, 'sending S_MATCH_END on reconnect to finished match');
        try {
          c.ws.send(encodeMsg(MSG.S_MATCH_END, end), true);
        } catch {
          /* ignore */
        }
      }
    } else {
      this.maybeStart();
    }
  }

  /**
   * Remove a client socket.
   * @param explicit - true when the player deliberately quit (C_LEAVE).
   *   When false (unexpected close / page refresh) a 10-second reconnect window is granted.
   */
  detachClient(userId: number, now: number, explicit = false): void {
    const c = this.clients.get(userId);
    if (!c) return;
    this.clients.delete(userId);
    log.info({ matchId: this.matchId, userId, explicit }, 'client detached');
    if (this.sim.finished) return;
    if (explicit) {
      // Intentional quit — end immediately.
      this.clearReconnectTimer(userId);
      this.sim.markDisconnect(userId, now);
    } else {
      // Unexpected disconnect (page refresh, network drop) — start reconnect window.
      // Reset AFK clock from *now* so the sim's own AFK detection also gives ~10s.
      this.sim.refreshInputAt(userId, now);
      // Clear any old timer first (shouldn't exist, but be safe).
      this.clearReconnectTimer(userId);
      const t = setTimeout(() => {
        this.reconnectTimers.delete(userId);
        if (!this.sim.finished) {
          log.info({ matchId: this.matchId, userId }, 'reconnect timeout — declaring disconnect');
          this.sim.markDisconnect(userId, Date.now());
        }
      }, RECONNECT_TIMEOUT_MS);
      this.reconnectTimers.set(userId, t);
      log.info({ matchId: this.matchId, userId }, 'reconnect window started (10 s)');
    }
  }

  private clearReconnectTimer(userId: number): void {
    const t = this.reconnectTimers.get(userId);
    if (t !== undefined) {
      clearTimeout(t);
      this.reconnectTimers.delete(userId);
    }
  }

  handleHello(_userId: number, _msg: CHello): void {
    // matchToken already validated on upgrade; nothing to do here.
  }

  handleInput(userId: number, msg: CInput): void {
    if (this.sim.finished) return;
    const input: PlayerInput = {
      seq: msg.seq | 0,
      dx: clampNum(msg.dx, -1, 1),
      dy: clampNum(msg.dy, -1, 1),
      angle: Number(msg.angle) || 0,
      fire: !!msg.fire,
      ability: !!msg.ability,
      receivedAt: Date.now(),
    };
    this.sim.setInput(userId, input);
    this.replay.input(this.sim.elapsedMs, { playerId: userId, ...input });
  }

  handlePing(userId: number, msg: CPing): void {
    const c = this.clients.get(userId);
    if (!c) return;
    c.ws.send(encodeMsg(MSG.S_PONG, { t: msg.t ?? Date.now() }), true);
  }

  /** Start the simulation tick when both human players are connected. */
  private maybeStart(): void {
    const expected = this.seed.isBotMatch ? 1 : 2;
    if (this.clients.size < expected) return;
    if (this.timer) return;
    const now = Date.now();
    this.sim.start(now);
    this.lastTick = now;
    if (!this.startNotified) {
      this.startNotified = true;
      this.api.post('/internal/match/start', { matchId: this.matchId }).catch((e) => {
        log.error({ err: e.message, matchId: this.matchId }, '/internal/match/start failed');
      });
    }
    const stepMs = Math.round(1000 / this.seed.tickRate);
    this.timer = setInterval(() => this.tick(stepMs), stepMs);
    log.info({ matchId: this.matchId, tickRate: this.seed.tickRate }, 'match started');
  }

  private tick(stepMs: number): void {
    const now = Date.now();
    const dt = Math.min(100, now - this.lastTick); // cap spiral-of-death
    this.lastTick = now;

    if (this.bot) this.bot.step(now);

    this.sim.step(dt, now);

    // Send snapshot at SNAPSHOT_RATE_HZ
    this.snapshotAccum += dt;
    const snapInterval = 1000 / SNAPSHOT_RATE_HZ;
    if (this.snapshotAccum >= snapInterval || this.sim.finished) {
      this.snapshotAccum = 0;
      this.broadcastSnapshot();
    }

    if (this.sim.finished) {
      this.finalize().catch((e) => {
        log.error({ err: (e as Error).message, matchId: this.matchId }, 'finalize failed');
      });
    }
  }

  private buildSnapshotPlayers() {
    return [...this.sim.players.values()].map((p) => ({
      id: p.id,
      x: round1(p.x),
      y: round1(p.y),
      angle: round3(p.angle),
      hp: p.hp,
      ammo: 0,
      abilityCdMs: Math.round(p.abilityCdLeftMs),
      buffs: p.buffs.length ? [...p.buffs] : undefined,
    }));
  }

  private broadcastSnapshot(): void {
    const remainingMs = Math.max(0, this.sim.durationMs - this.sim.elapsedMs);
    const players = this.buildSnapshotPlayers();
    const bullets = [...this.sim.bullets.values()].map((b) => ({
      id: b.id,
      x: round1(b.x),
      y: round1(b.y),
      owner: b.ownerId,
      type: 'bullet',
      ttl: Math.round(b.ttlMs),
    }));
    const events: SnapshotEvent[] = [...this.sim.events];

    // Per-client snapshot — include their last ackInputSeq.
    for (const c of this.clients.values()) {
      const me = this.sim.players.get(c.userId);
      const snap: SSnapshot = {
        tick: this.sim.tick,
        ackInputSeq: me?.lastInputSeq ?? 0,
        remainingMs,
        players,
        bullets,
        events,
      };
      try {
        c.ws.send(encodeMsg(MSG.S_SNAPSHOT, snap), true);
      } catch {
        /* ignore */
      }
    }

    // Per-event extra messages (S_HIT)
    for (const ev of events) {
      if (ev.kind === 'hit') {
        const hit: SHit = {
          victim: Number(ev.victim),
          attacker: Number(ev.attacker),
          dmg: Number(ev.dmg),
          x: Number(ev.x),
          y: Number(ev.y),
        };
        for (const c of this.clients.values()) {
          try {
            c.ws.send(encodeMsg(MSG.S_HIT, hit), true);
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Replay snapshot (decimated)
    this.replay.snapshot(this.sim.elapsedMs, { tick: this.sim.tick, players, bullets, events });
  }

  private async finalize(): Promise<void> {
    if (this.finishCalled) return;
    this.finishCalled = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Cancel all reconnect timers — match is over.
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();

    const result = this.sim.result;
    if (!result) return;

    const end: SMatchEnd = {
      winnerId: result.winnerId,
      reason: result.reason,
      durationMs: result.durationMs,
      score: result.score,
    };
    for (const c of this.clients.values()) {
      try {
        c.ws.send(encodeMsg(MSG.S_MATCH_END, end), true);
      } catch {
        /* ignore */
      }
    }

    await this.replay.end(this.sim.elapsedMs, end).catch(() => undefined);

    const replayPath = this.replay.path.replace(/\\/g, '/');
    await this.api
      .post('/internal/match/finish', {
        matchId: this.matchId,
        winnerId: result.winnerId,
        reason: result.reason,
        durationMs: result.durationMs,
        score: result.score,
        replayPath,
      })
      .catch((e) => {
        log.error({ err: e.message, matchId: this.matchId }, '/internal/match/finish failed');
      });

    // Close client sockets after a small grace period so they receive S_MATCH_END.
    setTimeout(() => {
      for (const c of this.clients.values()) {
        try {
          c.ws.close();
        } catch {
          /* ignore */
        }
      }
      this.clients.clear();
    }, 1000);

    log.info(
      { matchId: this.matchId, winnerId: result.winnerId, reason: result.reason },
      'match finalized',
    );
  }

  private sendWelcome(toUserId: number): void {
    const me = this.sim.players.get(toUserId);
    const opp = [...this.sim.players.values()].find((p) => p.id !== toUserId);
    if (!me || !opp) return;
    const c = this.clients.get(toUserId);
    if (!c) return;
    const seedFor = (id: number): MatchPlayerSeed | null => {
      if (this.seed.player1.userId === id) return this.seed.player1;
      if (this.seed.player2.userId === id) return this.seed.player2;
      return null;
    };
    const buildPlayerInfo = (p: PlayerState): WelcomePlayer => {
      const s = seedFor(p.id);
      return {
        id: p.id,
        characterId: p.characterId,
        skinId: p.skinId,
        username: p.username,
        stats: {
          hp: p.maxHp,
          speed: p.speed,
          damage: p.damage,
          abilityCooldownS: p.abilityCooldownMs / 1000,
        },
        spawnX: p.x,
        spawnY: p.y,
        characterSpriteUrl: s?.characterSpriteUrl ?? null,
        weaponSpriteUrl: s?.weaponSpriteUrl ?? null,
        bulletSpriteUrl: s?.bulletSpriteUrl ?? null,
      };
    };
    const welcome: SWelcome = {
      matchId: this.matchId,
      you: buildPlayerInfo(me),
      opponent: buildPlayerInfo(opp),
      mapW: MAP_WIDTH,
      mapH: MAP_HEIGHT,
      tickRate: this.seed.tickRate,
      matchDurationMs: this.sim.durationMs,
      room: {
        id: this.seed.roomId,
        mode: this.seed.mode,
        ...(this.seed.stakeUsd ? { stakeUsd: this.seed.stakeUsd } : {}),
      },
      obstacles: this.sim.obstacles,
      // Tell the client whether the match has ever started (reconnect scenario).
      // Using startNotified (not timer) so the flag stays true even after finalize().
      started: this.startNotified,
    };
    try {
      c.ws.send(encodeMsg(MSG.S_WELCOME, welcome), true);
    } catch {
      /* ignore */
    }
  }

  /** Forced abort (e.g. server shutdown, never started). */
  async abort(reason: string): Promise<void> {
    if (this.finishCalled) return;
    this.finishCalled = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    await this.replay.end(this.sim.elapsedMs, { aborted: true, reason }).catch(() => undefined);
    await this.api
      .post('/internal/match/abort', { matchId: this.matchId, reason })
      .catch(() => undefined);
    for (const c of this.clients.values()) {
      try {
        c.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  /** Reason : end : EndReason — for logging only. */
  endReason(): EndReason | null {
    return this.sim.result?.reason ?? null;
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < lo ? lo : n > hi ? hi : n;
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function buildPlayer(seed: MatchPlayerSeed, spawn: { x: number; y: number }): PlayerState {
  const stats = seed.stats;
  const maxHp = stats?.hp ?? 100;
  const speed = stats?.speed ?? 240;
  const damage = stats?.damage ?? 20;
  const abilityCooldownMs = stats?.abilityCooldownMs ?? 8000;
  return {
    id: seed.userId,
    characterId: seed.characterId,
    skinId: seed.skinId,
    username: seed.username,
    isBot: false,
    x: spawn.x,
    y: spawn.y,
    angle: spawn.x < MAP_WIDTH / 2 ? 0 : Math.PI,
    hp: maxHp,
    maxHp,
    speed,
    damage,
    abilityCooldownMs,
    abilityCdLeftMs: 0,
    fireCooldownLeftMs: 0,
    dashLeftMs: 0,
    dashVx: 0,
    dashVy: 0,
    lastInputSeq: 0,
    lastInputAt: Date.now(),
    buffs: [],
  };
}
