# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache python3 make g++ libc6-compat git
WORKDIR /workspace

FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3001
# Entrypoint provided via compose (docker/game-entrypoint.sh).

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/game/package.json apps/game/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol/package.json packages/protocol/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @arena/shared build \
 && pnpm --filter @arena/protocol build \
 && pnpm --filter @arena/game build

FROM node:22-alpine AS prod
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache libc6-compat tini
WORKDIR /workspace
COPY --from=build /workspace ./
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/game/dist/server.js"]
