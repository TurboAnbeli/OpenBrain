#!/usr/bin/env bash
# Run a single consolidation cycle (one LLM call) then exit.
# Invoked by consolidation-worker.timer every 15 minutes.
#
# Environment (sourced from .env or systemd override):
#   OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT — dedicated LLM endpoint for consolidation
#   OPENBRAIN_LLM_CONSOLIDATION_MODEL    — LLM model for consolidation (default gemma-4-E4B-it)
#   OLLAMA_ENDPOINT                      — fallback LLM endpoint
set -euo pipefail

OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$OPENBRAIN_HOME"

[[ -f .env ]] || { echo "missing $OPENBRAIN_HOME/.env" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source ./.env
set +a

exec npx tsx src/workers/consolidation-worker-cli.ts --once
