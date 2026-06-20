#!/usr/bin/env bash
# Idempotent production installer/cutover for OpenBrain on the OrbStack VM.
set -euo pipefail

SRC="${OPENBRAIN_SOURCE_DIR:-/home/ryan/workspace/openbrain}"
RELEASE_ROOT="${OPENBRAIN_RELEASE_ROOT:-/opt/openbrain}"
CONFIG_DIR="${OPENBRAIN_CONFIG_DIR:-/etc/openbrain}"
SERVICE_USER="${OPENBRAIN_SERVICE_USER:-openbrain}"
SERVICE_GROUP="${OPENBRAIN_SERVICE_GROUP:-openbrain}"
LEGACY_USER="${OPENBRAIN_LEGACY_USER:-ryan}"
MODE="${1:---check}"

usage() {
  cat <<'EOF'
Usage: install-openbrain-production.sh [--check|--stage|--cutover|--rollback-user]

  --check          Validate source files and unit syntax.
  --stage          Build source, create /opt/openbrain release, install /etc config and units.
  --cutover        Stop old user/root API units, start hardened system unit, run readiness check.
  --rollback-user  Stop system unit and restore legacy systemd --user service.
EOF
}

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "$MODE requires root. On OrbStack use: orb -m ubuntu -u root $SRC/deploy/on-prem/production/install-openbrain-production.sh $MODE" >&2
    exit 77
  fi
}

legacy_user_systemctl() {
  if [[ -d /run/user/501 ]]; then
    runuser -u "$LEGACY_USER" -- env XDG_RUNTIME_DIR=/run/user/501 systemctl --user "$@"
  else
    runuser -u "$LEGACY_USER" -- systemctl --user "$@"
  fi
}

validate_source() {
  [[ -d "$SRC" ]] || { echo "missing source dir: $SRC" >&2; exit 1; }
  [[ -f "$SRC/package.json" ]] || { echo "missing package.json" >&2; exit 1; }
  [[ -f "$SRC/.env" ]] || { echo "missing source .env" >&2; exit 1; }
  [[ -f "$SRC/dist/index.js" ]] || { echo "missing dist/index.js; run pnpm build" >&2; exit 1; }
  chmod +x "$SRC/deploy/on-prem/production/openbrain-production-healthcheck.sh" "$SRC/deploy/on-prem/production/openbrain-web-watchdog.sh" "$SRC/deploy/on-prem/production/install-openbrain-production.sh"
  command -v node >/dev/null || { echo "node not found" >&2; exit 1; }
  if command -v systemd-analyze >/dev/null; then
    systemd-analyze verify "$SRC/deploy/on-prem/production/openbrain-api.service" >/dev/null
  fi
}

ensure_identity() {
  getent group "$SERVICE_GROUP" >/dev/null || groupadd --system "$SERVICE_GROUP"
  if ! getent passwd "$SERVICE_USER" >/dev/null; then
    useradd --system --gid "$SERVICE_GROUP" --home-dir /var/lib/openbrain --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

build_source() {
  runuser -u "$LEGACY_USER" -- bash -lc "cd '$SRC' && pnpm build && pnpm --filter @openbrain/web build"
}

stage_release() {
  local sha release_id release_dir
  sha="$(runuser -u "$LEGACY_USER" -- git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  release_id="$(date -u +%Y%m%dT%H%M%SZ)-$sha"
  release_dir="$RELEASE_ROOT/releases/$release_id"
  install -d -o root -g "$SERVICE_GROUP" -m 0750 "$RELEASE_ROOT/releases" "$release_dir"

  cp -a "$SRC/dist" "$release_dir/"
  cp -a "$SRC/node_modules" "$release_dir/"
  cp -a "$SRC/models" "$release_dir/"
  install -m 0640 -o root -g "$SERVICE_GROUP" "$SRC/package.json" "$release_dir/package.json"
  [[ -f "$SRC/pnpm-lock.yaml" ]] && install -m 0640 -o root -g "$SERVICE_GROUP" "$SRC/pnpm-lock.yaml" "$release_dir/pnpm-lock.yaml"
  [[ -f "$SRC/pnpm-workspace.yaml" ]] && install -m 0640 -o root -g "$SERVICE_GROUP" "$SRC/pnpm-workspace.yaml" "$release_dir/pnpm-workspace.yaml"
  install -d -o root -g "$SERVICE_GROUP" -m 0750 "$release_dir/packages/web"
  cp -a "$SRC/packages/web/dist" "$release_dir/packages/web/"
  install -d -o root -g "$SERVICE_GROUP" -m 0750 "$release_dir/deploy/on-prem/production"
  cp -a "$SRC/deploy/on-prem/production/." "$release_dir/deploy/on-prem/production/"
  chown -R root:"$SERVICE_GROUP" "$release_dir"
  chmod -R g+rX,o-rwx "$release_dir"

  ln -sfn "$release_dir" "$RELEASE_ROOT/current.next"
  mv -Tf "$RELEASE_ROOT/current.next" "$RELEASE_ROOT/current"
  echo "$release_dir" > "$RELEASE_ROOT/CURRENT_RELEASE"
}

stage_config() {
  install -d -o root -g "$SERVICE_GROUP" -m 0750 "$CONFIG_DIR"
  if [[ -f "$CONFIG_DIR/openbrain.env" ]]; then
    cp -a "$CONFIG_DIR/openbrain.env" "$CONFIG_DIR/openbrain.env.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  python3 - "$SRC/.env" "$CONFIG_DIR/openbrain.env" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]); dst=Path(sys.argv[2])
lines=[]; seen=set()
for raw in src.read_text().splitlines():
    if not raw or raw.lstrip().startswith('#') or '=' not in raw:
        lines.append(raw); continue
    k,v=raw.split('=',1); seen.add(k)
    if k == 'CIPHER_KEY_PATH': v='/etc/openbrain/cipher.key'
    elif k == 'API_HOST': v='127.0.0.1'
    elif k == 'MCP_HOST': v='127.0.0.1'
    lines.append(f'{k}={v}')
for k,v in {'API_PORT':'8000','MCP_PORT':'8080'}.items():
    if k not in seen: lines.append(f'{k}={v}')
dst.write_text('\n'.join(lines).rstrip()+'\n')
PY
  chown root:"$SERVICE_GROUP" "$CONFIG_DIR/openbrain.env"
  chmod 0640 "$CONFIG_DIR/openbrain.env"

  local old_cipher
  old_cipher="$(python3 - "$SRC/.env" <<'PY'
from pathlib import Path
import sys
for raw in Path(sys.argv[1]).read_text().splitlines():
    if raw.startswith('CIPHER_KEY_PATH='):
        print(raw.split('=',1)[1]); break
PY
)"
  if [[ -n "$old_cipher" && -f "$old_cipher" ]]; then
    install -m 0640 -o root -g "$SERVICE_GROUP" "$old_cipher" "$CONFIG_DIR/cipher.key"
  fi
}

install_units() {
  # Archive legacy drop-ins from the previous root-managed service. Hidden drop-ins
  # silently weaken/alter the production unit and must not survive cutover.
  if [[ -d /etc/systemd/system/openbrain-api.service.d ]]; then
    install -d -m 0750 -o root -g root /etc/openbrain/unit-backups
    mv /etc/systemd/system/openbrain-api.service.d "/etc/openbrain/unit-backups/openbrain-api.service.d.$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  install -m 0644 -o root -g root "$SRC/deploy/on-prem/production/openbrain-api.service" /etc/systemd/system/openbrain-api.service
  install -d -m 0755 -o root -g root /usr/local/lib/openbrain
  install -m 0755 -o root -g root "$SRC/deploy/on-prem/production/openbrain-production-healthcheck.sh" /usr/local/lib/openbrain/openbrain-production-healthcheck.sh
  install -m 0755 -o root -g root "$SRC/deploy/on-prem/production/openbrain-web-watchdog.sh" /usr/local/lib/openbrain/openbrain-web-watchdog.sh
  install -m 0644 -o root -g root "$SRC/deploy/on-prem/production/openbrain-web-watchdog.service" /etc/systemd/system/openbrain-web-watchdog.service
  install -m 0644 -o root -g root "$SRC/deploy/on-prem/production/openbrain-web-watchdog.timer" /etc/systemd/system/openbrain-web-watchdog.timer
  systemctl daemon-reload
}

cutover() {
  systemctl stop openbrain-api.service 2>/dev/null || true
  legacy_user_systemctl stop openbrain-api.service 2>/dev/null || true
  systemctl reset-failed openbrain-api.service 2>/dev/null || true
  systemctl enable --now openbrain-api.service
  if /usr/local/lib/openbrain/openbrain-production-healthcheck.sh; then
    legacy_user_systemctl disable openbrain-api.service 2>/dev/null || true
    systemctl enable --now openbrain-web-watchdog.timer
    echo "OpenBrain production cutover complete"
  else
    echo "production healthcheck failed; rolling back to legacy user service" >&2
    systemctl stop openbrain-api.service || true
    legacy_user_systemctl enable --now openbrain-api.service
    exit 1
  fi
}

rollback_user() {
  systemctl stop openbrain-api.service 2>/dev/null || true
  legacy_user_systemctl enable --now openbrain-api.service
  echo "Rolled back to legacy user openbrain-api.service"
}

case "$MODE" in
  --check)
    validate_source
    echo "OpenBrain production deployment check passed"
    ;;
  --stage)
    need_root
    validate_source
    ensure_identity
    build_source
    stage_release
    stage_config
    install_units
    echo "OpenBrain production release staged at $(readlink -f "$RELEASE_ROOT/current")"
    ;;
  --cutover)
    need_root
    validate_source
    [[ -L "$RELEASE_ROOT/current" ]] || { echo "missing $RELEASE_ROOT/current; run --stage first" >&2; exit 1; }
    install_units
    cutover
    ;;
  --rollback-user)
    need_root
    rollback_user
    ;;
  -h|--help)
    usage
    ;;
  *)
    usage >&2; exit 2 ;;
esac
