#!/bin/sh
set -e
cd /workspace
echo "[web] installing dependencies..."
pnpm install --no-frozen-lockfile
echo "[web] building shared packages..."
pnpm --filter @arena/shared build
pnpm --filter @arena/protocol build
echo "[web] starting vite dev..."
exec pnpm --filter @arena/web dev --host 0.0.0.0
