/* eslint-disable @typescript-eslint/no-explicit-any */
import uWS from 'uWebSockets.js';
import jwt from 'jsonwebtoken';
import IORedis from 'ioredis';
import pino from 'pino';
import { MSG, decodeMsg, encodeMsg } from '@arena/protocol';
import type { CHello, CInput, CPing } from '@arena/protocol';
import { Match, type MatchSeed } from './match.js';
import { InternalApiClient } from './internal-client.js';

const log = pino({ name: 'game', level: process.env.LOG_LEVEL ?? 'info' });

const PORT = Number(process.env.PORT ?? 3001);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'dev-internal';
const API_BASE = process.env.GAME_INTERNAL_URL ?? 'http://api:3000';

const redis = new IORedis(REDIS_URL);
const api = new InternalApiClient({ baseUrl: API_BASE, secret: INTERNAL_SECRET });

interface MatchTokenPayload {
  matchId: string;
  userId: number;
}

interface SocketUserData {
  matchId: string;
  userId: number;
  authed: boolean;
}

const matches = new Map<string, Match>();

async function loadSeed(matchId: string): Promise<MatchSeed | null> {
  const raw = await redis.get(`match:seed:${matchId}`);
  if (!raw) return null;
  return JSON.parse(raw) as MatchSeed;
}

async function getOrCreateMatch(matchId: string): Promise<Match | null> {
  const existing = matches.get(matchId);
  if (existing) return existing;
  const seed = await loadSeed(matchId);
  if (!seed) return null;
  const m = new Match(seed, api);
  matches.set(matchId, m);
  return m;
}

const app = uWS.App();

app.get('/health', (res) => {
  res.cork(() => {
    res
      .writeStatus('200 OK')
      .writeHeader('Content-Type', 'application/json')
      .end(JSON.stringify({ status: 'ok', ts: Date.now(), matches: matches.size }));
  });
});

app.ws<SocketUserData>('/ws/match', {
  idleTimeout: 60,
  maxPayloadLength: 16 * 1024,
  upgrade: (res, req, context) => {
    const url = req.getUrl();
    const query = req.getQuery();
    const origin = req.getHeader('origin');
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });

    if (origin) {
      try {
        const u = new URL(origin);
        const domain = process.env.DOMAIN ?? 'localhost';
        if (u.hostname !== domain && u.hostname !== `admin.${domain}` && u.hostname !== '127.0.0.1') {
          log.warn({ origin }, 'origin rejected');
          if (!aborted) res.cork(() => res.writeStatus('403').end('forbidden'));
          return;
        }
      } catch {
        /* allow */
      }
    }

    const params = new URLSearchParams(query);
    const token = params.get('token');
    if (!token) {
      if (!aborted) res.cork(() => res.writeStatus('401').end('no token'));
      return;
    }

    let payload: MatchTokenPayload;
    try {
      payload = jwt.verify(token, INTERNAL_SECRET) as MatchTokenPayload;
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'token verify failed');
      if (!aborted) res.cork(() => res.writeStatus('401').end('bad token'));
      return;
    }

    log.info({ url, matchId: payload.matchId, userId: payload.userId }, 'ws upgrade');
    if (aborted) return;
    res.upgrade(
      { matchId: payload.matchId, userId: payload.userId, authed: true } satisfies SocketUserData,
      secWebSocketKey,
      secWebSocketProtocol,
      secWebSocketExtensions,
      context,
    );
  },
  open: (ws) => {
    const ud = ws.getUserData();
    log.info({ matchId: ud.matchId, userId: ud.userId }, 'ws open');
    void getOrCreateMatch(ud.matchId).then((match) => {
      if (!match) {
        log.warn({ matchId: ud.matchId }, 'no seed; closing');
        try {
          ws.send(encodeMsg(MSG.S_ERROR, { code: 'NO_MATCH', message: 'match not found' }), true);
          ws.end(4404, 'no match');
        } catch {
          /* ignore */
        }
        return;
      }
      if (!match.hasPlayer(ud.userId)) {
        log.warn({ matchId: ud.matchId, userId: ud.userId }, 'not a participant');
        try {
          ws.send(encodeMsg(MSG.S_ERROR, { code: 'FORBIDDEN', message: 'not a participant' }), true);
          ws.end(4403, 'forbidden');
        } catch {
          /* ignore */
        }
        return;
      }
      match.attachClient(ud.userId, {
        send: (data, isBinary, compress) => {
          try {
            ws.send(data as Uint8Array, isBinary, compress);
          } catch {
            /* ignore */
          }
        },
        close: () => {
          try {
            ws.end(1000, 'bye');
          } catch {
            /* ignore */
          }
        },
      });
    });
  },
  message: (ws, message, isBinary) => {
    const ud = ws.getUserData();
    if (!isBinary) return;
    let frame;
    try {
      frame = decodeMsg(new Uint8Array(message));
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'decode failed');
      return;
    }
    const match = matches.get(ud.matchId);
    if (!match) return;

    switch (frame.tag) {
      case MSG.C_HELLO:
        match.handleHello(ud.userId, frame.payload as CHello);
        break;
      case MSG.C_INPUT:
        match.handleInput(ud.userId, frame.payload as CInput);
        break;
      case MSG.C_PING:
        match.handlePing(ud.userId, frame.payload as CPing);
        break;
      case MSG.C_LEAVE:
        match.detachClient(ud.userId, Date.now());
        try {
          ws.end(1000, 'bye');
        } catch {
          /* ignore */
        }
        break;
      default:
        break;
    }
  },
  close: (ws, code, _msg) => {
    const ud = ws.getUserData();
    log.info({ matchId: ud.matchId, userId: ud.userId, code }, 'ws close');
    const match = matches.get(ud.matchId);
    if (!match) return;
    match.detachClient(ud.userId, Date.now());
    if (match.isFinished()) {
      setTimeout(() => matches.delete(ud.matchId), 5000);
    }
  },
});

app.listen('0.0.0.0', PORT, (token) => {
  if (!token) {
    log.error('failed to listen');
    process.exit(1);
  }
  log.info({ port: PORT }, 'game-server listening');
});

process.on('SIGTERM', async () => {
  log.info('SIGTERM, aborting matches');
  for (const m of matches.values()) {
    await m.abort('shutdown').catch(() => undefined);
  }
  redis.disconnect();
  process.exit(0);
});
