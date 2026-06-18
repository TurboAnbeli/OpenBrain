#!/usr/bin/env bash
# Launch the OpenBrain consolidation worker daemon.
# All configuration (DB_*, CIPHER_KEY_PATH, OLLAMA_*, OPENBRAIN_*) is read from
# the repo's .env — nothing secret is hardcoded here.
set -euo pipefail

OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
cd "$OPENBRAIN_HOME"

[[ -f .env ]] || { echo "missing $OPENBRAIN_HOME/.env" >&2; exit 1; }
[[ -f dist/jobs/consolidation-worker-cli.js ]] || { echo "missing dist/jobs/consolidation-worker-cli.js — run pnpm build in $OPENBRAIN_HOME" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source ./.env
set +a

exec node dist/jobs/consolidation-worker-cli.js
