// k6 load test for arena1v1 — full lobby journey.
//
// What it does per virtual user:
//   1. POST /api/auth/register (unique email) — get { accessToken, refreshToken, userId }.
//   2. Open WebSocket wss://<host>/ws/lobby with the access cookie.
//   3. Idle in lobby for the duration of the iteration (this is what 1000-online means).
//   4. Occasionally hit a few REST endpoints (/api/users/me, /api/wallet/balance,
//      /api/content/branding) to simulate light HTTP load.
//
// Usage (PowerShell):
//   docker run --rm -i -v ${PWD}:/scripts -e BASE=https://faoor.com `
//     grafana/k6 run /scripts/lobby-1000.js
//
// Tune via env:
//   BASE          target origin, default https://faoor.com
//   VUS           concurrent virtual users (default 200)
//   DURATION      total test duration (default 5m)
//   HOLD_SECONDS  how long each VU stays connected (default 240)
//
// 1000-online target run:
//   k6 run -e VUS=1000 -e DURATION=10m -e HOLD_SECONDS=540 lobby-1000.js
//
// NOTE: registration writes to your real database. Use a staging .env or be
// prepared to TRUNCATE the test users afterwards:
//   docker exec arena1v1-postgres-1 psql -U app arena -c \
//     "DELETE FROM \"User\" WHERE email LIKE 'loadtest+%';"

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE || 'https://faoor.com';
const WS_BASE = BASE.replace(/^http/, 'ws');
const VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || '5m';
const HOLD_SECONDS = Number(__ENV.HOLD_SECONDS || 240);

const wsConnectTrend = new Trend('ws_connect_ms');
const wsMessages = new Counter('ws_messages');
const httpErrors = new Counter('http_errors');

export const options = {
  scenarios: {
    lobby: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '90s', target: VUS },           // ramp up
        { duration: DURATION, target: VUS },        // hold
        { duration: '30s', target: 0 },             // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],                 // <2% HTTP errors
    http_req_duration: ['p(95)<800'],               // p95 < 800ms
    ws_connect_ms: ['p(95)<1500'],                  // p95 ws handshake < 1.5s
  },
};

function register() {
  const suffix = `${__VU}-${__ITER}-${randomString(6)}`;
  const email = `loadtest+${suffix}@arena.test`;
  const body = {
    email,
    password: 'LoadTest123!',
    username: `lt_${suffix}`.slice(0, 20),
  };
  const res = http.post(`${BASE}/api/auth/register`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    tags: { ep: 'register' },
  });
  if (res.status !== 201 && res.status !== 200) {
    httpErrors.add(1);
    return null;
  }
  let data;
  try { data = res.json(); } catch { return null; }
  const cookies = res.cookies || {};
  // Strategy: API uses HttpOnly cookies for sessions. We pass them back as Cookie header on WS.
  const cookieHeader = Object.keys(cookies).map((k) => `${k}=${cookies[k][0].value}`).join('; ');
  return { cookieHeader, token: data.accessToken || null };
}

function lightHttp(cookieHeader) {
  const params = {
    headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
    tags: { ep: 'misc' },
  };
  const responses = http.batch([
    ['GET', `${BASE}/api/users/me`, null, params],
    ['GET', `${BASE}/api/wallet/balance`, null, params],
    ['GET', `${BASE}/api/content/branding`, null, params],
  ]);
  for (const r of responses) {
    if (r.status >= 400) httpErrors.add(1);
  }
}

export default function () {
  const session = register();
  if (!session) {
    sleep(5);
    return;
  }
  const t0 = Date.now();
  const url = `${WS_BASE}/ws/lobby`;
  const wsParams = { headers: { Cookie: session.cookieHeader } };
  const res = ws.connect(url, wsParams, (socket) => {
    wsConnectTrend.add(Date.now() - t0);
    socket.on('message', () => wsMessages.add(1));
    socket.on('error', () => httpErrors.add(1));
    socket.setTimeout(() => {
      // periodically hit REST as a logged-in user would
      lightHttp(session.cookieHeader);
    }, 30_000);
    socket.setTimeout(() => socket.close(), HOLD_SECONDS * 1000);
  });
  check(res, { 'ws status 101': (r) => r && r.status === 101 });
  sleep(1);
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        vus_max: data.metrics.vus_max?.values?.max,
        ws_connect_p95: data.metrics.ws_connect_ms?.values['p(95)'],
        http_p95: data.metrics.http_req_duration?.values['p(95)'],
        http_fail_rate: data.metrics.http_req_failed?.values?.rate,
        ws_messages: data.metrics.ws_messages?.values?.count,
        http_errors: data.metrics.http_errors?.values?.count,
      },
      null,
      2,
    ) + '\n',
  };
}
