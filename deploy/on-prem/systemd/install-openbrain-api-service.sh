#!/usr/bin/env bash
# Install or validate the OpenBrain API systemd --user service.
set -euo pipefail

mode="${1:---check}"
OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
unit_src="$OPENBRAIN_HOME/deploy/on-prem/systemd/openbrain-api.service"
start_script="$OPENBRAIN_HOME/deploy/on-prem/systemd/start-api.sh"
healthcheck="$OPENBRAIN_HOME/deploy/on-prem/systemd/openbrain-api-healthcheck.sh"
unit_dst="$HOME/.config/systemd/user/openbrain-api.service"

usage() {
  echo "Usage: $0 [--check|--install]"
}

validate_files() {
  [[ -f "$unit_src" ]] || { echo "missing $unit_src" >&2; exit 1; }
  [[ -x "$start_script" ]] || { echo "missing executable $start_script" >&2; exit 1; }
  [[ -x "$healthcheck" ]] || { echo "missing executable $healthcheck" >&2; exit 1; }
  grep -q "ExecStart=%h/workspace/openbrain/deploy/on-prem/systemd/start-api.sh" "$unit_src" || {
    echo "service ExecStart does not point to start-api.sh" >&2; exit 1;
  }
  grep -q "dist/index.js" "$start_script" || { echo "start-api.sh must launch dist/index.js" >&2; exit 1; }
  ! grep -q "dist/api/index.js" "$start_script" || { echo "start-api.sh must not use dist/api/index.js" >&2; exit 1; }
}

case "$mode" in
  --check)
    validate_files
    systemctl --user cat openbrain-api.service >/dev/null 2>&1 || true
    echo "OpenBrain API service deployment check passed"
    ;;
  --install)
    validate_files
    mkdir -p "$HOME/.config/systemd/user"
    cp "$unit_src" "$unit_dst"
    systemctl --user daemon-reload
    systemctl --user enable --now openbrain-api.service
    "$healthcheck"
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
