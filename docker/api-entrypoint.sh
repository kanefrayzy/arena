#!/bin/sh
set -e

cd /workspace

echo "[api] installing dependencies..."
pnpm install --no-frozen-lockfile

echo "[api] building shared packages..."
pnpm --filter @arena/shared build
pnpm --filter @arena/protocol build

echo "[api] generating prisma client..."
pnpm --filter @arena/api prisma:generate

echo "[api] applying migrations..."
# Use db push for first run if no migrations folder exists
if [ -z "$(ls -A apps/api/prisma/migrations 2>/dev/null)" ]; then
  pnpm --filter @arena/api exec prisma db push --schema=./prisma/schema.prisma --skip-generate --accept-data-loss
else
  pnpm --filter @arena/api exec prisma migrate deploy --schema=./prisma/schema.prisma
fi

echo "[api] seeding database (idempotent)..."
pnpm --filter @arena/api prisma:seed || echo "[api] seed failed (continuing)"

echo "[api] starting dev server..."
exec pnpm --filter @arena/api dev
