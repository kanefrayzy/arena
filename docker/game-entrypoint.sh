#!/bin/sh
set -e
cd /workspace
echo "[game] installing dependencies..."
pnpm install --no-frozen-lockfile
echo "[game] building shared packages..."
pnpm --filter @arena/shared build
pnpm --filter @arena/protocol build
echo "[game] starting dev server..."
exec pnpm --filter @arena/game dev
