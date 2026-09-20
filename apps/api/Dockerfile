# syntax=docker/dockerfile:1.7
# ==============================================================================
# Workpulse API — multi-stage Dockerfile
#
# Build from repo root:
#   $ docker build -f apps/api/Dockerfile -t workpulse/api:local .
#
# Stages:
#   base    — shared runtime deps (Alpine + openssl for Prisma + tini)
#   deps    — installs pnpm workspace deps (cached)
#   build   — compiles shared-types + Prisma client + Nest bundle
#   runtime — slim image, non-root user, runs `prisma migrate deploy` then Nest
# ==============================================================================

FROM node:25-alpine AS base
RUN apk add --no-cache libc6-compat openssl tini
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

# ---- deps -------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm --filter @workpulse/shared-types build \
 && pnpm --filter @workpulse/api exec prisma generate \
 && pnpm --filter @workpulse/api build

# Produce a pruned, self-contained deployment directory containing only
# the api's production runtime + resolved workspace deps.
RUN pnpm --filter @workpulse/api --prod deploy /pruned

# ---- runtime ----------------------------------------------------------------
FROM node:25-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl tini \
 && addgroup -S nodejs -g 1001 \
 && adduser -S -G nodejs -u 1001 workpulse

ENV NODE_ENV=production
ENV APP_TIMEZONE=Asia/Jakarta
ENV PORT=4000

WORKDIR /app

COPY --from=build --chown=workpulse:nodejs /pruned/package.json ./
COPY --from=build --chown=workpulse:nodejs /pruned/node_modules ./node_modules
COPY --from=build --chown=workpulse:nodejs /workspace/apps/api/dist ./dist
COPY --from=build --chown=workpulse:nodejs /workspace/apps/api/prisma ./prisma

USER workpulse

EXPOSE 4000

# Healthcheck target — Nest exposes /api/v1/health as @Public()
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# Apply pending migrations then boot Nest. Migration failure fails the container
# (better than booting against a stale schema).
CMD ["sh", "-c", "node ./node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
