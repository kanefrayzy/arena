# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN apk add --no-cache git
WORKDIR /workspace

FROM base AS dev
ENV NODE_ENV=development
EXPOSE 5173
# Entrypoint provided via compose (docker/web-entrypoint.sh).

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/protocol/package.json packages/protocol/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @arena/shared build \
 && pnpm --filter @arena/protocol build \
 && pnpm --filter @arena/web build

FROM nginx:1.27-alpine AS prod
COPY --from=build /workspace/apps/web/dist /srv/web
COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
