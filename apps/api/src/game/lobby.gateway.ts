import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import IORedis from 'ioredis';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { QUEUE_TIMEOUT_FIRST_OFFER_MS } from '@arena/shared';
import { QueueService } from './queue.service';
import { RedisService } from '../common/redis/redis.module';
import { PrismaService } from '../common/prisma/prisma.module';
import { MatchTokenService } from './match-token.service';
import { MATCH_FOUND_CHANNEL, type MatchFoundEvent } from './match-creation.service';

const ACCESS_COOKIE = 'arena_access';

interface AuthedSocket {
  userId: number;
  ws: WebSocket;
  longWaitNotified: boolean;
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

/**
 * Lobby WebSocket — players hold an open ws while in queue / on home screen.
 *
 * S→C events:
 *   { type: 'queue:status', state, mode?, roomId?, waitMs?, canRetry?, canCancel? }
 *   { type: 'match:found',  matchId, matchToken, gameWsUrl, opponent, room }
 *   { type: 'wallet:update', balance, locked, coins }   (M2)
 *   { type: 'pong', t }
 *
 * C→S events:
 *   { type: 'ping', t }
 */
@Injectable()
export class LobbyGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Lobby');
  private wss: WebSocketServer | null = null;
  private clients = new Map<number, AuthedSocket>();
  private heartbeat: NodeJS.Timeout | null = null;
  private statusTick: NodeJS.Timeout | null = null;
  private sub: IORedis | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly queue: QueueService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly tokens: MatchTokenService,
  ) {}

  onModuleInit(): void {
    // Standalone WS server; we wire it to the http server in main.ts
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: number) => {
      this.onConnect(ws, userId);
    });

    // Heartbeat — close stale connections
    this.heartbeat = setInterval(() => this.tickHeartbeat(), 25_000);

    // queue:status — every 1s
    this.statusTick = setInterval(() => {
      this.broadcastQueueStatus().catch((e) =>
        this.log.error(`status tick failed: ${(e as Error).message}`),
      );
    }, 1000);

    // Redis subscriber for match:found
    const url = process.env.REDIS_URL ?? 'redis://redis:6379';
    this.sub = new IORedis(url);
    this.sub.subscribe(MATCH_FOUND_CHANNEL).catch((e) =>
      this.log.error(`subscribe failed: ${(e as Error).message}`),
    );
    this.sub.on('message', (_channel, raw) => {
      try {
        const ev = JSON.parse(raw) as MatchFoundEvent;
        this.deliverMatchFound(ev);
      } catch (e) {
        this.log.warn(`bad match-found msg: ${(e as Error).message}`);
      }
    });
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.statusTick) clearInterval(this.statusTick);
    this.sub?.disconnect();
    this.wss?.close();
  }

  /** Called from main.ts on http server upgrade event for /ws/lobby. */
  handleUpgrade(req: IncomingMessage, socket: import('net').Socket, head: Buffer): void {
    if (!this.wss) return socket.destroy();

    // Origin check
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        const domain = process.env.DOMAIN ?? 'localhost';
        if (u.hostname !== domain && u.hostname !== `admin.${domain}` && u.hostname !== '127.0.0.1') {
          this.log.warn(`origin rejected: ${origin}`);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          return socket.destroy();
        }
      } catch {
        // ignore parse errors, allow
      }
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[ACCESS_COOKIE];
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }

    let userId: number;
    try {
      const payload = this.jwt.verify<{ sub: number }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access',
      });
      userId = payload.sub;
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req, userId);
    });
  }

  private onConnect(ws: WebSocket, userId: number): void {
    // Drop existing socket for the same user
    const existing = this.clients.get(userId);
    if (existing) {
      try {
        existing.ws.close(4000, 'replaced');
      } catch {
        // ignore
      }
    }
    const sock: AuthedSocket = { userId, ws, longWaitNotified: false };
    this.clients.set(userId, sock);
    this.log.log(`user ${userId} connected (total=${this.clients.size})`);

    ws.on('close', () => {
      if (this.clients.get(userId)?.ws === ws) {
        this.clients.delete(userId);
      }
    });
    ws.on('error', () => undefined);
    ws.on('message', (data) => this.onMessage(sock, data.toString()));

    // Recovery cascade — three layers, each catches a different failure mode:
    //   1. lobby:pending-match Redis key (fresh, 300 s TTL) — set by matchmaker.
    //   2. DB lookup for any active (PENDING/RUNNING) match — survives Redis
    //      restarts, key expirations, server restarts, and tab/page reloads.
    //      This is the durable safety net that prevents players from getting
    //      lost between the queue and an in-flight match.
    //
    // Recover BEFORE sending initial 'idle' so a player who just had a match
    // created (publish raced their connect) doesn't see a confusing idle frame
    // before the match:found push. The recovery sends match:found itself if a
    // match is found; we still emit idle as the baseline state when nothing
    // was recovered, so QueuePage knows the WS is alive.
    void this.recoverActiveMatch(sock).then((delivered) => {
      if (!delivered) this.send(sock, { type: 'queue:status', state: 'idle' });
    });
  }

  /** Try Redis pending-match first, fall back to DB lookup. Returns true if a match:found was sent. */
  private async recoverActiveMatch(sock: AuthedSocket): Promise<boolean> {
    const delivered = await this.deliverPendingMatch(sock).catch(() => false);
    if (delivered) return true;
    return this.deliverActiveMatchFromDb(sock).catch((e) => {
      this.log.warn(
        `active-match db lookup failed for user ${sock.userId}: ${(e as Error).message}`,
      );
      return false;
    });
  }

  private onMessage(sock: AuthedSocket, raw: string): void {
    let msg: { type?: string; t?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      this.send(sock, { type: 'pong', t: msg.t ?? Date.now() });
    }
  }

  private send(sock: AuthedSocket, obj: unknown): void {
    if (sock.ws.readyState !== sock.ws.OPEN) return;
    try {
      sock.ws.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  private tickHeartbeat(): void {
    for (const [, sock] of this.clients) {
      this.send(sock, { type: 'ping', t: Date.now() });
    }
  }

  private async broadcastQueueStatus(): Promise<void> {
    if (this.clients.size === 0) return;
    for (const [, sock] of this.clients) {
      const state = await this.queue.getState(sock.userId);
      if (!state) {
        // Recovery path: a match may have been created but the pub/sub message
        // was lost (the user's lobby WS was momentarily disconnected).
        // Re-deliver from the persisted pending-match key before sending 'idle'
        // so the player is never stuck with a frozen timer while their opponent
        // is already in the match instance waiting alone.
        const redelivered = await this.tryRedeliverPendingMatch(sock).catch((e) => {
          this.log.warn(`pending-match redeliver failed for user ${sock.userId}: ${(e as Error).message}`);
          return false;
        });
        if (redelivered) continue;
        // DB-backed safety net: catches every scenario where the Redis
        // pending-match key is gone (expired, redelivered, Redis restart).
        const dbDelivered = await this.deliverActiveMatchFromDb(sock).catch((e) => {
          this.log.warn(`db active-match redeliver failed for user ${sock.userId}: ${(e as Error).message}`);
          return false;
        });
        if (dbDelivered) continue;
        if (sock.longWaitNotified) sock.longWaitNotified = false;
        this.send(sock, { type: 'queue:status', state: 'idle' });
        continue;
      }
      const waitMs = Date.now() - state.joinedAt;
      const isLongWait = waitMs >= QUEUE_TIMEOUT_FIRST_OFFER_MS;
      const payload: Record<string, unknown> = {
        type: 'queue:status',
        state: isLongWait ? 'long_wait' : 'searching',
        mode: state.mode,
        waitMs,
        canCancel: true,
      };
      if (state.roomId) payload.roomId = state.roomId;
      if (isLongWait && !sock.longWaitNotified) {
        sock.longWaitNotified = true;
        payload.canRetry = true;
      }
      this.send(sock, payload);
    }
  }

  private deliverMatchFound(ev: MatchFoundEvent): void {
    const sock = this.clients.get(ev.userId);
    if (!sock) return;
    this.send(sock, {
      type: 'match:found',
      matchId: ev.matchId,
      matchToken: ev.matchToken,
      gameWsUrl: ev.gameWsUrl,
      opponent: ev.opponent,
      room: ev.room,
    });
    // NOTE: intentionally NOT deleting lobby:pending-match here.
    // If the socket closes in the millisecond between send and client processing,
    // deliverPendingMatch will redeliver on reconnect.
    // The key has a 60-second TTL and is deleted by deliverPendingMatch on re-delivery.
  }

  private async deliverPendingMatch(sock: AuthedSocket): Promise<boolean> {
    // NOTE: must use the regular Redis client, NOT `this.sub`. ioredis blocks
    // GET/DEL on a connection that is in subscriber mode.
    const raw = await this.redis.client.get(`lobby:pending-match:${sock.userId}`);
    if (!raw) return false;
    try {
      const ev = JSON.parse(raw) as MatchFoundEvent;
      this.send(sock, {
        type: 'match:found',
        matchId: ev.matchId,
        matchToken: ev.matchToken,
        gameWsUrl: ev.gameWsUrl,
        opponent: ev.opponent,
        room: ev.room,
      });
      await this.redis.client.del(`lobby:pending-match:${sock.userId}`);
      this.log.log(`delivered pending match ${ev.matchId} to user ${sock.userId} on reconnect`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Durable recovery: query DB for any non-terminal match the user is in and
   * re-emit match:found with a freshly-signed match token. Catches every
   * scenario where the Redis pending-match key is gone (TTL expired, Redis
   * restart, redelivered already, tab opened in a new browser, etc.).
   */
  private async deliverActiveMatchFromDb(sock: AuthedSocket): Promise<boolean> {
    const match = await this.prisma.match.findFirst({
      where: {
        OR: [{ player1Id: sock.userId }, { player2Id: sock.userId }],
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { id: 'desc' },
      include: {
        player1: { select: { id: true, username: true } },
        player2: { select: { id: true, username: true } },
        room: { select: { id: true, mode: true, stakeUsd: true } },
      },
    });
    if (!match) return false;
    // Confirm the game-server seed is still alive — otherwise the user can
    // never actually attach to the match instance, so we should NOT lure them
    // onto a dead match page.
    const seedExists = await this.redis.client.exists(`match:seed:${match.id}`);
    if (!seedExists) return false;
    const opponent = match.player1Id === sock.userId ? match.player2 : match.player1;
    const gameWsUrl = process.env.GAME_PUBLIC_WS_URL ?? 'ws://localhost/ws/match';
    this.send(sock, {
      type: 'match:found',
      matchId: match.id,
      matchToken: this.tokens.sign({ matchId: match.id, userId: sock.userId }),
      gameWsUrl,
      opponent: { id: opponent.id, username: opponent.username },
      room: {
        id: match.room.id,
        mode: match.room.mode,
        ...(match.room.stakeUsd ? { stakeUsd: String(match.room.stakeUsd) } : {}),
      },
    });
    this.log.log(`recovered active match ${match.id} for user ${sock.userId} from DB`);
    return true;
  }

  /**
   * Defense-in-depth: invoked from the periodic status tick when the user is
   * no longer in the queue. If a pending match exists in Redis we re-deliver
   * it instead of falsely telling the client it's idle. Returns true when a
   * redelivery happened.
   */
  private async tryRedeliverPendingMatch(sock: AuthedSocket): Promise<boolean> {
    const key = `lobby:pending-match:${sock.userId}`;
    const raw = await this.redis.client.get(key);
    if (!raw) return false;
    let ev: MatchFoundEvent;
    try {
      ev = JSON.parse(raw) as MatchFoundEvent;
    } catch {
      // Corrupt payload — drop it so we don't loop.
      await this.redis.client.del(key).catch(() => undefined);
      return false;
    }
    this.send(sock, {
      type: 'match:found',
      matchId: ev.matchId,
      matchToken: ev.matchToken,
      gameWsUrl: ev.gameWsUrl,
      opponent: ev.opponent,
      room: ev.room,
    });
    // Delete after redelivery so we don't spam the client every second; the
    // initial publish path keeps the key for the 60s TTL as a backup.
    await this.redis.client.del(key).catch(() => undefined);
    this.log.log(`redelivered pending match ${ev.matchId} to user ${sock.userId} via status tick`);
    return true;
  }
}
