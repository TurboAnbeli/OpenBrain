# OpenBrain production deployment

This directory is the production-grade deployment target for the OrbStack VM.
It intentionally supersedes the older `deploy/on-prem/systemd` user-service
layout.

## Production standard

- One authoritative API unit: `/etc/systemd/system/openbrain-api.service`.
- The service is managed by system systemd but runs as the locked non-root
  `openbrain` user.
- Runtime code lives under `/opt/openbrain/releases/<timestamp>-<git-sha>` with
  `/opt/openbrain/current` as the active release symlink.
- Runtime config and secrets live under `/etc/openbrain`, not in the repo
  working tree.
- The app is sandboxed with `ProtectSystem=strict`, `ProtectHome=yes`, empty
  capabilities, resource limits, and explicit writable state/cache paths.
- Readiness is stricter than process liveness: `/health`, `/documents?limit=1`,
  and `/embedder/info` must pass before cutover is considered healthy.
- A model-free watchdog timer checks the canonical web URL every two minutes and
  restarts services only with rate limiting.

## Commands

Dry check:

```bash
cd /home/ryan/workspace/openbrain
./deploy/on-prem/production/install-openbrain-production.sh --check
```

Stage a release and install units/config as root:

```bash
orb -m ubuntu -u root /home/ryan/workspace/openbrain/deploy/on-prem/production/install-openbrain-production.sh --stage
```

Cut over to the production system unit:

```bash
orb -m ubuntu -u root /home/ryan/workspace/openbrain/deploy/on-prem/production/install-openbrain-production.sh --cutover
```

Rollback to the legacy user unit:

```bash
orb -m ubuntu -u root /home/ryan/workspace/openbrain/deploy/on-prem/production/install-openbrain-production.sh --rollback-user
```

## Important readiness rule

Do not lower the production healthcheck just to make deployment pass. If
`/embedder/info` has `dimensions: null` or an `error`, the deployment is not
ready even if `/health` returns `healthy`.
