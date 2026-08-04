#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Post-deploy / on-call health probe.
#
# Runs `curl` against:
#   - shallow    /api/v1/health           (already checked by Docker HEALTHCHECK)
#   - deep       /api/v1/health/deep      (DB + S3 + worker states — Fase Beta)
# and prints a compact one-liner per dependency. Exit 0 if everything is OK,
# exit 1 if any dependency is degraded, exit 2 if any is down.
#
# Usage:
#   ./scripts/health-check.sh                    # probes API_DOMAIN via HTTPS
#   HEALTH_URL=http://127.0.0.1:4000/api/v1/health/deep ./scripts/health-check.sh
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

require_cmd curl jq

if [ -f "${ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi

HEALTH_URL="${HEALTH_URL:-https://${API_DOMAIN:-localhost}/api/v1/health/deep}"

log_info "probing ${HEALTH_URL}"
RESPONSE="$(curl -fsS --max-time 10 "${HEALTH_URL}" || true)"
if [ -z "${RESPONSE}" ]; then
  log_error "deep health endpoint unreachable"
  exit 2
fi

# Pretty-print the JSON body.
echo "${RESPONSE}" | jq .

# Extract the summary status if present. Falls back to 200-OK optimism.
STATUS="$(echo "${RESPONSE}" | jq -r '.status // "ok"')"
case "${STATUS}" in
  ok)         log_ok "overall status: ${STATUS}"; exit 0 ;;
  degraded)   log_warn "overall status: ${STATUS}"; exit 1 ;;
  down|error) log_error "overall status: ${STATUS}"; exit 2 ;;
  *)          log_warn "unknown status: ${STATUS}"; exit 1 ;;
esac
