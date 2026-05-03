# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache openssl libc6-compat python3 make g++ git
WORKDIR /workspace

# ---------- dev (hot reload via bind mount) ----------
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
# Entrypoint is provided via compose (docker/api-entrypoint.sh) which installs deps,
# generates the prisma client, applies db schema and seed, then starts dev server.

# ---------- build ----------
FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol/package.json packages/protocol/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @arena/api prisma:generate \
 && pnpm --filter @arena/shared build \
 && pnpm --filter @arena/protocol build \
 && pnpm --filter @arena/api build

# ---------- prod ----------
FROM node:22-alpine AS prod
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache openssl libc6-compat tini
WORKDIR /workspace
COPY --from=build /workspace ./
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter @arena/api prisma:deploy && node apps/api/dist/main.js"]
