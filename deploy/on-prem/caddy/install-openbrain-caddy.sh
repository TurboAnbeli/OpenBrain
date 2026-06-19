#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: deploy/on-prem/caddy/install-openbrain-caddy.sh [--check|--install] [--no-restart]

Options:
  --check       Validate the repo-managed Caddyfile only. This is the default.
  --install     Install Caddyfile.openbrain to ~/.config/caddy/Caddyfile, validate it, and restart caddy.
  --no-restart  With --install, skip restarting caddy after writing the config.
USAGE
}

mode="--check"
restart=1
for arg in "$@"; do
  case "$arg" in
    --check|--install) mode="$arg" ;;
    --no-restart) restart=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$script_dir/../../.." && pwd)}"
source_config="$OPENBRAIN_HOME/deploy/on-prem/caddy/Caddyfile.openbrain"
dest_config="${CADDY_CONFIG:-$HOME/.config/caddy/Caddyfile}"

if [[ -n "${CADDY_BIN:-}" ]]; then
  caddy_bin="$CADDY_BIN"
elif command -v caddy >/dev/null 2>&1; then
  caddy_bin="$(command -v caddy)"
else
  caddy_bin="$HOME/.local/bin/caddy"
fi

if [[ ! -x "$caddy_bin" ]]; then
  echo "caddy binary not found or not executable: $caddy_bin" >&2
  exit 1
fi
if [[ ! -f "$source_config" ]]; then
  echo "missing source config: $source_config" >&2
  exit 1
fi

# caddy validate: validate the repo-managed config before install
"$caddy_bin" validate --config "$source_config"

if [[ "$mode" == "--check" ]]; then
  echo "Caddy config check passed: $source_config"
  exit 0
fi

mkdir -p "$(dirname "$dest_config")"
if [[ -f "$dest_config" ]]; then
  backup="$dest_config.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$dest_config" "$backup"
  echo "Backed up existing config to $backup"
fi
install -m 0644 "$source_config" "$dest_config"
"$caddy_bin" validate --config "$dest_config"

echo "Installed Caddy config to $dest_config"
if [[ "$restart" == "0" ]]; then
  echo "Skipping Caddy restart (--no-restart)."
  exit 0
fi

if pgrep -x caddy >/dev/null 2>&1; then
  pkill -x caddy
  sleep 1
fi
"$caddy_bin" start --config "$dest_config"
echo "Caddy restarted."
