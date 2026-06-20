#!/usr/bin/env bash
# Deterministic OpenBrain web watchdog. Silent on success. On repeated failures,
# restarts the authoritative API plus whichever Caddy service is active. It is
# intentionally model-free and suitable for systemd timer or Hermes no-agent cron.
set -euo pipefail

CANONICAL_URL="${OPENBRAIN_WEB_URL:-http://orbstack-ubuntu.tail361fbc.ts.net:8088/web/}"
CANONICAL_API="${OPENBRAIN_WEB_API_URL:-http://orbstack-ubuntu.tail361fbc.ts.net:8088/web/api/health}"
LOCAL_URL="${OPENBRAIN_LOCAL_WEB_URL:-http://127.0.0.1:8088/web/}"
HOST_HEADER="${OPENBRAIN_HOST_HEADER:-orbstack-ubuntu.tail361fbc.ts.net}"
STATE_DIR="${OPENBRAIN_WATCHDOG_STATE_DIR:-/var/lib/openbrain-watchdog}"
STATE_FILE="$STATE_DIR/state.env"
MAX_RESTARTS_PER_HOUR="${OPENBRAIN_WATCHDOG_MAX_RESTARTS_PER_HOUR:-2}"

mkdir -p "$STATE_DIR"
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE" || true
fi
FAILURES="${FAILURES:-0}"
LAST_RESTART_EPOCH="${LAST_RESTART_EPOCH:-0}"
RESTARTS_THIS_HOUR="${RESTARTS_THIS_HOUR:-0}"
RESTART_HOUR="${RESTART_HOUR:-0}"
now="$(date +%s)"
hour="$(( now / 3600 ))"
if [[ "$RESTART_HOUR" != "$hour" ]]; then
  RESTART_HOUR="$hour"
  RESTARTS_THIS_HOUR=0
fi

check_one() {
  local label="$1" url="$2" extra_header="${3:-}"
  if [[ -n "$extra_header" ]]; then
    curl -fsS --max-time 10 -H "$extra_header" "$url" >/dev/null
  else
    curl -fsS --max-time 10 "$url" >/dev/null
  fi
}

errors=()
check_one canonical_web "$CANONICAL_URL" || errors+=("canonical_web failed: $CANONICAL_URL")
check_one canonical_api "$CANONICAL_API" || errors+=("canonical_api failed: $CANONICAL_API")
check_one local_host_header "$LOCAL_URL" "Host: $HOST_HEADER" || errors+=("local host-header web failed: $LOCAL_URL Host:$HOST_HEADER")

save_state() {
  umask 077
  cat >"$STATE_FILE" <<EOF
FAILURES=$FAILURES
LAST_RESTART_EPOCH=$LAST_RESTART_EPOCH
RESTARTS_THIS_HOUR=$RESTARTS_THIS_HOUR
RESTART_HOUR=$RESTART_HOUR
EOF
}

if [[ "${#errors[@]}" -eq 0 ]]; then
  FAILURES=0
  save_state
  exit 0
fi

FAILURES=$(( FAILURES + 1 ))
action="alert-only"
if [[ "$FAILURES" -ge 2 ]]; then
  if [[ "$RESTARTS_THIS_HOUR" -lt "$MAX_RESTARTS_PER_HOUR" ]]; then
    action="restart-services"
    RESTARTS_THIS_HOUR=$(( RESTARTS_THIS_HOUR + 1 ))
    LAST_RESTART_EPOCH="$now"
    systemctl restart openbrain-api.service || true
    if systemctl is-active --quiet caddy.service; then
      systemctl restart caddy.service || true
    elif [[ -d /run/user/501 ]]; then
      runuser -u ryan -- env XDG_RUNTIME_DIR=/run/user/501 systemctl --user restart caddy.service || true
    fi
  else
    action="restart-rate-limited"
  fi
fi
save_state

{
  echo "OpenBrain web watchdog: failure_count=$FAILURES action=$action"
  printf ' - %s\n' "${errors[@]}"
  echo "canonical_url=$CANONICAL_URL"
  echo "time=$(date -Is)"
} >&2
exit 1
