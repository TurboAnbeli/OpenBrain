# OpenBrain Web Caddy Deployment

This directory contains the repo-managed Caddy deployment for the React/Vite OpenBrain web frontend.

## URLs

- Remote/Tailscale: `http://orbstack-ubuntu.tail361fbc.ts.net:8088/web/`
- Local host-header smoke: `OPENBRAIN_WEB_HOST_HEADER=orbstack-ubuntu.tail361fbc.ts.net ./deploy/on-prem/caddy/openbrain-web-healthcheck.sh http://127.0.0.1:8088/web/`

`openbrain.tail361fbc.ts.net` is also accepted by the Caddy host matcher, but in this tailnet it is a separate Tailscale device. The VM that actually runs Caddy is `orbstack-ubuntu.tail361fbc.ts.net`.

## Build

```bash
pnpm run web:build
```

Caddy serves the static build from `packages/web/dist`; content changes do not require a Caddy restart.

## Validate/install Caddy config

```bash
./deploy/on-prem/caddy/install-openbrain-caddy.sh --check
./deploy/on-prem/caddy/install-openbrain-caddy.sh --install
```

## Healthcheck

```bash
./deploy/on-prem/caddy/openbrain-web-healthcheck.sh http://orbstack-ubuntu.tail361fbc.ts.net:8088/web/
```
