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
  /** The wrapper passed to Match.attachClient. Set in `open` once the match
   *  resolves. Used by `close` to disambiguate a stale OLD-socket close event
   *  from a real disconnect after a page-refresh reconnect. */
  wrapper?: { send: (d: ArrayBuffer | Uint8Array, b: boolean, c?: boolean) => void; close: () => void };
}

const matches = new Map<string, Match>();
// Serializes concurrent getOrCreateMatch calls per matchId to avoid races
// where two players connect within ms of each other and end up in two
// different Match instances (resulting in match never starting).
const matchCreating = new Map<string, Promise<Match | null>>();

async function loadSeed(matchId: string): Promise<MatchSeed | null> {
  const raw = await redis.get(`match:seed:${matchId}`);
  if (!raw) return null;
  return JSON.parse(raw) as MatchSeed;
}

async function getOrCreateMatch(matchId: string): Promise<Match | null> {
  const existing = matches.get(matchId);
  if (existing) return existing;
  const inFlight = matchCreating.get(matchId);
  if (inFlight) return inFlight;
  const promise = (async () => {
    try {
      const seed = await loadSeed(matchId);
      if (!seed) return null;
      // Re-check under the "lock" in case another caller already created it.
      const already = matches.get(matchId);
      if (already) return already;
      const m = new Match(seed, api);
      matches.set(matchId, m);
      return m;
    } finally {
      matchCreating.delete(matchId);
    }
  })();
  matchCreating.set(matchId, promise);
  return promise;
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
      const err = e as Error & { name?: string };
      const expired = err.name === 'TokenExpiredError';
      log.warn({ err: err.message, expired }, 'token verify failed');
      if (!aborted) {
        res.cork(() =>
          res
            .writeStatus(expired ? '401 Token Expired' : '401 Unauthorized')
            .writeHeader('Content-Type', 'application/json')
            .end(JSON.stringify({ code: expired ? 'TOKEN_EXPIRED' : 'BAD_TOKEN' })),
        );
      }
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
      const wrapper = {
        send: (data: ArrayBuffer | Uint8Array, isBinary: boolean, compress?: boolean) => {
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
      };
      // Remember which wrapper this socket owns so the close handler can
      // distinguish a real disconnect from a stale close arriving after a
      // page-refresh reconnect has already replaced the entry.
      ud.wrapper = wrapper;
      match.attachClient(ud.userId, wrapper);
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
        // Closing the socket triggers the 'close' handler, which grants the
        // standard reconnect window. Treating C_LEAVE as a graceful close
        // (instead of an immediate forfeit) means a player who briefly
        // backgrounds/back-navigates the app can still reconnect within
        // the reconnect grace period and resume the match.
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
    // Pass the wrapper we registered with attachClient so Match can ignore
    // stale close events from a socket that has already been replaced (page
    // refresh races: new ws attaches before old ws's close event fires).
    match.detachClient(ud.userId, ud.wrapper ?? null, Date.now());
    if (match.isFinished()) {
      // Drop the in-memory instance AND the Redis seed so the matchId is
      // no longer reattachable. Without seed deletion, a stale browser tab
      // could otherwise reconnect after the 5 s grace and spawn a brand-new
      // simulation under the same matchId, leaving the user staring at an
      // empty map of a "ghost" match.
      setTimeout(() => {
        matches.delete(ud.matchId);
        redis.del(`match:seed:${ud.matchId}`).catch((e) => {
          log.warn({ err: (e as Error).message, matchId: ud.matchId }, 'seed cleanup failed');
        });
      }, 5000);
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
