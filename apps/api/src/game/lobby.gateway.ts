import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import IORedis from 'ioredis';
import type { IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { QUEUE_TIMEOUT_FIRST_OFFER_MS } from '@arena/shared';
import { QueueService } from './queue.service';
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

    // Send initial idle status
    this.send(sock, { type: 'queue:status', state: 'idle' });
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
  }
}
