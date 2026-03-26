# Open Brain - Deployment Guide

> Step-by-step setup: Supabase, OpenRouter, Edge Functions, MCP clients, and Slack.

---

## Prerequisites

- A modern web browser
- A GitHub account (for Supabase login)
- 45 minutes of focused time
- No coding experience required (copy-paste setup)

---

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in with GitHub
2. Click **"New Project"**
3. Configure:
   - **Name**: `open-brain` (or any name)
   - **Database Password**: Generate a strong password (save it!)
   - **Region**: Choose closest to you
   - **Pricing Plan**: Free tier works
4. Wait for project to finish provisioning (~2 minutes)
5. Note your **Project Reference ID** (in Settings → General)

---

## Step 2: Set Up Database

### 2a. Enable pgvector

Go to **SQL Editor** in Supabase Dashboard and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2b. Create thoughts table

```sql
CREATE TABLE thoughts (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    content    TEXT        NOT NULL,
    embedding  VECTOR(1536),
    metadata   JSONB       DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 2c. Create auto-update trigger

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON thoughts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 2d. Create indexes

```sql
-- Vector similarity search (HNSW, cosine distance)
CREATE INDEX idx_thoughts_embedding
    ON thoughts
    USING hnsw (embedding vector_cosine_ops);

-- Metadata filtering (JSONB containment)
CREATE INDEX idx_thoughts_metadata
    ON thoughts
    USING gin (metadata);

-- Date range queries
CREATE INDEX idx_thoughts_created_at
    ON thoughts (created_at DESC);
```

### 2e. Create match_thoughts function

> **Note:** If using Ollama (self-hosted), change `VECTOR(1536)` to `VECTOR(768)` in this function and in the table definition above.

```sql
CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding  VECTOR(1536),
    match_threshold  FLOAT   DEFAULT 0.5,
    match_count      INT     DEFAULT 10,
    filter           JSONB   DEFAULT '{}'::jsonb,
    project_filter   TEXT    DEFAULT NULL,
    include_archived BOOLEAN DEFAULT false,
    user_filter      TEXT    DEFAULT NULL
)
RETURNS TABLE (
    id         UUID,
    content    TEXT,
    metadata   JSONB,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.content,
        t.metadata,
        1 - (t.embedding <=> query_embedding) AS similarity,
        t.created_at
    FROM thoughts t
    WHERE
        1 - (t.embedding <=> query_embedding) >= match_threshold
        AND t.metadata @> filter
        AND (project_filter IS NULL OR t.project = project_filter)
        AND (include_archived OR t.archived = false)
        AND (user_filter IS NULL OR t.created_by = user_filter)
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;
```

### 2f. Enable Row Level Security

```sql
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
```

---

## Step 3: Get OpenRouter API Key

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign in or create account
3. Go to **Keys** section
4. Create new API key
5. Copy the key (starts with `sk-or-...`)
6. Free tier includes enough credits for initial setup

---

## Step 4: Generate MCP Access Key

On your local machine, run:

```bash
# Linux/Mac
openssl rand -hex 32

# Windows (PowerShell)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })

# Or use any method to generate a 64-character hex string
```

Save this key — you'll need it for both Supabase secrets and client configuration.

---

## Step 5: Set Supabase Secrets

### Option A: Via Supabase CLI

```bash
# Install CLI
npm install -g supabase

# Login
supabase login

# Link to project
supabase link --project-ref <your-project-ref>

# Set secrets
supabase secrets set OPENROUTER_API_KEY=sk-or-your-key-here
supabase secrets set MCP_ACCESS_KEY=your-64-char-hex-key
```

### Option B: Via Supabase Dashboard

1. Go to **Settings → Edge Functions** in Supabase Dashboard
2. Add each secret:
   - `OPENROUTER_API_KEY` = your OpenRouter key
   - `MCP_ACCESS_KEY` = your 64-char hex key

**Note**: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — do not set manually.

> **Self-hosted (Docker/K8s)?** See the [README — Environment Variables](README.md#environment-variables) section for the full env var reference including Ollama config, ports, and database settings.

---

## Step 6: Deploy Edge Functions

### 6a. Initialize Supabase in your project

```bash
cd E:/GitHub/OpenBrain
supabase init
```

### 6b. Create the MCP server edge function

```bash
supabase functions new open-brain-mcp
```

This creates `supabase/functions/open-brain-mcp/index.ts`. Replace its content with your MCP server implementation (see [03-EDGE-FUNCTIONS.md](03-EDGE-FUNCTIONS.md)).

### 6c. Create the ingest function (optional, for Slack)

```bash
supabase functions new ingest-thought
```

Replace content with the Slack webhook handler (see [03-EDGE-FUNCTIONS.md](03-EDGE-FUNCTIONS.md)).

### 6d. Deploy

```bash
# Deploy MCP server
supabase functions deploy open-brain-mcp --no-verify-jwt

# Deploy Slack capture (if using)
supabase functions deploy ingest-thought --no-verify-jwt
```

**`--no-verify-jwt`** is required because these functions handle their own authentication.

### 6e. Verify deployment

```bash
# List deployed functions
supabase functions list

# Test MCP server
curl -H "x-brain-key: YOUR_KEY" \
     https://<your-ref>.supabase.co/functions/v1/open-brain-mcp
```

---

## Step 7: Configure AI Clients

### Claude Desktop

Edit `claude_desktop_config.json`:

**Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
    "mcpServers": {
        "open-brain": {
            "url": "https://<your-ref>.supabase.co/functions/v1/open-brain-mcp?key=<your-key>",
            "transport": "sse"
        }
    }
}
```

Restart Claude Desktop after saving.

### Claude Code

```bash
# Add MCP server to Claude Code
claude mcp add open-brain \
    --url "https://<your-ref>.supabase.co/functions/v1/open-brain-mcp" \
    --header "x-brain-key: <your-key>"
```

### ChatGPT

1. Settings → Developer Mode → Enable
2. Add MCP Connector:
   - URL: `https://<your-ref>.supabase.co/functions/v1/open-brain-mcp?key=<your-key>`
   - Authentication: None (key is in URL)
3. Note: ChatGPT's built-in memory gets disabled — Open Brain replaces it

### Cursor

Create `.cursor/mcp.json` in your project:

```json
{
    "mcpServers": {
        "open-brain": {
            "url": "https://<your-ref>.supabase.co/functions/v1/open-brain-mcp",
            "transport": "sse",
            "headers": {
                "x-brain-key": "<your-key>"
            }
        }
    }
}
```

---

## Step 8: Slack Integration (Optional)

### 8a. Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Name: `Open Brain` (or any name)
4. Select your workspace

### 8b. Configure Bot

1. Go to **OAuth & Permissions**
2. Add Bot Token Scopes:
   - `chat:write` (post replies)
   - `channels:history` (read messages)
3. Install to workspace
4. Copy **Bot User OAuth Token** (`xoxb-...`)

### 8c. Enable Event Subscriptions

1. Go to **Event Subscriptions** → Enable
2. Request URL: `https://<your-ref>.supabase.co/functions/v1/ingest-thought`
3. Subscribe to bot events: `message.channels`
4. Save Changes

### 8d. Set Slack Secrets

```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-token-here
supabase secrets set SLACK_CAPTURE_CHANNEL=C0123456789
```

Get the channel ID by right-clicking the channel in Slack → View Channel Details → scroll to bottom.

### 8e. Add Bot to Channel

In Slack, go to your capture channel and type `/invite @Open Brain`.

---

## Step 9: Verify Everything Works

### Test 1: Capture a thought

In Claude (or any connected AI):
```
Use the capture_thought tool to save: "Test thought — verifying Open Brain setup is working correctly."
```

### Test 2: Search for it

```
Use the search_thoughts tool to search for "setup verification"
```

### Test 3: Check stats

```
Use the thought_stats tool to show brain statistics
```

### Test 4: Slack capture (if configured)

Type in your Slack capture channel:
```
Testing Open Brain Slack integration — this should be captured automatically.
```

---

## Troubleshooting

### Auth Errors (401)

| Client | Issue | Fix |
|---|---|---|
| Claude Desktop | Can't send headers | Use URL param: `?key=<key>` |
| ChatGPT | Can't send headers | Use URL param: `?key=<key>` |
| Claude Code | Key mismatch | Verify key matches Supabase secret |
| All clients | Key wrong | Re-check `MCP_ACCESS_KEY` secret in Supabase |

### Edge Function Errors

```bash
# Check logs
supabase functions logs open-brain-mcp --follow
supabase functions logs ingest-thought --follow
```

### Database Issues

- **"extension vector does not exist"**: Run `CREATE EXTENSION IF NOT EXISTS vector;`
- **"function match_thoughts does not exist"**: Re-run the function creation SQL
- **Schema cache issues**: Restart Edge Functions or redeploy

### Common Mistakes

1. Rewriting working code instead of fixing configuration
2. Wrong Supabase project ref in URL
3. Forgetting `--no-verify-jwt` on deploy
4. Setting authentication to something other than "none" in ChatGPT
5. Not restarting Claude Desktop after config change

---

## Cost Summary

| Service | Free Tier Includes | Paid Tier |
|---|---|---|
| Supabase | 500MB DB, 500K Edge Function invocations | $25/mo |
| OpenRouter | $1 free credit | Pay-as-you-go |
| Slack | Full features for small teams | Varies |
| **Total** | **$0/month to start** | **$0.10-0.30/month typical** |
