#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Open Brain — backup verification
#
# Runs every check that proves the encrypted-backup pipeline is still
# working end-to-end, and writes a single PASS / FAIL line to
# ~/.openbrain-backups/verify.log so you only need to glance at the
# log to confirm it's healthy.
#
# Designed to run unattended via launchd (com.ryel.openbrain-verify).
#
# Checks performed:
#   1. launchctl shows com.ryel.openbrain-backup is loaded
#   2. At least one backup file exists in ~/.openbrain-backups/
#   3. The newest backup is fresher than 8 days (so the daily schedule
#      is firing at least roughly weekly)
#   4. launchd error log has no lines added since the last verify run
#   5. The newest backup decrypts cleanly via age
#   6. Round-trip restore into openbrain_test_verify works
#   7. Thought count in restored DB ≥ live count − 50 (allows for
#      drift from new captures since the backup snapshot)
#
# Exit codes: 0 = all pass, 1 = at least one check failed.
# ─────────────────────────────────────────────────────────────────────

set -uo pipefail

# ── Configuration ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
RESTORE="${SCRIPT_DIR}/restore.sh"
BACKUP_DIR="${HOME}/.openbrain-backups"
VERIFY_LOG="${BACKUP_DIR}/verify.log"
CONTAINER="openbrain-postgres"
TEST_DB="openbrain_test_verify"
MAX_BACKUP_AGE_DAYS=8

# ── Helpers ──────────────────────────────────────────────────────────
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FAILURES=()

note()  { echo "[${NOW}] $*" >> "${VERIFY_LOG}"; }
fail()  { FAILURES+=("$1"); note "  FAIL: $1"; }
ok()    { note "  ok: $1"; }

# Drop any stale test DB from a prior failed run (don't error if absent)
drop_test_db() {
    docker exec "${CONTAINER}" psql -U "$1" -d postgres \
        -c "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null 2>&1 || true
}

# ── Run ──────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"
note "── verify run ${NOW}"

# Check 1: launchctl shows the backup job is loaded
if launchctl list 2>/dev/null | grep -q "com.ryel.openbrain-backup"; then
    ok "com.ryel.openbrain-backup is loaded"
else
    fail "com.ryel.openbrain-backup is NOT loaded — backups will not run"
fi

# Check 2: at least one backup exists
LATEST_BACKUP="$(ls -t "${BACKUP_DIR}"/openbrain-*.sql.age 2>/dev/null | head -1 || true)"
if [[ -z "${LATEST_BACKUP}" ]]; then
    fail "no backup files found in ${BACKUP_DIR}"
    note "── result: FAIL (no backups to verify)"
    printf '%s FAIL no-backups\n' "${NOW}" >> "${VERIFY_LOG}.summary"
    exit 1
fi
BACKUP_COUNT=$(ls "${BACKUP_DIR}"/openbrain-*.sql.age 2>/dev/null | wc -l | tr -d ' ')
ok "${BACKUP_COUNT} backup(s) on disk; latest = $(basename "${LATEST_BACKUP}")"

# Check 3: latest backup is fresher than threshold
LATEST_AGE_DAYS=$(( ( $(date +%s) - $(stat -f %m "${LATEST_BACKUP}") ) / 86400 ))
if (( LATEST_AGE_DAYS > MAX_BACKUP_AGE_DAYS )); then
    fail "latest backup is ${LATEST_AGE_DAYS} days old (threshold: ${MAX_BACKUP_AGE_DAYS}) — daily schedule may not be firing"
else
    ok "latest backup is ${LATEST_AGE_DAYS} days old (within ${MAX_BACKUP_AGE_DAYS})"
fi

# Check 4: launchd error log
if [[ -s "${BACKUP_DIR}/launchd.err.log" ]]; then
    ERR_BYTES=$(wc -c < "${BACKUP_DIR}/launchd.err.log" | tr -d ' ')
    fail "launchd.err.log has ${ERR_BYTES} bytes of errors — investigate"
else
    ok "launchd.err.log is empty"
fi

# Check 5/6/7: round-trip restore and count comparison
if [[ ! -f "${ENV_FILE}" ]]; then
    fail "${ENV_FILE} missing — cannot run restore round-trip"
elif ! docker ps --filter "name=${CONTAINER}" --filter status=running \
        --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    fail "${CONTAINER} not running — cannot run restore round-trip"
else
    DB_USER=$(grep '^DB_USER=' "${ENV_FILE}" | cut -d= -f2)
    DB_NAME=$(grep '^DB_NAME=' "${ENV_FILE}" | cut -d= -f2)

    # Drop any stale test DB from a prior failed verify
    drop_test_db "${DB_USER}"

    # Run the restore (script returns non-zero on age decrypt failure)
    if "${RESTORE}" "${LATEST_BACKUP}" "${TEST_DB}" >/dev/null 2>&1; then
        ok "round-trip restore into ${TEST_DB} succeeded"

        # Compare thought counts
        LIVE_COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" \
            -t -c "SELECT COUNT(*) FROM thoughts" 2>/dev/null | tr -d ' \n')
        TEST_COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${TEST_DB}" \
            -t -c "SELECT COUNT(*) FROM thoughts" 2>/dev/null | tr -d ' \n')

        DRIFT=$(( LIVE_COUNT - TEST_COUNT ))
        if (( DRIFT < -50 )); then
            fail "test (${TEST_COUNT}) >> live (${LIVE_COUNT}) — backup contains MORE thoughts than live (db reset?)"
        elif (( DRIFT > 50 )); then
            fail "test (${TEST_COUNT}) << live (${LIVE_COUNT}); drift ${DRIFT} > 50 — backup may be too stale"
        else
            ok "thought-count drift ok: live=${LIVE_COUNT} test=${TEST_COUNT} (drift=${DRIFT})"
        fi

        # Drop the test DB only on full success — leave it for inspection on failure
        if [[ ${#FAILURES[@]} -eq 0 ]]; then
            drop_test_db "${DB_USER}"
            ok "dropped ${TEST_DB}"
        else
            note "  (leaving ${TEST_DB} in place for inspection — drop manually with: docker exec ${CONTAINER} psql -U ${DB_USER} -d postgres -c 'DROP DATABASE ${TEST_DB}')"
        fi
    else
        fail "restore.sh ${LATEST_BACKUP} ${TEST_DB} returned non-zero — backup may be corrupt or age key wrong"
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────
if [[ ${#FAILURES[@]} -eq 0 ]]; then
    note "── result: PASS"
    printf '%s PASS\n' "${NOW}" >> "${VERIFY_LOG}.summary"
    exit 0
else
    note "── result: FAIL (${#FAILURES[@]} check(s) failed)"
    for f in "${FAILURES[@]}"; do note "    - $f"; done
    printf '%s FAIL %s\n' "${NOW}" "$(IFS='|'; echo "${FAILURES[*]}")" >> "${VERIFY_LOG}.summary"
    exit 1
fi
