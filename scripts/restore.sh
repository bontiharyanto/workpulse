#!/usr/bin/env bash
# ==============================================================================
# Workpulse — Restore from an age-encrypted `pg_dump` in R2/S3.
#
# INTENDED USE-CASES:
#   1. Quarterly restore drill on a STAGING VPS (never on the primary!).
#   2. Real disaster recovery — after `docker compose down` + wiping the
#      compromised database.
#
# Usage:
#   AGE_IDENTITY_FILE=/root/backup-key.txt \
#     BACKUP_OBJECT=workpulse-workpulse-20260803T191500Z.dump.gz.age \
#     ./scripts/restore.sh
#
# What it does:
#   1. Ensures BACKUP_OBJECT exists in the bucket.
#   2. Downloads it into a local temp dir.
#   3. Decrypts with the private key (age identity file) → gunzip → pg_restore.
#   4. Loads into a database name of your choice (default: ${PGDATABASE}_restored).
#   5. Runs `SELECT COUNT(*)` on a few core tables so we know it's not a corrupt dump.
#
# THIS SCRIPT DOES NOT TOUCH THE LIVE `${PGDATABASE}`. Use `psql` manually to
# swap databases once you're satisfied.
# ==============================================================================
set -euo pipefail

source "$(dirname "$0")/lib/ops-common.sh"

[ -f "${ENV_FILE}" ] || die "missing ${ENV_FILE}"

# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

require_env BACKUP_OBJECT AGE_IDENTITY_FILE POSTGRES_USER POSTGRES_DB
[ -f "${AGE_IDENTITY_FILE}" ] || die "identity file not found: ${AGE_IDENTITY_FILE}"

RESTORE_DB="${RESTORE_DB:-${POSTGRES_DB}_restored_$(date -u +%Y%m%dT%H%M%SZ)}"
LOCAL_DIR="$(mktemp -d)"
trap 'rm -rf "${LOCAL_DIR}"' EXIT

log_info "restore drill starting"
log_info "  source object:  ${BACKUP_OBJECT}"
log_info "  target DB name: ${RESTORE_DB}"

# ------------------------------------------------------------------------------
# 1. Download from R2 via the backup sidecar (has rclone + creds pre-configured).
# ------------------------------------------------------------------------------
if ! dc ps backup --format json 2>/dev/null | grep -q '"State":"running"'; then
  log_warn "starting backup sidecar temporarily so we can use rclone"
  dc up -d backup
  sleep 5
fi

# Copy the object out of the sidecar via docker cp.
log_info "downloading from R2..."
dc exec -T backup bash -c "rclone copyto 'dest:\${BACKUP_BUCKET}/\${BACKUP_PREFIX:-workpulse}/${BACKUP_OBJECT}' /tmp/${BACKUP_OBJECT} --s3-no-check-bucket"
dc cp "backup:/tmp/${BACKUP_OBJECT}" "${LOCAL_DIR}/${BACKUP_OBJECT}"
dc exec -T backup rm -f "/tmp/${BACKUP_OBJECT}" || true

FSIZE=$(stat -c%s "${LOCAL_DIR}/${BACKUP_OBJECT}" 2>/dev/null || stat -f%z "${LOCAL_DIR}/${BACKUP_OBJECT}")
[ "${FSIZE}" -gt 512 ] || die "downloaded object suspiciously small (${FSIZE} bytes)"
log_ok "downloaded ${FSIZE} bytes"

# ------------------------------------------------------------------------------
# 2. Decrypt + decompress inside the postgres container (has pg_restore).
# ------------------------------------------------------------------------------
require_cmd age
log_info "decrypting locally with ${AGE_IDENTITY_FILE}"
age -d -i "${AGE_IDENTITY_FILE}" -o "${LOCAL_DIR}/dump.gz" "${LOCAL_DIR}/${BACKUP_OBJECT}"
gunzip -f "${LOCAL_DIR}/dump.gz"   # produces dump (custom-format pg_dump)
DUMP_FILE="${LOCAL_DIR}/dump"

# ------------------------------------------------------------------------------
# 3. Load into Postgres. We `docker cp` the dump into the postgres container
#    because pg_restore needs local file access.
# ------------------------------------------------------------------------------
log_info "creating fresh database: ${RESTORE_DB}"
dc exec -T postgres createdb -U "${POSTGRES_USER}" "${RESTORE_DB}"

log_info "shipping dump into postgres container"
dc cp "${DUMP_FILE}" "postgres:/tmp/wp-restore.dump"

log_info "running pg_restore (custom-format, --clean --if-exists --no-owner)"
dc exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" \
  -d "${RESTORE_DB}" \
  --no-owner --no-privileges \
  --exit-on-error \
  --verbose \
  /tmp/wp-restore.dump 2>&1 | tail -n 20
dc exec -T postgres rm -f /tmp/wp-restore.dump

# ------------------------------------------------------------------------------
# 4. Sanity check.
# ------------------------------------------------------------------------------
log_info "sanity check — row counts on core tables"
dc exec -T postgres psql -U "${POSTGRES_USER}" -d "${RESTORE_DB}" -c "
  SELECT 'User'         AS tbl, COUNT(*) FROM \"User\"       UNION ALL
  SELECT 'Company'      AS tbl, COUNT(*) FROM \"Company\"    UNION ALL
  SELECT 'Attendance'   AS tbl, COUNT(*) FROM \"Attendance\" UNION ALL
  SELECT 'LeaveRequest' AS tbl, COUNT(*) FROM \"LeaveRequest\" UNION ALL
  SELECT 'AuditLog'     AS tbl, COUNT(*) FROM \"AuditLog\";
"

log_ok "restore drill complete. Database ${RESTORE_DB} is populated."
log_info "next steps (manual):"
echo "   - inspect with:   docker compose exec postgres psql -U ${POSTGRES_USER} -d ${RESTORE_DB}"
echo "   - swap into prod: ALTER DATABASE ${POSTGRES_DB} RENAME TO ${POSTGRES_DB}_old;"
echo "                      ALTER DATABASE ${RESTORE_DB} RENAME TO ${POSTGRES_DB};"
echo "     (only after stopping the API to prevent write during the swap!)"
