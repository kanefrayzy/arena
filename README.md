# Arena1v1

Browser PvP 1v1 skill-game (real money). Monorepo, TypeScript, Docker.

> **Status:** M1 — free-mode gameplay (queue, real-time match server, bot opponent, replays, end screen).
> Money flows in M2.

---

## Quick Start (development)

Requirements: **Docker 24+** with Compose v2. (Local Node/pnpm are NOT required for `docker compose up`.)

```bash
# 1. Clone, then create .env from the template
cp .env.example .env

# 2. Bring everything up (postgres, redis, api, game, web, caddy)
docker compose up

# 3. In a SECOND terminal — apply migrations and seed (first run only)
docker compose exec api pnpm prisma:migrate
docker compose exec api pnpm prisma:seed
```

Open <http://localhost> — you should see the splash screen. Sign up, log in, land on Home.

Direct service ports (dev only):

| Service | URL                       |
| ------- | ------------------------- |
| Web     | <http://localhost:5173>   |
| API     | <http://localhost:3000>   |
| Game WS | <ws://localhost:3001>     |
| Caddy   | <http://localhost>        |
| Postgres| `localhost:5432`          |
| Redis   | `localhost:6379`          |

Health checks:
- `GET http://localhost/api/health` → `{status:"ok"}`
- `GET http://localhost:3001/health`

### Local development without Docker (optional)

```bash
nvm use            # Node 22
corepack enable
pnpm install
pnpm db:generate
# Make sure postgres + redis are running locally and DATABASE_URL is set.
pnpm db:migrate
pnpm db:seed
pnpm dev:api &
pnpm dev:game &
pnpm dev:web
```

---

## Configuration

All env vars live in `.env` (see `.env.example` for documentation).

Critical secrets to regenerate before production:
```
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
INTERNAL_SECRET=$(openssl rand -hex 32)
CSRF_SECRET=$(openssl rand -hex 32)
```

Payment provider toggle: `PAYMENT_PROVIDER=mock|betra` (M2; mock by default).

---

## Architecture (current)

```
apps/
  api/          NestJS — auth, wallet, **queue, lobby WS, matchmaker, internal match endpoints** (M0+M1)
  game/         uWebSockets.js — **authoritative match server (30 Hz), bot AI, replays** (M1)
  web/          Vite + React + Pixi 8 + Tailwind — splash/login/register/home/**queue/match/result** pages (M0+M1)
packages/
  shared/       Zod schemas, constants (RoomMode, LedgerType, MAP/PLAYER/BULLET sizes, ...)
  protocol/     Msgpack message types + codec for game-WS (1-byte tag + msgpack body)
  config/       Shared eslint/tsconfig presets (placeholder)
prisma/
  schema.prisma Full schema per ТЗ §6 (User/Wallet/Ledger/Match/Room/Character/Skin/...)
  seed.ts       Creates: system user (id=1), bot user (id=2), admin, 3 characters, 6 skins,
                FREE + CASUAL + 3 STAKE rooms, default Settings
docker/
  api.Dockerfile, game.Dockerfile, web.Dockerfile, web.nginx.conf, Caddyfile
compose.yml     Dev compose (with bind mounts for hot reload)
```

### Money invariant (canonical, locked in M0; implemented in M2)

For every match the ledger satisfies `Σ amount = 0`:
```
winner: +stake (MATCH_STAKE_UNLOCK) + (prize − stake) (MATCH_WIN net)
loser:  +stake (MATCH_STAKE_UNLOCK) − stake          (MATCH_LOSS)
system: +commission                                  (COMMISSION)
```
A test asserting `SUM(ledger.amount) = 0` per match will be added in M2.

---

## M1 — Free-mode gameplay

End-to-end flow:

1. Home → choose **Free** mode → **Play**.
2. `POST /api/queue/join { mode: "free" }` enqueues the player in Redis (`mm:free` ZSET).
3. Lobby WS (`/ws/lobby`) streams `queue:status` every 1 s; after 30 s alone in queue and `Setting.gameplay.bot_in_free=true`, the matchmaker creates a bot match.
4. API publishes `match:found` via Redis pubsub → lobby WS → client navigates to `/match/:id`.
5. Match WS (`/ws/match`) — binary, msgpack-framed (1-byte tag + body):
   - `C_HELLO`, `C_INPUT`, `C_PING`, `C_LEAVE`
   - `S_WELCOME`, `S_SNAPSHOT` (30 Hz), `S_HIT`, `S_MATCH_END`, `S_PONG`, `S_ERROR`
6. Game server runs the authoritative simulation (720×1280 portrait map, 30 Hz, 90 s match):
   movement, shooting (4/s, 600 px/s, 20 dmg, 1.5 s TTL), dash ability (200 ms / 8 s cd), AFK detection.
7. End → server sends `S_MATCH_END`, calls `POST /internal/match/finish` (HMAC-SHA256 signed),
   API persists status/winner/duration/replayUrl. Client navigates to `/result/:id`.
8. Replays gzipped to `/var/data/replays/{matchId}.bin.gz` (length-prefixed msgpack frames).

Internal HMAC: header `x-arena-signature = sha256("${ts}.${rawBody}", INTERNAL_SECRET)`,
60 s timestamp tolerance.

Match JWT: signed by API with `INTERNAL_SECRET`, TTL 30 s, payload `{matchId, userId}` —
required as `?token=…` on `/ws/match`.

### Controls

- **Desktop:** WASD / arrows = move; mouse = aim; LMB / Space = fire; Q / Shift = dash.
- **Mobile:** left joystick = move; FIRE button = fire (auto-aims at opponent direction);
  Q button = dash.

### Manual smoke test

```
1. docker compose up
2. Open http://localhost, sign up or log in (admin@arena1v1.local / ChangeMeNow!2026).
3. Home → Free → Play.
4. Wait ~30 s — bot match starts automatically.
5. Move/aim/fire; verify HUD (HP, timer, ability cd).
6. After match end → /result/:id shows W/L/D, scores, duration.
7. docker compose exec game ls /var/data/replays  → see {matchId}.bin.gz.
```

---

## Roadmap

| Milestone | Scope                                                            | Status |
| --------- | ---------------------------------------------------------------- | ------ |
| **M0**    | Monorepo + docker compose + auth + read-only wallet + empty pages | ✅ done |
| **M1**    | Free-mode gameplay (queue, game-server, replays, end-screen)      | ✅ done |
| M2        | Money: ledger, deposits/withdrawals, casual/stake rooms           | next   |
| M3        | Content: characters/skins/inventory/shop/loadout                  |        |
| M4        | Admin panel (CRUD, dashboard, force-finish, refunds)              |        |
| M5        | PWA polish + framer-motion + sound + mobile controls              |        |
| M6        | Hardening + load tests + legal docs + soft launch                 |        |

---

## Deployment

Production compose file (`compose.prod.yml`) and CI workflows are added in M6. See ТЗ §15 for the target topology.

---

## License

Proprietary — All rights reserved. See `LICENSE`.
