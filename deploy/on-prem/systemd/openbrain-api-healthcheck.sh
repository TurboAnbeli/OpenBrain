#!/usr/bin/env bash
# Smoke-check the OpenBrain API service without requiring admin credentials.
set -euo pipefail

base_url="${OPENBRAIN_API_BASE_URL:-http://127.0.0.1:8000}"
attempts="${OPENBRAIN_HEALTHCHECK_ATTEMPTS:-20}"
delay="${OPENBRAIN_HEALTHCHECK_DELAY:-1}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift ;;
    -h|--help)
      echo "Usage: $0 [base_url]"
      exit 0
      ;;
    *) base_url="$1"; shift ;;
  esac
done
base_url="${base_url%/}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fetch() {
  local path="$1" out="$2"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS --max-time 20 "$base_url$path" -o "$out" 2>"$out.err"; then
      return 0
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      sleep "$delay"
    fi
  done
  if [[ -s "$out.err" ]]; then cat "$out.err" >&2; fi
  echo "healthcheck failed after $attempts attempts: $base_url$path" >&2
  return 1
}

fetch "/health" "$tmpdir/health.json"
python3 - "$tmpdir/health.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if body.get("status") != "healthy":
    raise SystemExit(f"health failed: {body}")
PY

fetch "/embedder/info" "$tmpdir/embedder.json"
python3 - "$tmpdir/embedder.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if not body.get("provider"):
    raise SystemExit(f"embedder info missing provider: {body}")
if body.get("dimensions") is None:
    raise SystemExit(f"embedder dimensions unavailable: {body}")
PY

fetch "/documents?limit=1" "$tmpdir/documents.json"
python3 - "$tmpdir/documents.json" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
if "documents" not in body or not isinstance(body["documents"], list):
    raise SystemExit(f"documents healthcheck failed: {body}")
PY

echo "OpenBrain API healthcheck passed: $base_url"
