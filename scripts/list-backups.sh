#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Inventory backups in R2/S3.
#
# Usage:
#   ./scripts/list-backups.sh                  # everything under BACKUP_PREFIX
#   ./scripts/list-backups.sh workpulse/manual # a specific subdirectory
#   NEWEST=5 ./scripts/list-backups.sh         # only the 5 most recent objects
#
# Handy for on-call answers to "kapan backup terakhir kelar?" without needing to
# open the R2 dashboard.
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

[ -f "${ENV_FILE}" ] || die "missing ${ENV_FILE}"

SUBPATH="${1:-${BACKUP_PREFIX:-workpulse}}"
NEWEST="${NEWEST:-0}"

if dc ps backup --format json 2>/dev/null | grep -q '"State":"running"'; then
  RUNNER=(dc exec -T backup)
else
  RUNNER=(dc run --rm -T backup)
fi

log_info "listing dest:\${BACKUP_BUCKET}/${SUBPATH}"

if [ "${NEWEST}" -gt 0 ]; then
  # rclone lsf orders alphabetically; timestamped keys sort by time so `tail -n` works.
  "${RUNNER[@]}" bash -c "rclone lsl 'dest:\${BACKUP_BUCKET}/${SUBPATH}/' --s3-no-check-bucket \
    | sort -k2,3 | tail -n ${NEWEST}"
else
  "${RUNNER[@]}" bash -c "rclone lsl 'dest:\${BACKUP_BUCKET}/${SUBPATH}/' --s3-no-check-bucket \
    | sort -k2,3"
fi
