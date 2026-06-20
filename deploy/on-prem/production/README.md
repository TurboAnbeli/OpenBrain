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

## Local GGUF embedder

Option 2 productionizes the local 768-dimensional EmbeddingGemma GGUF path:

- Model repo: `unsloth/embeddinggemma-300m-GGUF`
- Pinned file: `embeddinggemma-300M-Q8_0.gguf`
- SHA-256: `a0f7b4e13c397a6e1b32c2de75b1f65a14c92ec524d5f674d94a4290a1c4969b`
- Runtime path: `/opt/openbrain/models/embeddinggemma/embeddinggemma-300M-Q8_0.gguf`
- Service: `/etc/systemd/system/openbrain-embedder.service`
- Endpoint: `http://127.0.0.1:8096/v1/embeddings`
- API-facing model/version: `google/embeddinggemma-300m`

The service runs as the locked `openbrain` user and uses Ollama's bundled
`/usr/local/lib/ollama/llama-server`; it does not depend on HuggingFace auth at
runtime. The model installer validates the pinned checksum before enabling the
service.

Manual healthcheck:

```bash
/usr/local/lib/openbrain/openbrain-embedder-healthcheck.sh
```

The API unit has an `ExecStartPre` gate on that healthcheck, so a production API
start cannot silently proceed with a dead embedder.

When switching from the previous Python FP service to the GGUF server, reindex
all document chunks until `/embedder/info` reports `reindex_required: false`.
Thought rows already use the canonical `google/embeddinggemma-300m` version.

Direct chunk reindex helper (faster than long HTTP requests):

```bash
OPENBRAIN_HOME=/home/ryan/workspace/openbrain node deploy/on-prem/production/reindex-document-chunks-gguf.mjs --limit=25 --batch-size=8
```
