#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Production rollback.
#
# Reads `.last-image-tag` (written by `deploy.sh`) and rolls both api + web
# back to it. Does NOT undo migrations — that's a manual decision because
# `prisma migrate resolve` can lose data if the down-migration drops columns.
#
# Usage:
#   ./scripts/rollback.sh                # rolls to whatever .last-image-tag says
#   FORCE_TAG=v2026.08.01 ./scripts/rollback.sh   # override the tag
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

require_cmd docker
[ -f "${ENV_FILE}" ] || die "missing ${ENV_FILE}"

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

LAST_TAG_FILE="${REPO_ROOT}/.last-image-tag"
TARGET_TAG="${FORCE_TAG:-}"

if [ -z "${TARGET_TAG}" ]; then
  [ -f "${LAST_TAG_FILE}" ] || die "no ${LAST_TAG_FILE} — pass FORCE_TAG=<tag> manually"
  TARGET_TAG="$(cat "${LAST_TAG_FILE}")"
fi

[ -n "${TARGET_TAG}" ] || die "empty rollback tag"

log_warn "rolling api + web back to tag: ${_BOLD}${TARGET_TAG}${_RESET}"
log_warn "database migrations will NOT be reverted automatically."
log_warn "if the new schema is incompatible with ${TARGET_TAG}, abort now (Ctrl-C)."
sleep 5

export IMAGE_TAG="${TARGET_TAG}"

log_info "pulling ${API_IMAGE}:${IMAGE_TAG} + ${WEB_IMAGE}:${IMAGE_TAG}"
dc pull api web

log_info "recreating api + web + caddy with old tag"
dc up -d --no-deps --remove-orphans api
if ! wait_for_service_healthy api 180; then
  die "api did not report healthy after rollback."
fi
dc up -d --no-deps --remove-orphans web caddy

log_ok "rolled back to ${TARGET_TAG}"
log_info "consider running: docker image prune -f  (after you're sure things are stable)"
