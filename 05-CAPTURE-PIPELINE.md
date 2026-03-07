# Open Brain - Capture Pipeline

> All ingestion methods: MCP capture, Slack webhooks, bulk migration, and multi-source connectors.

---

## Capture Philosophy

### One Row = One Retrievable Idea

The atomic unit of Open Brain is a **thought** — a single, self-contained idea, decision, observation, or note. This follows the Zettelkasten principle: each entry should represent one concept that can be independently retrieved.

**Good thoughts:**
- "Decision: Using GraphQL over REST for the admin API. Reason: complex nested queries."
- "Sarah mentioned she wants to delay the launch to Q2 due to compliance issues."
- "Insight: Our API response times correlate with database connection pool saturation."

**Bad thoughts:**
- An entire meeting transcript (too broad — vector quality degrades)
- A single word like "important" (too vague — no semantic content)

### Metadata Is Automatic

Every thought gets auto-classified by an LLM (gpt-4o-mini via OpenRouter) during ingestion:

```json
{
    "type": "decision",
    "topics": ["api", "graphql"],
    "people": ["Sarah"],
    "action_items": ["Evaluate GraphQL libraries by Friday"],
    "dates": ["2026-03-14"],
    "source": "mcp"
}
```

---

## Capture Methods

### Method 1: MCP Capture (Any AI Tool)

The primary capture method. Any MCP-connected AI can write to your brain.

```
User: "Remember that we chose Supabase over Firebase for the database"
AI: [calls capture_thought tool]
AI: "Captured as a decision about database and infrastructure."
```

**How It Works:**
1. AI client calls `capture_thought` MCP tool with raw text
2. Edge function processes in parallel:
   - Generate 1536-dim embedding via OpenRouter
   - Extract metadata via gpt-4o-mini
3. Insert into `thoughts` table with `source: "mcp"`
4. Return confirmation to AI client

**Best For**: Real-time capture during AI conversations.

---

### Method 2: Slack Webhook Capture

Frictionless capture from a dedicated Slack channel.

```
#brain channel:
User: "Met with investor today. They want 3x revenue before Series A."

Bot reply (threaded):
"Captured: person_note — topics: investor, fundraising"
```

**How It Works:**
1. Type in your designated `#brain` Slack channel
2. Slack webhook POSTs to `ingest-thought` Edge Function
3. Edge function validates channel whitelist
4. Processes embedding + metadata in parallel
5. Inserts into database with `source: "slack"`
6. Posts threaded confirmation reply

**Setup Requirements:**
- Slack App with Event Subscriptions enabled
- `message.channels` event subscription
- Bot added to capture channel
- Webhook URL: `https://<ref>.supabase.co/functions/v1/ingest-thought`

**Best For**: Quick thoughts throughout the day without opening an AI tool.

---

### Method 3: Memory Migration (From Existing AI)

Pull what your AI already knows about you into Open Brain.

**Process:**
1. Open a conversation with your AI (Claude, ChatGPT, etc.) with MCP connected
2. Use the Memory Migration prompt (see [06-PROMPT-KIT.md](06-PROMPT-KIT.md))
3. The prompt instructs the AI to:
   - Review its accumulated knowledge about you
   - Extract key facts, preferences, decisions, relationships
   - Use `capture_thought` to save each as a separate thought
4. Run once per AI platform

**What Gets Migrated:**
- Personal preferences and communication style
- Project context and decisions
- Recurring topics and interests
- Key relationships and people
- Workflow patterns

**ChatGPT-Specific:**
- Export full history: Settings → Data Controls → Export Data
- Process the JSON export with AI
- Push insights to Open Brain via `capture_thought`
- Fair warning: large exports require significant processing

---

### Method 4: Second Brain Migration (From Note Systems)

Import existing knowledge from Notion, Obsidian, Apple Notes, etc.

**Supported Sources:**
| Source | Export Format | Strategy |
|---|---|---|
| Obsidian | Markdown files (.md) | Process vault directory |
| Notion | Markdown or CSV export | Parse exported structure |
| Apple Notes | Copy/paste or export | Manual or scripted |
| Google Keep | Google Takeout HTML | Parse HTML exports |
| Text files | .txt | Direct ingest |
| n8n captures | JSON/API | Programmatic import |

**Process:**
1. Export your notes from the source system
2. Use the Second Brain Migration prompt (see [06-PROMPT-KIT.md](06-PROMPT-KIT.md))
3. AI processes each note, determines relevance, and captures via `capture_thought`
4. Original system can continue to exist alongside Open Brain

**Chunking Strategy for Long Notes:**
- Break documents > 500 words into meaningful sections
- Each section becomes a separate thought
- Use metadata to maintain relationships (`source: "obsidian"`)
- See [02-DATABASE-SCHEMA.md](02-DATABASE-SCHEMA.md) for parent-child chunking

---

### Method 5: Multi-Source Connectors (Extended)

Community implementations add connectors for additional sources:

| Source | Connector | Format |
|---|---|---|
| Telegram | TelegramImporter | JSON export |
| WhatsApp | WhatsAppImporter | Chat export |
| Gmail | GmailImporter | Google Takeout |
| Claude Code | ClaudeCodeImporter | Session exports |
| Files | FileImporter | Any text file |

**Connector Pattern:**
```python
# All importers follow consistent pattern
from src.connectors.telegram import TelegramImporter

importer = TelegramImporter(export_file="telegram_export.json")
importer.import_all(db_conn)
```

---

## Quick Capture Templates

Optimized sentence starters that produce clean, well-classified thoughts:

### 1. Decision Capture
```
Decision: [what was decided]. Context: [why]. Owner: [who].
```
**Example**: "Decision: Using pgvector over Pinecone. Context: Self-hosted, lower cost, same performance at our scale. Owner: Mike."

**Extracts**: type=decision, topics from context, people from Owner

### 2. Person Note
```
[Name] — [relevant details about this person].
```
**Example**: "Sarah Chen — VP of Engineering at Acme Corp. Prefers async communication. Key contact for the API partnership."

**Extracts**: type=person_note, people=[Sarah Chen], topics from details

### 3. Insight Capture
```
Insight: [realization]. Triggered by: [what caused it].
```
**Example**: "Insight: Our onboarding flow has 40% drop-off at step 3. Triggered by: reviewing analytics dashboard."

**Extracts**: type=idea, topics=[onboarding, analytics]

### 4. Meeting Debrief
```
Meeting with [who] about [topic]. Key points: [items]. Action items: [next steps].
```
**Example**: "Meeting with Sarah and Mike about Q2 roadmap. Key points: prioritize mobile, delay admin portal. Action items: Sarah drafts mobile spec by Friday."

**Extracts**: type=meeting, people=[Sarah, Mike], topics=[roadmap, mobile], action_items, dates

### 5. The AI Save
```
Saving from [tool]: [key takeaway].
```
**Example**: "Saving from Claude: The best approach for vector search pagination is keyset-based using the similarity score as cursor."

**Extracts**: type=reference, source context, topics from takeaway

---

## Data Quality Guidelines

### Vector Embedding Quality

| Content Length | Embedding Quality | Recommendation |
|---|---|---|
| 1-3 sentences | Excellent | Ideal atomic thought |
| 1 paragraph | Good | Works well |
| 2-3 paragraphs | Acceptable | Consider splitting |
| Full page+ | Degrades | Must chunk into sections |
| 4,000+ words | Poor | Single vector too broad |

### Noise Prevention

The problem isn't storing too much — it's about **architectural siloing**:

- Tag different contexts: `work`, `personal`, `coding`, `creative`
- Use metadata filtering to scope searches to relevant context
- The retrieval layer matters more than the storage layer
- ChatGPT's flat memory pool illustrates the anti-pattern

### Scale Reference

- PostgreSQL handles millions of rows comfortably
- pgvector HNSW indexing maintains speed at scale
- Embedding costs: ~$0.02 per million tokens
- At 20 thoughts/day: ~7,300 thoughts/year — trivial for the database

---

## Diagnostics

### Search Returns Nothing

1. Check thought count with `thought_stats` — under 20-30 entries may yield sparse results
2. Test with known content using the exact terminology you captured
3. Lower similarity threshold (try 0.3)
4. Check Edge Function logs for silent embedding errors

### Search vs List Mismatch

If `list_thoughts` finds entries but `search_thoughts` doesn't:
- Issue is in the embedding/matching pipeline, not the data
- Verify embeddings are being generated (check for null `embedding` column values)
- Quality improves with more data (more vectors = better similarity landscape)

### Bulk Import Issues

- Process imports in batches (50-100 at a time)
- Monitor OpenRouter rate limits
- Check Edge Function timeout limits (Supabase has per-function timeout config)
- After bulk import, run `REINDEX INDEX idx_thoughts_embedding;`
