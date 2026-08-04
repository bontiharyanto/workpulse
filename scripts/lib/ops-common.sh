#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Shared OPS helpers.
#
# Source this file from any operational script:
#   source "$(dirname "$0")/lib/ops-common.sh"
#
# Provides:
#   - COMPOSE_FILE, ENV_FILE constants (overridable from the outer script)
#   - log_info / log_warn / log_error with colour + timestamp
#   - require_cmd / require_env
#   - dc (wrapper around `docker compose -f ... --env-file ...`)
#   - wait_for_http_ok
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.production}"

# ---- pretty log helpers ------------------------------------------------------
if [ -t 1 ]; then
  _RESET="$(printf '\033[0m')"
  _RED="$(printf '\033[31m')"
  _GREEN="$(printf '\033[32m')"
  _YELLOW="$(printf '\033[33m')"
  _BLUE="$(printf '\033[34m')"
  _BOLD="$(printf '\033[1m')"
else
  _RESET=""; _RED=""; _GREEN=""; _YELLOW=""; _BLUE=""; _BOLD=""
fi

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log_info()  { echo "${_BLUE}[INFO ]${_RESET} $(_ts) $*"; }
log_ok()    { echo "${_GREEN}[ OK  ]${_RESET} $(_ts) $*"; }
log_warn()  { echo "${_YELLOW}[WARN ]${_RESET} $(_ts) $*" >&2; }
log_error() { echo "${_RED}[ERROR]${_RESET} $(_ts) $*" >&2; }
die()       { log_error "$*"; exit 1; }

require_cmd() {
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "missing required command: ${c}"
  done
}

require_env() {
  for var in "$@"; do
    if [ -z "${!var:-}" ]; then
      die "required env var not set: ${var}"
    fi
  done
}

# `dc` wraps docker compose with the standard args for this project. Every
# ops script uses this instead of raw `docker compose` so overrides via
# COMPOSE_FILE / ENV_FILE apply consistently.
dc() {
  if [ -f "${ENV_FILE}" ]; then
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
  else
    docker compose -f "${COMPOSE_FILE}" "$@"
  fi
}

# Poll `url` until it returns HTTP 2xx or the deadline passes.
# Usage: wait_for_http_ok "http://…/health" 120 3
#   timeout_seconds — total budget (default 120)
#   interval_seconds — between probes (default 3)
wait_for_http_ok() {
  local url="$1"
  local timeout="${2:-120}"
  local interval="${3:-3}"
  local elapsed=0

  while [ "${elapsed}" -lt "${timeout}" ]; do
    if curl -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${interval}"
    elapsed=$((elapsed + interval))
  done
  return 1
}

# Wait for a compose service to become `healthy` (Docker healthcheck state).
# Usage: wait_for_service_healthy api 90
wait_for_service_healthy() {
  local svc="$1"
  local timeout="${2:-120}"
  local elapsed=0

  while [ "${elapsed}" -lt "${timeout}" ]; do
    local status
    status="$(dc ps --format json "${svc}" 2>/dev/null \
      | (grep -oE '"Health":"[^"]*"' || true) \
      | head -n1 | cut -d'"' -f4)"
    if [ "${status}" = "healthy" ]; then
      return 0
    fi
    if [ "${status}" = "unhealthy" ]; then
      log_warn "service ${svc} reported unhealthy — will keep polling until timeout"
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  return 1
}
