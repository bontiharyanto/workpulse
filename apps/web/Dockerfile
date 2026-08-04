# syntax=docker/dockerfile:1.7
# ==============================================================================
# Workpulse Web — multi-stage Dockerfile (Next.js standalone output)
#
# Build from repo root:
#   $ docker build -f apps/web/Dockerfile -t workpulse/web:local .
# ==============================================================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /workspace

# ---- deps -------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined at build time. Provide a sane default that can
# be overridden by `docker build --build-arg NEXT_PUBLIC_API_URL=...`.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter @workpulse/shared-types build \
 && pnpm --filter @workpulse/web build

# ---- runtime ----------------------------------------------------------------
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini \
 && addgroup -S nodejs -g 1001 \
 && adduser -S -G nodejs -u 1001 workpulse

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

# Next standalone output places server.js under apps/web/ relative to workspace root
# (because outputFileTracingRoot points to the monorepo root).
COPY --from=build --chown=workpulse:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=workpulse:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=workpulse:nodejs /workspace/apps/web/public ./apps/web/public

USER workpulse

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
