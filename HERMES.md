# OpenBrain — Hermes MCP Setup

Instructions for connecting the Hermes agent to the local OpenBrain MCP server.

## Prerequisites

The OpenBrain Docker stack must be running. Verify:

```bash
curl -s http://127.0.0.1:8081/health
# Expected: {"status":"healthy","service":"open-brain-mcp"}
```

If not running, start it:

```bash
cd ~/dev/ryel/tools/openbrain
docker compose up -d
```

## Connect Hermes

Extract the MCP key and register the server in one step:

```bash
MCP_KEY=$(grep MCP_ACCESS_KEY ~/dev/ryel/tools/openbrain/.env | cut -d= -f2)
hermes mcp add openbrain --url "http://127.0.0.1:8081/sse?key=${MCP_KEY}"
```

The key is embedded in the SSE URL as a query parameter — no separate `--auth` flag needed.

Verify it registered:

```bash
hermes mcp list
# Should show: openbrain  http://127.0.0.1:8081/sse?key=...  all  ✓ enabled
```

## Test the connection

```bash
hermes mcp test openbrain
```

Or start a session and call `thought_stats` — it returns the current thought count and type breakdown with no side effects.

## Available tools

| Tool | Purpose |
|------|---------|
| `search_thoughts` | Semantic search across all ingested thoughts |
| `list_thoughts` | List thoughts filtered by type, topic, person, or date range |
| `capture_thought` | Store a single thought with metadata |
| `capture_thoughts` | Batch-store multiple thoughts (used by ingest pipeline) |
| `update_thought` | Edit an existing thought by UUID |
| `delete_thought` | Remove a thought by UUID |
| `thought_stats` | Count thoughts by type — good smoke test, no side effects |

`search_thoughts` is the primary read tool. Pass a natural-language query; results are ranked by semantic similarity. Supports `project`, `type`, and `topic` filters.

## What's in the brain

The database holds ingested knowledge from `raw/processed/` — trading frameworks, macro theses, options strategies, critical minerals research, AI/software notes, and personal context. As of 2026-05-02, ~750+ thoughts across domains: `trading`, `macro`, `investing`, `commodities`, `ai`, `medicine`, `personal`.

For ryel wiki/journal queries, use the `ryel` MCP (already wired). OpenBrain is for semantic search across the denser, structured thought extracts from processed source material.

## Disable / remove

```bash
hermes mcp configure openbrain   # toggle individual tools on/off
hermes mcp remove openbrain      # full removal
```

## Key location

```
~/dev/ryel/tools/openbrain/.env   (mode 600, gitignored)
```

The key is a 64-char hex string. Do not commit it or log it.
