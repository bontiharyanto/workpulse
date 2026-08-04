#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Manual (ad-hoc) backup runner.
#
# Wraps the same sidecar image the cron uses so the encryption + retention
# behaviour is identical between "manual" and "scheduled" backups.
#
# Usage:
#   ./scripts/backup.sh                # runs the standard pipeline
#   TAG=pre-migration ./scripts/backup.sh   # marks the object with an extra prefix
#
# Produces one age-encrypted `pg_dump` in the configured R2/S3 bucket.
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

[ -f "${ENV_FILE}" ] || die "missing ${ENV_FILE}"

log_info "starting ad-hoc backup (delegating to the backup sidecar)"

# `docker compose exec` runs in the already-running backup container so the
# rclone remote + env stays consistent. If the sidecar is not up (e.g. we're
# doing a pre-launch dry run) fall back to `run --rm`.
if dc ps backup --format json 2>/dev/null | grep -q '"State":"running"'; then
  RUNNER=(dc exec -T backup)
else
  log_warn "backup sidecar not running — using ephemeral run instead"
  RUNNER=(dc run --rm -T backup)
fi

# Optionally prefix with a manual tag so pre-migration snapshots are easy to find.
if [ -n "${TAG:-}" ]; then
  export BACKUP_PREFIX="${BACKUP_PREFIX:-workpulse}/manual/${TAG}"
  log_info "using custom prefix: ${BACKUP_PREFIX}"
fi

"${RUNNER[@]}" bash -c "BACKUP_PREFIX='${BACKUP_PREFIX:-workpulse}' /usr/local/bin/run-backup.sh"
log_ok "ad-hoc backup finished"
