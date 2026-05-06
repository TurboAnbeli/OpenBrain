#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Open Brain — encrypted restore
#
# Decrypts an age-encrypted pg_dump and pipes it back into
# openbrain-postgres. Reads the secret key from ~/.config/ryel/age.key.
#
# Usage:
#   ./tools/openbrain/restore.sh ~/.openbrain-backups/openbrain-2026….sql.age
#   ./tools/openbrain/restore.sh ~/.openbrain-backups/…sql.age openbrain_test
#
# The optional second argument restores into a DIFFERENT database name
# (used for non-destructive verification — restore into a test DB,
# compare row counts, drop the test DB).
#
# WARNING: restoring into the live `openbrain` DB will DROP and
# recreate every table (the dump uses --clean --if-exists). Confirm
# the file is the right one before running.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
AGE_KEY="${HOME}/.config/ryel/age.key"
CONTAINER="openbrain-postgres"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <backup-file.sql.age> [target-db-name]" >&2
    exit 1
fi

BACKUP="$1"
TARGET_DB="${2:-}"

if [[ ! -f "${BACKUP}" ]]; then
    echo "ERROR: backup file not found: ${BACKUP}" >&2
    exit 1
fi
if [[ ! -f "${AGE_KEY}" ]]; then
    echo "ERROR: age secret key not found at ${AGE_KEY}" >&2
    exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} not found" >&2
    exit 1
fi

DB_USER=$(grep '^DB_USER=' "${ENV_FILE}" | cut -d= -f2)
DB_NAME=$(grep '^DB_NAME=' "${ENV_FILE}" | cut -d= -f2)
RESTORE_DB="${TARGET_DB:-${DB_NAME}}"

echo "▸ restoring ${BACKUP}"
echo "▸ target database: ${RESTORE_DB} (user ${DB_USER})"

# Confirm before destructive overwrite of live DB
if [[ "${RESTORE_DB}" == "${DB_NAME}" ]]; then
    read -r -p "This will DROP and recreate all tables in ${DB_NAME}. Continue? [y/N] " ans
    if [[ ! "${ans}" =~ ^[Yy]$ ]]; then
        echo "aborted"
        exit 1
    fi
fi

# Create the target DB if it doesn't exist (for test restores)
if [[ "${RESTORE_DB}" != "${DB_NAME}" ]]; then
    echo "▸ creating ${RESTORE_DB} (if it doesn't exist)"
    docker exec "${CONTAINER}" psql -U "${DB_USER}" -d postgres \
        -c "CREATE DATABASE ${RESTORE_DB}" 2>/dev/null || true
    docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${RESTORE_DB}" \
        -c "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
fi

# Stream: encrypted file → age decrypt → docker exec psql
age -d -i "${AGE_KEY}" "${BACKUP}" \
| docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${RESTORE_DB}" \
    -v ON_ERROR_STOP=1 --quiet

echo "✓ restored to ${RESTORE_DB}"

# Quick sanity check
COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${RESTORE_DB}" \
    -t -c "SELECT COUNT(*) FROM thoughts" | tr -d ' \n')
echo "▸ thoughts in ${RESTORE_DB}: ${COUNT}"
