#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--" ]]; then
  shift
fi

base_url="${1:-http://orbstack-ubuntu.tail361fbc.ts.net:8088/web/}"
base_url="${base_url%/}"
origin="${base_url%/web}"
if [[ "$origin" == "$base_url" ]]; then
  echo "base URL must end with /web or /web/: $base_url" >&2
  exit 2
fi

curl_args=(-fsSL --connect-timeout 10 --max-time 30)
if [[ -n "${OPENBRAIN_WEB_HOST_HEADER:-}" ]]; then
  curl_args+=(-H "Host: ${OPENBRAIN_WEB_HOST_HEADER}")
fi

html_tmp="$(mktemp)"
trap 'rm -f "$html_tmp"' EXIT

asset_prefix="/web/assets/"
health_path="/web/api/health"
documents_path="/web/api/documents?limit=1"

curl "${curl_args[@]}" "$base_url/" -o "$html_tmp"
if ! grep -q "OpenBrain" "$html_tmp"; then
  echo "HTML healthcheck failed: OpenBrain title not found" >&2
  exit 1
fi

mapfile -t assets < <(python3 - "$html_tmp" <<'PY_ASSETS'
from pathlib import Path
import re
import sys
html = Path(sys.argv[1]).read_text()
for asset in sorted(set(re.findall(r'["\'](/web/assets/[^"\']+\.(?:js|css))["\']', html))):
    print(asset)
PY_ASSETS
)
if [[ "${#assets[@]}" -lt 2 ]]; then
  echo "asset healthcheck failed: expected JS and CSS assets under ${asset_prefix}" >&2
  exit 1
fi
for asset in "${assets[@]}"; do
  case "$asset" in
    ${asset_prefix}*) curl "${curl_args[@]}" "$origin$asset" >/dev/null ;;
    *) echo "unexpected asset path: $asset" >&2; exit 1 ;;
  esac
done

health_json="$(curl "${curl_args[@]}" "$origin$health_path")"
HEALTH_JSON="$health_json" python3 - <<'PY_HEALTH'
import json, os
payload=json.loads(os.environ['HEALTH_JSON'])
assert payload.get('status') == 'healthy', payload
PY_HEALTH

docs_json="$(curl "${curl_args[@]}" "$origin$documents_path")"
DOCS_JSON="$docs_json" python3 - <<'PY_DOCS'
import json, os
payload=json.loads(os.environ['DOCS_JSON'])
assert isinstance(payload.get('documents'), list), payload
assert payload.get('limit') == 1, payload
PY_DOCS

echo "OpenBrain web healthcheck passed: $base_url"
