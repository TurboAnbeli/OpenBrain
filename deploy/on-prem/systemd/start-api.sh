#!/usr/bin/env bash
# Launch the OpenBrain REST (:8000) + MCP (:8080) API server.
# All configuration (DB_*, CIPHER_KEY_PATH, OLLAMA_*, OPENBRAIN_*) is read from
# the repo's .env — nothing secret is hardcoded here. Invoked by the
# openbrain-api.service systemd --user unit; also runnable directly.
set -euo pipefail

# Repo root = three levels up from deploy/on-prem/systemd/
OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
cd "$OPENBRAIN_HOME"

[[ -f .env ]] || { echo "missing $OPENBRAIN_HOME/.env" >&2; exit 1; }
[[ -f dist/index.js ]] || { echo "missing dist/index.js — run 'pnpm build' in $OPENBRAIN_HOME" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source ./.env
set +a

exec node dist/index.js
