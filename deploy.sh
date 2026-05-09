#!/usr/bin/env bash
# =============================================================================
# deploy.sh — First-time setup & deploy for arena1v1 on a fresh Ubuntu server
# Run as root:  bash deploy.sh
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
APP_DIR="/opt/arena1v1"
GIT_REPO="${GIT_REPO:-}"          # Set via env or edit here: GIT_REPO=git@github.com:you/arena1v1.git
GIT_BRANCH="${GIT_BRANCH:-main}"
COMPOSE_FILE="compose.prod.yml"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Check root ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root (sudo bash deploy.sh)"

# ── Install Docker if missing ─────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    info "Docker already installed: $(docker --version)"
    return
  fi
  info "Installing Docker CE..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  info "Docker installed: $(docker --version)"
}

# ── Install / update the application ─────────────────────────────────────────
fetch_code() {
  if [[ -z "$GIT_REPO" ]]; then
    error "GIT_REPO is not set. Run:  GIT_REPO=git@github.com:you/arena1v1.git bash deploy.sh"
  fi

  if [[ -d "$APP_DIR/.git" ]]; then
    info "Pulling latest code..."
    git -C "$APP_DIR" fetch origin
    git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"
  else
    info "Cloning repository into $APP_DIR..."
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --depth=1 --branch "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
  fi
}

# ── Create .env from template if not present ─────────────────────────────────
create_env() {
  local env_file="$APP_DIR/.env"
  if [[ -f "$env_file" ]]; then
    info ".env already exists — skipping generation"
    return
  fi

  warn ".env not found — generating with random secrets"
  warn "Review $env_file and fill in payment keys before going live!"

  local pg_pass redis_pass jwt_access jwt_refresh internal_secret csrf_secret
  pg_pass=$(openssl rand -hex 24)
  redis_pass=$(openssl rand -hex 32)
  jwt_access=$(openssl rand -hex 32)
  jwt_refresh=$(openssl rand -hex 32)
  internal_secret=$(openssl rand -hex 32)
  csrf_secret=$(openssl rand -hex 32)

  cat > "$env_file" <<EOF
# ── Domain ────────────────────────────────────────────────────────────────────
DOMAIN=faoor.com
ADMIN_EMAIL=admin@faoor.com
ADMIN_PASSWORD_INITIAL=$(openssl rand -hex 12)
ADMIN_USERNAME=admin

# ── Postgres ──────────────────────────────────────────────────────────────────
POSTGRES_USER=app
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=arena
DATABASE_URL=postgresql://app:${pg_pass}@postgres:5432/arena

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${redis_pass}
REDIS_URL=redis://:${redis_pass}@redis:6379

# ── Secrets ───────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=${jwt_access}
JWT_REFRESH_SECRET=${jwt_refresh}
INTERNAL_SECRET=${internal_secret}
CSRF_SECRET=${csrf_secret}

# ── Payments (fill in before going live) ─────────────────────────────────────
PAYMENT_PROVIDER=mock
PUBLIC_BASE_URL=https://faoor.com
BETRA_API_URL=https://betra1.com/api/h2h
BETRA_API_KEY=
BETRA_SECRET=
WESTWALLET_API_URL=https://api.westwallet.io
WESTWALLET_PUBLIC_KEY=
WESTWALLET_PRIVATE_KEY=
WESTWALLET_IPN_IPS=5.188.51.47

# ── Internal URLs ─────────────────────────────────────────────────────────────
GAME_INTERNAL_URL=http://api:3000
GAME_PUBLIC_WS_URL=wss://faoor.com/ws/match
API_PUBLIC_URL=https://faoor.com

# ── Gameplay ──────────────────────────────────────────────────────────────────
TICK_RATE=30

# ── Replays ───────────────────────────────────────────────────────────────────
REPLAY_STORAGE=local
REPLAY_LOCAL_PATH=/var/data/replays

# ── S3 (if REPLAY_STORAGE=s3) ─────────────────────────────────────────────────
S3_ENDPOINT=
S3_BUCKET=
S3_KEY=
S3_SECRET=

# ── Observability ─────────────────────────────────────────────────────────────
SENTRY_DSN=
LOG_LEVEL=info
NODE_ENV=production
EOF

  chmod 600 "$env_file"
  info ".env created at $env_file"
  echo ""
  warn "ADMIN password: $(grep ADMIN_PASSWORD_INITIAL "$env_file" | cut -d= -f2)"
  warn "Save it now — it won't be shown again!"
  echo ""
}

# ── Build & start ─────────────────────────────────────────────────────────────
deploy() {
  cd "$APP_DIR"
  info "Building production images (this may take 5-10 min on first run)..."
  docker compose -f "$COMPOSE_FILE" build --pull

  info "Starting services..."
  docker compose -f "$COMPOSE_FILE" up -d

  info "Waiting for services to be healthy..."
  local tries=0
  until docker compose -f "$COMPOSE_FILE" ps | grep -qE "api.*running|api.*Up"; do
    sleep 3
    tries=$((tries+1))
    [[ $tries -gt 40 ]] && { docker compose -f "$COMPOSE_FILE" logs --tail=50 api; error "API did not start in time"; }
  done

  info "Deployment complete!"
}

# ── Configure firewall (ufw) ──────────────────────────────────────────────────
configure_ufw() {
  if ! command -v ufw &>/dev/null; then return; fi
  ufw allow 22/tcp   comment 'SSH'   2>/dev/null || true
  ufw allow 80/tcp   comment 'HTTP'  2>/dev/null || true
  ufw allow 443/tcp  comment 'HTTPS' 2>/dev/null || true
  ufw allow 443/udp  comment 'HTTPS QUIC' 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
  info "Firewall: ports 22, 80, 443 open"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  info "=== arena1v1 production deploy ==="
  install_docker
  configure_ufw
  fetch_code
  create_env
  deploy
  echo ""
  info "Site: https://faoor.com"
  info "Logs: docker compose -f $APP_DIR/$COMPOSE_FILE logs -f"
}

main "$@"
