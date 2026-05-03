#!/bin/bash
# Run on server via SSH. Idempotent.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/kanefrayzy/arena.git}"
APP_DIR="/opt/arena1v1"

echo "==> [1/7] System update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y -o Dpkg::Options::="--force-confnew" \
  ca-certificates curl gnupg ufw git openssl

echo "==> [2/7] Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp  >/dev/null
ufw allow 443/tcp >/dev/null
echo "y" | ufw enable >/dev/null || true

echo "==> [3/7] Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> [4/7] Clone or update repo"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  cd "$APP_DIR" && git fetch --all && git reset --hard origin/HEAD
fi
cd "$APP_DIR"

echo "==> [5/7] .env"
if [ ! -f .env ]; then
  PG_PW="$(openssl rand -hex 16)"
  ACC_S="$(openssl rand -hex 32)"
  REF_S="$(openssl rand -hex 32)"
  INT_S="$(openssl rand -hex 32)"
  CSRF_S="$(openssl rand -hex 32)"
  cat > .env <<EOF
DOMAIN=178.105.23.83
ADMIN_EMAIL=admin@arena1v1.local
ADMIN_USERNAME=admin
ADMIN_PASSWORD_INITIAL=ChangeMeNow!2026

POSTGRES_USER=app
POSTGRES_PASSWORD=${PG_PW}
POSTGRES_DB=arena
DATABASE_URL=postgresql://app:${PG_PW}@postgres:5432/arena

REDIS_URL=redis://redis:6379

JWT_ACCESS_SECRET=${ACC_S}
JWT_REFRESH_SECRET=${REF_S}
INTERNAL_SECRET=${INT_S}
CSRF_SECRET=${CSRF_S}

PAYMENT_PROVIDER=mock
BETRA_API_URL=https://betra.biz/api/h2h
BETRA_API_KEY=
BETRA_HMAC_SECRET=
BETRA_CALLBACK_PATH=/api/payments/betra/callback

GAME_INTERNAL_URL=http://api:3000
GAME_PUBLIC_WS_URL=ws://178.105.23.83/ws/match
API_PUBLIC_URL=http://178.105.23.83

TICK_RATE=30

REPLAY_STORAGE=local
REPLAY_LOCAL_PATH=/var/data/replays

S3_ENDPOINT=
S3_BUCKET=
S3_KEY=
S3_SECRET=

SENTRY_DSN=
LOG_LEVEL=info
NODE_ENV=development
EOF
  echo "  .env generated"
else
  echo "  .env already exists, keeping"
fi

echo "==> [6/7] docker compose build + up"
docker compose pull postgres redis caddy || true
docker compose build
docker compose up -d

echo "    waiting for api to come up..."
for i in $(seq 1 60); do
  if docker compose exec -T api node -e "process.exit(0)" >/dev/null 2>&1; then
    echo "    api container ready"
    break
  fi
  sleep 2
done

echo "==> [7/7] DB migrate + seed"
docker compose exec -T api pnpm prisma:migrate || docker compose exec -T api pnpm db:migrate || true
docker compose exec -T api pnpm prisma:seed   || docker compose exec -T api pnpm db:seed   || true

echo
echo "==> DONE. Open: http://178.105.23.83/"
echo "    Health: $(curl -fsS http://localhost/api/health 2>/dev/null || echo 'pending')"
docker compose ps
