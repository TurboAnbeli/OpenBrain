#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Open Brain — encrypted backup
#
# Streams pg_dump from openbrain-postgres through age-encryption into
# a timestamped file. The backup file is opaque without the age secret
# key at ~/.config/ryel/age.key.
#
# Threat model: protects backups that land in iCloud, Time Machine,
# external drives, etc. Combined with pgcrypto column encryption, the
# backup contains AES-encrypted ciphertext inside an age-encrypted
# wrapper — two independent keys, both required.
#
# Usage:
#   ./tools/openbrain/backup.sh           # backup to default location
#   ./tools/openbrain/backup.sh /custom/path.sql.age
#
# Restore:
#   ./tools/openbrain/restore.sh <backup-file>
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
AGE_PUB="${HOME}/.config/ryel/age.pub"
BACKUP_DIR="${HOME}/.openbrain-backups"
CONTAINER="openbrain-postgres"

# ── Sanity checks ────────────────────────────────────────────────────
if ! command -v age >/dev/null 2>&1; then
    echo "ERROR: age not installed. Run: brew install age" >&2
    exit 1
fi

if [[ ! -f "${AGE_PUB}" ]]; then
    echo "ERROR: age public key not found at ${AGE_PUB}" >&2
    echo "       Generate one with: age-keygen -o ~/.config/ryel/age.key && age-keygen -y ~/.config/ryel/age.key > ~/.config/ryel/age.pub" >&2
    exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} not found. Is the openbrain stack set up?" >&2
    exit 1
fi

if ! docker ps --filter "name=${CONTAINER}" --filter status=running --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    echo "ERROR: ${CONTAINER} container is not running. docker compose up -d" >&2
    exit 1
fi

# ── Run ──────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

DEFAULT_OUT="${BACKUP_DIR}/openbrain-$(date -u +%Y%m%dT%H%M%SZ).sql.age"
OUT="${1:-${DEFAULT_OUT}}"

# shellcheck disable=SC1090
DB_USER=$(grep '^DB_USER=' "${ENV_FILE}" | cut -d= -f2)
DB_NAME=$(grep '^DB_NAME=' "${ENV_FILE}" | cut -d= -f2)
RECIPIENT=$(cat "${AGE_PUB}")

echo "▸ pg_dump ${DB_NAME} (container: ${CONTAINER})"
echo "▸ encrypting with age recipient ${RECIPIENT}"
echo "▸ writing to ${OUT}"

# Stream: docker exec → pg_dump → age stdin → encrypted file
# --format=custom (-Fc) is compressed and supports parallel restore;
# we use plain SQL (-Fp) instead because plaintext SQL streams cleanly
# through age and is easier to diff if you ever decrypt to inspect.
docker exec "${CONTAINER}" pg_dump \
    -U "${DB_USER}" -d "${DB_NAME}" \
    --no-owner --no-privileges --clean --if-exists \
| age -r "${RECIPIENT}" -o "${OUT}"

chmod 600 "${OUT}"
SIZE=$(du -h "${OUT}" | awk '{print $1}')
echo "✓ wrote ${OUT} (${SIZE})"
