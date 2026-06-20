#!/usr/bin/env bash
# Verify the production OpenBrain embedder emits the expected 768-dim vector.
set -euo pipefail

base_url="${OPENBRAIN_EMBEDDER_BASE_URL:-http://127.0.0.1:8096}"
model="${OPENBRAIN_EMBEDDER_MODEL:-google/embeddinggemma-300m}"
expected_dim="${OPENBRAIN_EXPECT_EMBEDDER_DIM:-768}"
attempts="${OPENBRAIN_EMBEDDER_HEALTHCHECK_ATTEMPTS:-30}"
delay="${OPENBRAIN_EMBEDDER_HEALTHCHECK_DELAY:-1}"
base_url="${base_url%/}"

body_json="$(python3 -c 'import json, os; print(json.dumps({"input": "probe", "model": os.environ.get("OPENBRAIN_EMBEDDER_MODEL", "google/embeddinggemma-300m")}))')"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

for attempt in $(seq 1 "$attempts"); do
  if curl -fsS --max-time 5 "$base_url/v1/models" -o "$tmpdir/models.json" 2>"$tmpdir/models.err"; then
    if curl -fsS --max-time 20 "$base_url/v1/embeddings"       -H "Content-Type: application/json"       -d "$body_json"       -o "$tmpdir/embedding.json" 2>"$tmpdir/embedding.err"; then
      python3 - "$tmpdir/embedding.json" "$expected_dim" <<'PY'
import json, sys
body=json.load(open(sys.argv[1]))
expected=int(sys.argv[2])
embedding=body.get('data', [{}])[0].get('embedding')
if not isinstance(embedding, list):
    raise SystemExit(f'no embedding vector in response: {body}')
actual=len(embedding)
if actual != expected:
    raise SystemExit(f'embedder dimension mismatch: expected {expected}, got {actual}')
PY
      echo "OpenBrain embedder healthcheck passed: $base_url model=$model dim=$expected_dim"
      exit 0
    fi
  fi
  [[ "$attempt" -lt "$attempts" ]] && sleep "$delay"
done

cat "$tmpdir/models.err" "$tmpdir/embedding.err" 2>/dev/null || true
echo "OpenBrain embedder healthcheck failed after $attempts attempts: $base_url" >&2
exit 1
