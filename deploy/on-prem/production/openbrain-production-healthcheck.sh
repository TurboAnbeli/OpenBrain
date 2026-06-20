#!/usr/bin/env bash
# Production readiness check for OpenBrain API. This is intentionally stricter
# than /health: it catches DB/API route failures and embedder dependency loss.
set -euo pipefail

base_url="${OPENBRAIN_API_BASE_URL:-http://127.0.0.1:8000}"
require_embedder="${OPENBRAIN_REQUIRE_EMBEDDER:-1}"
attempts="${OPENBRAIN_HEALTHCHECK_ATTEMPTS:-20}"
delay="${OPENBRAIN_HEALTHCHECK_DELAY:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-embedder) require_embedder=0; shift ;;
    --) shift ;;
    -h|--help)
      echo "Usage: $0 [--no-embedder] [base_url]"
      exit 0
      ;;
    *) base_url="$1"; shift ;;
  esac
done
base_url="${base_url%/}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fetch() {
  local path="$1" out="$2" attempt
  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 20 "$base_url$path" -o "$out" 2>"$out.err"; then
      return 0
    fi
    [[ "$attempt" -lt "$attempts" ]] && sleep "$delay"
  done
  [[ -s "$out.err" ]] && cat "$out.err" >&2
  echo "readiness failed after $attempts attempts: $base_url$path" >&2
  return 1
}

fetch "/health" "$tmpdir/health.json"
python3 - "$tmpdir/health.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if body.get("status") != "healthy":
    raise SystemExit(f"/health not healthy: {body}")
PY

fetch "/documents?limit=1" "$tmpdir/documents.json"
python3 - "$tmpdir/documents.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if not isinstance(body.get("documents"), list):
    raise SystemExit(f"documents route did not return a documents list: {body}")
PY

if [[ "$require_embedder" == "1" ]]; then
  fetch "/embedder/info" "$tmpdir/embedder.json"
  python3 - "$tmpdir/embedder.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if not body.get("provider"):
    raise SystemExit(f"embedder provider missing: {body}")
if body.get("dimensions") is None:
    raise SystemExit(f"embedder dimensions unavailable: {body}")
if body.get("error"):
    raise SystemExit(f"embedder reports error: {body.get('error')}")
PY
fi

echo "OpenBrain production readiness passed: $base_url"
