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
  /** Ability config from DB. */
  ability?: { type: string; cooldownMs: number; damageAmount: number; durationMs: number; range: number; soundUrl: string | null; iconUrl: string | null } | null;
}

export interface PlayerStatsSeed {
  hp: number;
  speed: number;
  damage: number;
  weaponType: string;
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
const RECONNECT_TIMEOUT_MS = 15_000;
/** Milliseconds the second player has to connect before the first one is awarded a walkover.
 *  Must be < the match-token TTL (5 min) and > a slow mobile cold-load (~10-20 s). */
const OPPONENT_NO_SHOW_MS = 45_000;

export class Match {
  readonly matchId: string;
  private sim: Sim;
  private bot: Bot | null = null;
  private replay: ReplayWriter;
  private clients: Map<number, ConnectedClient> = new Map();
  private timer: NodeJS.Timeout | null = null;
  /** Pending reconnect timeouts keyed by userId. Cleared on re-attach or match end. */
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  /** Fires when the second player fails to connect in time. Cleared when the match starts
   *  or when the match ends for any other reason. */
  private noShowTimer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private snapshotAccum = 0;
  private finishCalled = false;
  private startNotified = false;
  /** Events accumulated across sim steps since the last snapshot broadcast. */
  private pendingEvents: SnapshotEvent[] = [];

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
    // True after either a normal finalize() or a forced abort() — both make
    // the match unrecoverable, so callers (server.ts close handler) can drop
    // the in-memory instance and cleanup the Redis seed.
    return this.finishCalled || this.sim.finished;
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
      // Arm the no-show timer the first time someone arrives at a PvP match.
      this.armNoShowTimer();
      this.maybeStart();
    }
  }

  /** Start a one-shot timer that forfeits the absent player if the opponent never connects. */
  private armNoShowTimer(): void {
    if (this.seed.isBotMatch) return;
    if (this.noShowTimer) return;
    if (this.startNotified) return;
    this.noShowTimer = setTimeout(() => {
      this.noShowTimer = null;
      if (this.startNotified || this.sim.finished) return;
      const presentIds = new Set(this.clients.keys());
      const absent = [...this.sim.players.values()].find((p) => !presentIds.has(p.id));
      if (!absent) return;
      log.warn(
        { matchId: this.matchId, absentUserId: absent.id, presentCount: presentIds.size },
        'opponent no-show — forfeit',
      );
      // Mark sim finished with a 'disconnect' result.
      this.sim.markDisconnect(absent.id, Date.now());
      // The tick loop hasn't started, so finalize() won't be triggered automatically.
      this.finalize().catch((e) => {
        log.error({ err: (e as Error).message, matchId: this.matchId }, 'no-show finalize failed');
      });
    }, OPPONENT_NO_SHOW_MS);
  }

  private clearNoShowTimer(): void {
    if (this.noShowTimer) {
      clearTimeout(this.noShowTimer);
      this.noShowTimer = null;
    }
  }

  /**
   * Remove a client socket.
   * @param ws - the socket whose close event fired. Used to ignore stale closes
   *   from a socket that has already been replaced by a fresh reconnect (page
   *   refresh): the old socket's close event arrives AFTER attachClient has
   *   stored the new wrapper, so without this check we would kick the freshly
   *   reconnected player and forfeit them on a phantom disconnect.
   * @param explicit - true when the player deliberately quit (C_LEAVE).
   *   When false (unexpected close / page refresh) a 10-second reconnect window is granted.
   */
  detachClient(userId: number, ws: ClientSocket | null, now: number, explicit = false): void {
    const c = this.clients.get(userId);
    if (!c) return;
    if (ws && c.ws !== ws) {
      // Stale close from a socket that has already been replaced — ignore.
      log.info({ matchId: this.matchId, userId }, 'detach: ignoring stale close');
      return;
    }
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
      log.info(
        { matchId: this.matchId, userId, ms: RECONNECT_TIMEOUT_MS },
        'reconnect window started',
      );
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
      this.clearNoShowTimer();
      this.api.post('/internal/match/start', { matchId: this.matchId }).catch((e) => {
        log.error({ err: e.message, matchId: this.matchId }, '/internal/match/start failed');
      });
      // Tell every connected client the countdown should begin now.
      // Both players see the 3-2-1-FIGHT animation in sync.
      this.broadcast(MSG.S_MATCH_BEGIN, {});
    }
    const stepMs = Math.round(1000 / this.seed.tickRate);
    this.timer = setInterval(() => this.tick(stepMs), stepMs);
    log.info({ matchId: this.matchId, tickRate: this.seed.tickRate }, 'match started');
  }

  private broadcast(tag: number, payload: unknown): void {
    for (const c of this.clients.values()) {
      try {
        c.ws.send(encodeMsg(tag as never, payload), true);
      } catch {
        /* ignore */
      }
    }
  }

  private tick(stepMs: number): void {
    const now = Date.now();
    const dt = Math.min(100, now - this.lastTick); // cap spiral-of-death
    this.lastTick = now;

    // Keep the AFK timer alive for any player currently inside their reconnect
    // window — otherwise the sim's AFK detection (~10 s) would forfeit them
    // before the reconnect grace period (15 s) elapses.
    if (this.reconnectTimers.size > 0) {
      for (const userId of this.reconnectTimers.keys()) {
        this.sim.refreshInputAt(userId, now);
      }
    }

    if (this.bot) this.bot.step(now);

    this.sim.step(dt, now);
    // Accumulate events so they are never lost between snapshot intervals.
    if (this.sim.events.length > 0) {
      this.pendingEvents.push(...this.sim.events);
    }

    // Send snapshot at SNAPSHOT_RATE_HZ
    this.snapshotAccum += dt;
    const snapInterval = 1000 / SNAPSHOT_RATE_HZ;
    if (this.snapshotAccum >= snapInterval || this.sim.finished) {
      this.snapshotAccum = 0;
      this.broadcastSnapshot(this.pendingEvents);
      this.pendingEvents = [];
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

  private broadcastSnapshot(events: SnapshotEvent[]): void {
    const remainingMs = Math.max(0, this.sim.durationMs - this.sim.elapsedMs);
    const players = this.buildSnapshotPlayers();
    const bullets = [...this.sim.bullets.values()].map((b) => ({
      id: b.id,
      x: round1(b.x),
      y: round1(b.y),
      vx: round1(b.vx),
      vy: round1(b.vy),
      owner: b.ownerId,
      type: 'bullet',
      ttl: Math.round(b.ttlMs),
    }));

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
    this.clearNoShowTimer();

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
        ability: s?.ability ? {
          type: s.ability.type,
          cooldownMs: s.ability.cooldownMs,
          damageAmount: s.ability.damageAmount,
          durationMs: s.ability.durationMs,
          range: s.ability.range,
          soundUrl: s.ability.soundUrl ?? null,
          iconUrl: s.ability.iconUrl ?? null,
        } : null,
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
      // True iff we're still waiting for the other human to connect.
      // Bot matches never wait. After startNotified flips, this is always false.
      waitingForOpponent:
        !this.seed.isBotMatch && !this.startNotified && this.clients.size < 2,
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
    this.clearNoShowTimer();
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
  const ability = seed.ability;
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
    abilityCooldownMs: ability?.cooldownMs ?? 8000,
    abilityCdLeftMs: 0,
    abilityType: ability?.type ?? 'dash',
    abilityDamageAmount: ability?.damageAmount ?? 0,
    abilityDurationMs: ability?.durationMs ?? 0,
    abilityRange: ability?.range ?? 0,
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
