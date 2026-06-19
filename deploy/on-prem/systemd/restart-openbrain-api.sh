#!/usr/bin/env bash
# Build, reload, restart, and smoke-check the OpenBrain API systemd --user service.
set -euo pipefail

OPENBRAIN_HOME="${OPENBRAIN_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
cd "$OPENBRAIN_HOME"

pnpm build
chmod +x deploy/on-prem/systemd/start-api.sh deploy/on-prem/systemd/openbrain-api-healthcheck.sh
mkdir -p "$HOME/.config/systemd/user"
cp deploy/on-prem/systemd/openbrain-api.service "$HOME/.config/systemd/user/openbrain-api.service"
systemctl --user daemon-reload
systemctl --user restart openbrain-api.service
deploy/on-prem/systemd/openbrain-api-healthcheck.sh
systemctl --user --no-pager --lines=3 status openbrain-api.service
