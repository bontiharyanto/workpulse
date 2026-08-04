#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Backup sidecar entrypoint
#
# Renders a supercronic crontab from `${BACKUP_CRON}` and enters the loop. Also
# runs the retention pruner on every tick (idempotent, cheap).
# ==============================================================================
set -euo pipefail

STATE_DIR="/var/lib/workpulse-backup"
mkdir -p "${STATE_DIR}"

CRONTAB_FILE="${STATE_DIR}/crontab"
# NOTE: supercronic parses the standard 5-field crontab syntax (min hour dom mon dow).
cat >"${CRONTAB_FILE}" <<EOF
# Managed by docker/backup/entrypoint.sh — do not edit by hand.
${BACKUP_CRON:-15 19 * * *}  /usr/local/bin/run-backup.sh
EOF

echo "[backup] cron schedule: ${BACKUP_CRON:-15 19 * * *} (UTC)"
echo "[backup] destination:   ${BACKUP_BUCKET}/${BACKUP_PREFIX:-workpulse}"
echo "[backup] retention:     ${BACKUP_RETENTION_DAYS:-30} days"

# Fail fast if any critical env var is missing — better than silent skips.
for var in PGHOST PGUSER PGDATABASE BACKUP_BUCKET BACKUP_AGE_RECIPIENT \
           RCLONE_S3_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "[backup] FATAL: env var ${var} is empty — aborting." >&2
    exit 1
  fi
done

# Configure rclone via env (no config file). Uses the `s3` remote named `dest`.
export RCLONE_CONFIG_DEST_TYPE=s3
export RCLONE_CONFIG_DEST_PROVIDER="${RCLONE_S3_PROVIDER:-Cloudflare}"
export RCLONE_CONFIG_DEST_ENDPOINT="${RCLONE_S3_ENDPOINT}"
export RCLONE_CONFIG_DEST_ACCESS_KEY_ID="${RCLONE_S3_ACCESS_KEY_ID}"
export RCLONE_CONFIG_DEST_SECRET_ACCESS_KEY="${RCLONE_S3_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_DEST_REGION="${RCLONE_S3_REGION:-auto}"

echo "[backup] entering supercronic loop."
exec /usr/local/bin/supercronic "${CRONTAB_FILE}"
