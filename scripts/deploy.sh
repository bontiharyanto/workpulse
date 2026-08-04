#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Production deploy playbook (blue-green style, single VPS)
#
# Usage:
#   IMAGE_TAG=v2026.08.03 ./scripts/deploy.sh
#   IMAGE_TAG=v2026.08.03 SKIP_MIGRATION_CHECK=1 ./scripts/deploy.sh
#
# What it does (roughly zero-downtime, sub-second connection blip):
#   1. Sanity: env file present, docker daemon up, required binaries available.
#   2. Records the currently running image tags into `.last-image-tag` (for rollback).
#   3. `docker compose pull` new images.
#   4. Runs `prisma migrate deploy` inside a throwaway container BEFORE swapping
#      the API. This surfaces schema errors before any user hits the new build.
#   5. `docker compose up -d --no-deps api web caddy` — recreates one container
#      at a time; existing containers keep serving until the new one is healthy.
#   6. Polls the health endpoint for up to 3 minutes.
#   7. On success: prints the new image digests + tag for audit trail.
#   8. On failure: aborts and prints the rollback command.
#
# Anything that mutates data (migrations, backfills) MUST be forward-compatible
# with the previous release. Never ship a migration that renames or drops a
# column without a shim column first — otherwise rollback becomes impossible.
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

# ------------------------------------------------------------------------------
# 1. Sanity checks
# ------------------------------------------------------------------------------
require_cmd docker curl
[ -f "${ENV_FILE}" ] || die "missing ${ENV_FILE}"
[ -f "${COMPOSE_FILE}" ] || die "missing ${COMPOSE_FILE}"

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

require_env API_IMAGE WEB_IMAGE IMAGE_TAG APP_DOMAIN API_DOMAIN
: "${DEPLOY_HEALTH_URL:=http://127.0.0.1:4000/api/v1/health}"

log_info "deploy target: ${_BOLD}${IMAGE_TAG}${_RESET}"
log_info "compose file:  ${COMPOSE_FILE}"
log_info "env file:      ${ENV_FILE}"

# ------------------------------------------------------------------------------
# 2. Remember the currently running tag for rollback.
# ------------------------------------------------------------------------------
LAST_TAG_FILE="${REPO_ROOT}/.last-image-tag"
CURRENT_TAG="$(dc ps api --format json 2>/dev/null \
  | (grep -oE '"Image":"[^"]*"' || true) \
  | head -n1 | cut -d'"' -f4 | awk -F':' '{print $NF}')"
if [ -n "${CURRENT_TAG:-}" ] && [ "${CURRENT_TAG}" != "${IMAGE_TAG}" ]; then
  echo "${CURRENT_TAG}" > "${LAST_TAG_FILE}"
  log_info "previous tag stashed for rollback: ${CURRENT_TAG}"
fi

# ------------------------------------------------------------------------------
# 3. Pull new images.
# ------------------------------------------------------------------------------
log_info "pulling images..."
dc pull api web

# ------------------------------------------------------------------------------
# 4. Run migrations in a throwaway container FIRST.
#    (`docker compose run --rm` uses the new image but doesn't start the service.)
# ------------------------------------------------------------------------------
if [ "${SKIP_MIGRATION_CHECK:-0}" != "1" ]; then
  log_info "running prisma migrate deploy in a throwaway container..."
  dc run --rm --no-deps --entrypoint sh api \
    -c "node ./node_modules/prisma/build/index.js migrate deploy"
  log_ok "migrations up to date"
else
  log_warn "SKIP_MIGRATION_CHECK=1 — migrations NOT run (assumed handled out-of-band)"
fi

# ------------------------------------------------------------------------------
# 5. Roll containers one by one. Compose does a "recreate" which briefly stops
#    the old container and starts the new one. For truly zero-downtime you'd
#    put another `api` behind a load balancer — out of scope for a pilot.
# ------------------------------------------------------------------------------
log_info "rolling containers: postgres (keep) → api → web → caddy"
dc up -d --no-deps --remove-orphans api
if ! wait_for_service_healthy api 180; then
  log_error "api did not report healthy within 3 minutes."
  log_error "roll back with: ./scripts/rollback.sh"
  exit 2
fi
log_ok "api healthy"

dc up -d --no-deps --remove-orphans web caddy

# ------------------------------------------------------------------------------
# 6. External smoke test (through Caddy on localhost).
# ------------------------------------------------------------------------------
log_info "smoke-testing via public health path..."
if ! wait_for_http_ok "https://${API_DOMAIN}/api/v1/health" 60 3; then
  # Fall back to internal probe — DNS/TLS at the edge may not be up yet on a fresh box.
  log_warn "public probe failed; trying internal probe on the docker network"
  if ! docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" exec -T api \
       wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null; then
    log_error "internal probe also failed — bailing."
    exit 3
  fi
fi

# ------------------------------------------------------------------------------
# 7. Success — log the image digest for the deploy record.
# ------------------------------------------------------------------------------
log_ok "deploy complete."
API_DIGEST="$(docker image inspect "${API_IMAGE}:${IMAGE_TAG}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "unknown")"
WEB_DIGEST="$(docker image inspect "${WEB_IMAGE}:${IMAGE_TAG}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "unknown")"
log_info "api digest: ${API_DIGEST}"
log_info "web digest: ${WEB_DIGEST}"
log_info "record this in your deploy log:"
echo "----------------------------------------------------------------------"
echo "  at:  $(_ts)"
echo "  tag: ${IMAGE_TAG}"
echo "  api: ${API_DIGEST}"
echo "  web: ${WEB_DIGEST}"
echo "----------------------------------------------------------------------"
