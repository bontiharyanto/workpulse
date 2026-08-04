#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Single backup run.
#
# Pipeline:
#   pg_dump --format=custom  →  gzip  →  age (encrypt to recipient)  →  rclone → R2
#
# Then prunes any object older than BACKUP_RETENTION_DAYS from the bucket.
#
# Exit codes:
#   0  — success
#   10 — pg_dump failed
#   20 — encryption failed
#   30 — upload failed
#   40 — prune failed (soft error — dump is safely in R2)
# ==============================================================================
set -euo pipefail

LOG_TAG="[backup]"
log() { echo "${LOG_TAG} $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOCAL_DIR="$(mktemp -d)"
trap 'rm -rf "${LOCAL_DIR}"' EXIT

DUMP_NAME="workpulse-${PGDATABASE}-${TIMESTAMP}.dump.gz.age"
DUMP_PATH="${LOCAL_DIR}/${DUMP_NAME}"

DEST_PATH="dest:${BACKUP_BUCKET}/${BACKUP_PREFIX:-workpulse}/${DUMP_NAME}"

log "starting backup → ${DUMP_NAME}"

# ------------------------------------------------------------------------------
# 1. dump + compress + encrypt in one pipeline (no plaintext on disk).
# ------------------------------------------------------------------------------
if ! pg_dump \
      --host="${PGHOST}" \
      --port="${PGPORT:-5432}" \
      --username="${PGUSER}" \
      --dbname="${PGDATABASE}" \
      --format=custom \
      --compress=0 \
      --no-owner \
      --no-privileges \
    | gzip -c \
    | age -r "${BACKUP_AGE_RECIPIENT}" -o "${DUMP_PATH}"; then
  log "FATAL: dump pipeline failed"
  exit 10
fi

DUMP_SIZE=$(stat -c%s "${DUMP_PATH}" 2>/dev/null || stat -f%z "${DUMP_PATH}")
log "dump ready: ${DUMP_SIZE} bytes encrypted"

# Sanity check — an empty or tiny dump usually means silent auth failure.
if [ "${DUMP_SIZE}" -lt 512 ]; then
  log "FATAL: dump suspiciously small (${DUMP_SIZE} bytes) — refusing to upload"
  exit 20
fi

# ------------------------------------------------------------------------------
# 2. upload
# ------------------------------------------------------------------------------
if ! rclone copyto "${DUMP_PATH}" "${DEST_PATH}" \
      --s3-no-check-bucket \
      --retries 3 \
      --low-level-retries 5 \
      --checkers 2 \
      --transfers 1 \
      --stats 0; then
  log "FATAL: upload to ${DEST_PATH} failed"
  exit 30
fi
log "upload complete: ${DEST_PATH}"

# Emit a small marker file that operators can grep to find the last-good run.
echo "${TIMESTAMP} ${DUMP_NAME} ${DUMP_SIZE}" > /var/lib/workpulse-backup/last-success

# ------------------------------------------------------------------------------
# 3. prune old backups
# ------------------------------------------------------------------------------
RETAIN_DAYS="${BACKUP_RETENTION_DAYS:-30}"
log "pruning objects older than ${RETAIN_DAYS} days"
if ! rclone delete \
      "dest:${BACKUP_BUCKET}/${BACKUP_PREFIX:-workpulse}/" \
      --min-age "${RETAIN_DAYS}d" \
      --s3-no-check-bucket \
      --retries 2 \
      --stats 0; then
  log "WARN: prune step failed — investigate, but dump itself is safe."
  exit 40
fi

log "backup run complete"
