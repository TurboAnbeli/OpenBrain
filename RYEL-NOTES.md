# Open Brain — ryel-local notes

Local-only fork of [srnichols/OpenBrain](https://github.com/srnichols/OpenBrain) (MIT),
adapted to run alongside the existing ryel infrastructure on OrbStack.

This file documents what's different from upstream and how to operate it locally.
For upstream documentation see [README.md](README.md).

## Stack

Four containers, all bound to `127.0.0.1` only (no LAN exposure):

| Container | Image | Host port | Internal port |
|---|---|---|---|
| `openbrain-postgres` | `pgvector/pgvector:pg17` | `127.0.0.1:5433` | 5432 |
| `openbrain-api` (REST + MCP) | locally built (`Dockerfile`) | `127.0.0.1:8001` (REST), `127.0.0.1:8081` (MCP/SSE) | 8000, 8080 |
| `openbrain-ollama` | `ollama/ollama:latest` | `127.0.0.1:11434` | 11434 |
| `openbrain-adminer` | `adminer:latest` | `127.0.0.1:8082` | 8080 |

Why these specific ports: `5432` is reserved for `ryel-postgres`, `8080` is taken by
`ryel-headscale`, so the openbrain stack uses adjacent free ports.

## Files

- `docker-compose.yml` — upstream srnichols, untouched (so future `git pull` is clean)
- `docker-compose.override.yml` — ryel-local customizations (port remapping, Adminer, Ollama)
- `.env` — secrets, mode 600, gitignored. Contains random `DB_PASSWORD` and `MCP_ACCESS_KEY`.
- `.env.example` — upstream template, see for full variable list

## Lifecycle

```bash
cd tools/openbrain

# Start
docker compose up -d

# Status
docker ps --filter name=openbrain

# Logs
docker logs -f openbrain-api

# Stop
docker compose down

# Stop + wipe data (destructive)
docker compose down -v
```

## Endpoints

| Purpose | URL |
|---|---|
| REST API | `http://127.0.0.1:8001/` |
| Health | `http://127.0.0.1:8001/health` |
| MCP (SSE) | `http://127.0.0.1:8081/sse?key=<MCP_ACCESS_KEY>` |
| Adminer (web DB browser) | `http://127.0.0.1:8082/` |
| Ollama API | `http://127.0.0.1:11434/` |

For Adminer login: System=PostgreSQL, Server=`postgres`, User=`openbrain`,
Password=value of `DB_PASSWORD` from `.env`, Database=`openbrain`.

## Embedding & extraction

Both run locally in `openbrain-ollama` — no network calls outside the OrbStack network.

| Role | Model | Size |
|---|---|---|
| Embeddings (768-dim) | `nomic-embed-text` | ~270 MB |
| Metadata extraction (LLM) | `llama3.2` | ~2 GB |

Pull additional models with `docker exec openbrain-ollama ollama pull <model>`.

## Quick smoke test

```bash
# Capture a thought via REST
MCP_KEY=$(grep MCP_ACCESS_KEY .env | cut -d= -f2)
curl -s -X POST http://127.0.0.1:8001/memories \
  -H "Content-Type: application/json" \
  -H "X-Access-Key: ${MCP_KEY}" \
  -d '{"content": "Hello from the local Open Brain."}' | jq

# Search
curl -s -X POST http://127.0.0.1:8001/memories/search \
  -H "Content-Type: application/json" \
  -H "X-Access-Key: ${MCP_KEY}" \
  -d '{"query": "what did I just say hello to?", "limit": 3}' | jq
```

Capture takes ~10–20s on CPU (llama3.2 metadata extraction is the slow step).
Search is sub-second.

## Wire into Claude Code

To use the four MCP tools (`capture_thought`, `search_thoughts`, `list_thoughts`,
`thought_stats`) from Claude Code:

```bash
MCP_KEY=$(grep MCP_ACCESS_KEY tools/openbrain/.env | cut -d= -f2)
claude mcp add openbrain --transport sse \
  "http://127.0.0.1:8081/sse?key=${MCP_KEY}"
```

Then restart Claude Code. Verify by asking it to call `thought_stats`.

## Upstream sync

Upstream is at `https://github.com/srnichols/OpenBrain`. Origin is the personal
fork at `https://github.com/TurboAnbeli/OpenBrain`.

```bash
# Pull upstream changes
git fetch upstream
git merge upstream/master

# Or rebase
git rebase upstream/master
```

Local customizations live in `docker-compose.override.yml` and `.env`, neither
of which collide with upstream files, so merges are clean.

## Differences from upstream srnichols

- All ports rebound to non-default values to coexist with `ryel-postgres` (5432)
  and `ryel-headscale` (8080)
- Ollama runs as a sibling container (not on Mac host) — Mac stays clean per the
  project's "host pristine" pattern
- Adminer added for visual DB browsing in lieu of self-hosted Supabase Studio
- `.env` uses a strong random `DB_PASSWORD` and 64-char hex `MCP_ACCESS_KEY`

## Column-level encryption

`thoughts.content` (plaintext, upstream) is replaced by `thoughts.content_enc`
(bytea, AES via pgcrypto's `pgp_sym_encrypt` PGP message format). The cipher
key lives at `~/.config/ryel/cipher.key` (mode 600, 64-char base64 = 48 bytes
of entropy) and is bind-mounted read-only into the api container at
`/etc/openbrain/cipher.key`.

What's encrypted: `content` only. What's plaintext: `embedding` (numeric
vector, required for similarity search) and `metadata` (structured topics /
people / type, required for filtered queries).

The cipher key is loaded at api startup via `getCipherKey()` in
`src/db/connection.ts`; missing key → server refuses to start ("compliance
by architecture, not user discipline"). Encryption happens in the DB engine,
not the app — the plaintext crosses the loopback Postgres wire but is never
written to disk.

**Migration:** `db/migrations/003-pgcrypto-content-encryption.sql` — apply with
`docker exec -i openbrain-postgres psql -U openbrain -d openbrain < db/migrations/003-pgcrypto-content-encryption.sql`.

**Key rotation** (future): re-encrypt all rows with new key, swap the file
atomically, restart api. Not yet automated.

## Encrypted backups (Phase 5)

`pg_dump` is streamed through `age` symmetric encryption (Filippo Valsorda's
single-binary tool, `brew install age`). The dump file is opaque without the
age secret key at `~/.config/ryel/age.key`. Combined with pgcrypto column
encryption, the backup contains AES-encrypted ciphertext inside an
age-encrypted wrapper — two independent keys, both required.

**Keys:**
- `~/.config/ryel/age.key` — age secret key (mode 600)
- `~/.config/ryel/age.pub` — age public recipient (mode 644)

**Lifecycle:**

```bash
# Backup (writes ~/.openbrain-backups/openbrain-YYYYMMDDTHHMMSSZ.sql.age)
./tools/openbrain/backup.sh

# Restore live (destructive — drops + recreates all tables)
./tools/openbrain/restore.sh ~/.openbrain-backups/openbrain-….sql.age

# Restore to a test DB (non-destructive, for verification)
./tools/openbrain/restore.sh ~/.openbrain-backups/openbrain-….sql.age openbrain_test
```

**Verified:** backup → encrypt → file → decrypt → restore → 259/259 thoughts.
First bytes of the backup file are `age-encryption.org/v1` (the format header)
— confirming on-disk content is encrypted, not plaintext SQL.

**Automated** via launchd at 03:45 daily (30 min after the ryel-postgres
backup at 03:15 to avoid Docker/disk contention). Plist at
`tools/openbrain/com.ryel.openbrain-backup.plist`, installed at
`~/Library/LaunchAgents/com.ryel.openbrain-backup.plist`.

```bash
# Verify it's loaded
launchctl list | grep ryel.openbrain-backup

# Force-run immediately (bypass schedule)
launchctl start com.ryel.openbrain-backup

# Logs
tail -f ~/.openbrain-backups/launchd.out.log
tail -f ~/.openbrain-backups/launchd.err.log

# Disable
launchctl unload -w ~/Library/LaunchAgents/com.ryel.openbrain-backup.plist
```

If the Mac is asleep at 03:45, launchd runs the job at next wake.

## Backup verification (monthly)

A second launchd job, `com.ryel.openbrain-verify`, runs on the 1st of every
month at 04:30 and proves the backup pipeline is still working end-to-end.
Seven checks:

1. `com.ryel.openbrain-backup` is still loaded in launchd
2. At least one backup file exists in `~/.openbrain-backups/`
3. Newest backup is within `MAX_BACKUP_AGE_DAYS` (default 8 days)
4. `launchd.err.log` is empty (no backup-job errors)
5. Newest backup decrypts cleanly via age (key is still valid)
6. Round-trip restore into `openbrain_test_verify` succeeds
7. Thought count drift between live and test DB is < 50

```bash
# Manual run (immediate)
./tools/openbrain/verify.sh

# Or via launchd
launchctl start com.ryel.openbrain-verify

# Quick health check — one PASS/FAIL line per run
tail ~/.openbrain-backups/verify.log.summary

# Full detail
tail ~/.openbrain-backups/verify.log
```

On failure, the script LEAVES `openbrain_test_verify` in place for inspection
rather than dropping it, and writes a detailed log line per failed check.
Drop manually: `docker exec openbrain-postgres psql -U openbrain -d postgres -c "DROP DATABASE openbrain_test_verify"`.

## Claude Code MCP wire-up (Phase 2)

Registered at user scope:

```bash
MCP_KEY=$(grep MCP_ACCESS_KEY tools/openbrain/.env | cut -d= -f2)
claude mcp add openbrain --scope user --transport sse \
    "http://127.0.0.1:8081/sse?key=${MCP_KEY}"
```

Verify with `claude mcp list`. Restart Claude Code for the four MCP tools to
become active in new sessions: `capture_thought`, `search_thoughts`,
`list_thoughts`, `thought_stats` (plus REST equivalents at port 8001).

## Resume-able bulk ingest

See `tools/openbrain-ingest/INGEST-PROGRESS.md` for the list of files already
processed (35 files / 259 thoughts as of 2026-05-02), files remaining in
priority order, and instructions for running incremental batches.

## TODO

- [ ] Cipher-key rotation runbook (pgcrypto column key + age key separately)
- [ ] Resume bulk ingest of remaining `raw/processed/` files when needed
- [ ] Eventually port the openbrain stack onto Tailscale for phone/laptop access
