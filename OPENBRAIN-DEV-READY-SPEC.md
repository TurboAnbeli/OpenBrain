# OpenBrain Dev-Ready Upgrade — Feature Specification

> **Project**: [OpenBrain](https://github.com/srnichols/OpenBrain)
> **Purpose**: Upgrade OpenBrain from a personal memory system to a development-grade persistent memory server for AI coding agents.
> **Origin**: Gap analysis from Plan Forge integration — current API works for personal chat history but lacks scoping, mutation, and filtering needed for active software development.
> **Pipeline**: This spec will be hardened via Plan Forge (Step 2) before execution.

---

## Problem Statement

OpenBrain was built for personal semantic memory — capturing thoughts from chat conversations across AI tools. It works well for that. But plugging it into an **active software development workflow** (via the Plan Forge memory extension) exposes critical gaps:

1. **No project scoping** — A developer working on 3 projects gets cross-project contamination in every search. "What did we decide about caching?" returns decisions from the wrong project.
2. **No mutation** — Decisions get superseded ("We chose Redis" → later "We switched to Memcached"), but stale decisions can't be updated or removed, polluting search results.
3. **No structured filtering on search** — Can't combine semantic search with metadata filters ("find *decisions* about *caching*" — semantic + type filter).
4. **Limited thought types** — The 7 built-in types (observation, task, idea, reference, person_note, decision, meeting) don't cover development-specific concepts (architecture, pattern, postmortem, requirement).
5. **No provenance on MCP** — REST API supports `source` parameter, MCP doesn't. Dev teams need to know where a thought came from (which session, which tool, which phase).

---

## User Scenarios

### Scenario 1: Multi-Project Developer (P1 — Critical)
**As a** developer working on 3 projects,
**I want to** scope my searches to a specific project,
**so that** I get relevant decisions without cross-project noise.

**Acceptance Criteria:**
- Can capture a thought with `project: "plan-forge"` parameter
- Searching with `project: "plan-forge"` returns only that project's thoughts
- Searching without `project` returns all thoughts (backward compatible)
- Listing with `project` filter works
- Stats can be scoped to a project

### Scenario 2: Superseded Decision (P1 — Critical)
**As a** developer whose team changed a technology choice,
**I want to** delete or update the old decision,
**so that** AI agents don't follow stale guidance.

**Acceptance Criteria:**
- Can delete a thought by ID
- Can update a thought's content (triggers re-embedding + re-extraction)
- Deleted thoughts no longer appear in search or list results
- Updated thoughts appear with current content and refreshed metadata

### Scenario 3: Filtered Semantic Search (P1 — Critical)
**As a** developer searching for prior decisions,
**I want to** combine semantic search with metadata filters,
**so that** "caching decisions" returns only type=decision thoughts about caching, not general observations.

**Acceptance Criteria:**
- `search_thoughts` accepts optional `type`, `topic`, `project` filter parameters
- Filters are applied BEFORE vector similarity ranking (pre-filter, not post-filter)
- Existing searches without filters work identically (backward compatible)

### Scenario 4: Development-Specific Thought Types (P2 — Important)
**As a** developer capturing architectural decisions and post-mortems,
**I want** thought types that match development concepts,
**so that** I can list all "architecture" decisions or all "postmortem" lessons without relying on topic tags.

**Acceptance Criteria:**
- New types added: `architecture`, `pattern`, `postmortem`, `requirement`, `bug`, `convention`
- Auto-extraction LLM prompt updated with new type definitions
- Existing types unchanged (backward compatible)
- Old thoughts with existing types still work

### Scenario 5: Batch Capture After Phase Completion (P2 — Important)
**As a** Plan Forge user completing a phase,
**I want to** capture 10+ decisions from the post-mortem in one call,
**so that** the agent doesn't make 10 sequential API round-trips.

**Acceptance Criteria:**
- New `capture_thoughts` (plural) MCP tool accepts array of content strings
- All thoughts in batch share the same project and source
- Each thought gets independent embedding + metadata extraction
- Returns array of results (one per thought)
- REST equivalent: `POST /memories/batch`

### Scenario 6: MCP Source Tracking (P2 — Important)
**As a** developer reviewing captured thoughts,
**I want to** know which session/tool/phase a thought came from,
**so that** I can trace decisions back to their origin.

**Acceptance Criteria:**
- `capture_thought` MCP tool accepts optional `source` parameter
- Default source remains "mcp" for backward compatibility
- Plan Forge extension can pass `source: "plan-forge-phase-4-slice-2"`
- Source appears in search/list results

### Scenario 7: Thought Linking (P3 — Nice to Have)
**As a** developer whose decision supersedes a prior one,
**I want to** link the new decision to the old one,
**so that** agents see the evolution of decisions, not just the latest.

**Acceptance Criteria:**
- `capture_thought` accepts optional `supersedes` parameter (thought ID)
- Superseded thoughts are demoted in search rankings (lower similarity boost)
- List can filter `superseded: true/false`
- Chain is navigable: "This supersedes X, which superseded Y"

### Scenario 8: Thought Archival / TTL (P3 — Nice to Have)
**As a** long-running project owner,
**I want** old thoughts to be auto-archived after N months,
**so that** search results stay relevant without manual cleanup.

**Acceptance Criteria:**
- Configuration option: `ARCHIVE_AFTER_DAYS` (default: none/disabled)
- Archived thoughts excluded from search by default
- `include_archived: true` parameter to include them
- Archival is soft — thoughts aren't deleted, just flagged

---

## Technical Design

### Data Model Changes

```sql
-- Add project column (nullable for backward compatibility)
ALTER TABLE thoughts ADD COLUMN project TEXT;
CREATE INDEX idx_thoughts_project ON thoughts(project);

-- Add archived flag
ALTER TABLE thoughts ADD COLUMN archived BOOLEAN DEFAULT false;
CREATE INDEX idx_thoughts_archived ON thoughts(archived) WHERE archived = false;

-- Add supersedes reference
ALTER TABLE thoughts ADD COLUMN supersedes UUID REFERENCES thoughts(id);
CREATE INDEX idx_thoughts_supersedes ON thoughts(supersedes);
```

### Updated Thought Types Enum

```
observation | task | idea | reference | person_note | decision | meeting
+ architecture | pattern | postmortem | requirement | bug | convention
```

Update the LLM extraction prompt to include definitions:
- `architecture` — System design decisions, layer choices, technology selection
- `pattern` — Reusable code patterns, conventions, approaches
- `postmortem` — Lessons learned, what went wrong, what to repeat
- `requirement` — Functional or non-functional requirements
- `bug` — Bug discoveries, root causes, fixes
- `convention` — Naming, formatting, workflow conventions

### MCP Tool Changes

#### `capture_thought` — Add Parameters
```json
{
  "content": "string (required)",
  "project": "string (optional) — scopes to a project/workspace",
  "source": "string (optional, default: 'mcp') — provenance tracking",
  "supersedes": "UUID (optional) — links to a prior thought this replaces"
}
```

#### `capture_thoughts` — New Batch Tool
```json
{
  "thoughts": [
    { "content": "string (required)" }
  ],
  "project": "string (optional) — applied to all thoughts in batch",
  "source": "string (optional) — applied to all thoughts in batch"
}
```
Returns array of capture results.

#### `search_thoughts` — Add Filter Parameters
```json
{
  "query": "string (required)",
  "limit": "integer (default: 10)",
  "threshold": "float (default: 0.5)",
  "project": "string (optional) — scope to project",
  "type": "string (optional) — filter by thought type",
  "topic": "string (optional) — filter by topic tag",
  "include_archived": "boolean (default: false)"
}
```
Filters applied as WHERE clauses before vector similarity ranking.

#### `list_thoughts` — Add Project Filter
```json
{
  "type": "string (optional)",
  "topic": "string (optional)",
  "person": "string (optional)",
  "project": "string (optional) — NEW",
  "days": "integer (optional)",
  "include_archived": "boolean (default: false) — NEW"
}
```

#### `update_thought` — New Tool
```json
{
  "id": "UUID (required)",
  "content": "string (required) — new content replaces old"
}
```
Process: Update content → re-generate embedding → re-extract metadata → update row.

#### `delete_thought` — New Tool
```json
{
  "id": "UUID (required)"
}
```
Hard delete. Returns `{ "status": "deleted", "id": "UUID" }`.

#### `thought_stats` — Add Project Scope
```json
{
  "project": "string (optional) — scope stats to project"
}
```

### REST API Changes

| Endpoint | Change |
|----------|--------|
| `POST /memories` | Add `project`, `supersedes` params |
| `POST /memories/batch` | **New** — batch capture |
| `POST /memories/search` | Add `project`, `type`, `topic`, `include_archived` params |
| `POST /memories/list` | Add `project`, `include_archived` params |
| `PUT /memories/:id` | **New** — update thought |
| `DELETE /memories/:id` | **New** — delete thought |
| `GET /stats` | Add `?project=` query param |

### `match_thoughts()` RPC Update

```sql
CREATE OR REPLACE FUNCTION match_thoughts(
  query_embedding VECTOR(768),
  match_count INT DEFAULT 10,
  threshold FLOAT DEFAULT 0.5,
  filter JSONB DEFAULT '{}'::jsonb,
  project_filter TEXT DEFAULT NULL,        -- NEW
  include_archived BOOLEAN DEFAULT false   -- NEW
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.content, t.metadata,
    (1 - (t.embedding <=> query_embedding)) AS similarity,
    t.created_at
  FROM thoughts t
  WHERE
    (1 - (t.embedding <=> query_embedding)) >= threshold
    AND t.metadata @> filter
    AND (project_filter IS NULL OR t.project = project_filter)
    AND (include_archived OR t.archived = false)
  ORDER BY t.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;
```

---

## Backward Compatibility

All changes are **additive**. Existing behavior is preserved:

| Existing Usage | Still Works? |
|---------------|-------------|
| `capture_thought(content)` without project/source | ✅ — `project` defaults to NULL, `source` defaults to "mcp" |
| `search_thoughts(query)` without filters | ✅ — no filters applied, searches all thoughts |
| `list_thoughts(type, topic)` without project | ✅ — lists all projects |
| Existing thoughts without `project` column | ✅ — NULL project, included in unscoped searches |
| Old thought types (observation, decision, etc.) | ✅ — still valid, new types are additions |

---

## Migration Path

1. **Schema migration**: Add `project`, `archived`, `supersedes` columns (nullable, non-breaking)
2. **Update `match_thoughts()` RPC**: Add new parameters with defaults
3. **Update MCP tool handlers**: Add new parameters, pass through to DB
4. **Update REST endpoints**: Add new params, new routes
5. **Update LLM extraction prompt**: Add new type definitions
6. **Add new tools**: `update_thought`, `delete_thought`, `capture_thoughts`
7. **Update documentation**: README, API reference, MCP tool descriptions
8. **Optional**: Backfill existing thoughts with `project` tag if desired

---

## Out of Scope

- Multi-user authentication (single-user or shared DB is fine)
- File/binary attachments (code belongs in Git)
- Real-time sync/subscriptions
- Full-text keyword search (semantic search covers this)
- UI/frontend changes (OpenBrain is backend-only)
- Changing the embedding model or dimensions

---

## Success Criteria

- [ ] All 4 MCP tools updated with new parameters (backward compatible)
- [ ] 3 new MCP tools added (update, delete, batch capture)
- [ ] All 5 REST endpoints updated + 3 new routes
- [ ] `match_thoughts()` RPC supports project + archive filtering
- [ ] 6 new thought types recognized by LLM extraction
- [ ] Database migration applies cleanly to existing data
- [ ] Existing tests pass without modification
- [ ] New tests cover: project scoping, update/delete, batch capture, filtered search
- [ ] Plan Forge memory extension works end-to-end with upgraded API
- [ ] Documentation updated

---
---

# HARDENED EXECUTION CONTRACT

> **Hardened by**: Plan Forge Pipeline (Step 2)
> **Specification Source**: `OPENBRAIN-DEV-READY-SPEC.md` (this file, sections above)
> **Target Repo**: `E:\GitHub\OpenBrain`
> **Stack**: TypeScript / Node.js (ESM) / PostgreSQL + pgvector / Hono / MCP SDK
> **Branch**: `feature/dev-ready-upgrade` (created from current default branch)

---

## Scope Contract

### In Scope

- **Database schema** (`db/init.sql`, `db/migrations/001-dev-ready-upgrade.sql` new): Add `project` (TEXT), `archived` (BOOLEAN DEFAULT false), `supersedes` (UUID REFERENCES thoughts(id)) columns to `thoughts` table; create indexes; update `match_thoughts()` RPC with project + archive filtering
- **Query layer** (`src/db/queries.ts`): Update all type interfaces, update 4 existing query functions for new params, add 3 new functions (`updateThought`, `deleteThought`, `batchInsertThoughts`)
- **MCP server** (`src/mcp/server.ts`): Add parameters to 4 existing tools, add 3 new tools (`update_thought`, `delete_thought`, `capture_thoughts`)
- **REST API** (`src/api/routes.ts`): Add parameters to 4 existing routes + add 3 new routes (`PUT /memories/:id`, `DELETE /memories/:id`, `POST /memories/batch`)
- **Thought types** (`src/embedder/types.ts`): Add 6 new types to enum + update LLM extraction prompt
- **Test suite** (`package.json`, `vitest.config.ts` new, `src/**/*.test.ts` new): Install vitest, write tests for all new functionality
- **Documentation** (`README.md`, `04-MCP-SERVER.md`): Update tool/route/type docs

### Out of Scope (Non-Goals)

- Multi-user authentication (single-user or shared DB is fine)
- File/binary attachments (code belongs in Git)
- Real-time sync/subscriptions
- Full-text keyword search (semantic search covers this)
- UI/frontend changes (OpenBrain is backend-only)
- Changing the embedding model or dimensions
- Docker/Kubernetes infrastructure changes
- CI/CD pipeline changes
- Supabase Edge Functions (project uses direct Node.js + pg, not Supabase)

### Forbidden Actions

- **Do not modify**: `src/embedder/ollama.ts`, `src/embedder/openrouter.ts` (embedding providers)
- **Do not modify**: `src/embedder/index.ts` (embedder factory)
- **Do not modify**: `Dockerfile`, `docker-compose.yml`, `k8s/` (infrastructure)
- **Do not modify**: `config/` directory
- **Do not modify**: MCP transport layer, SSE handling, or authentication logic in `src/index.ts`
- **Do not introduce**: New npm dependencies beyond the test framework (`vitest`)
- **Do not introduce**: New database tables (only ALTER the existing `thoughts` table)
- **Do not change**: Embedding dimensions (768), similarity algorithm (cosine distance)
- **Do not refactor**: Unrelated code outside the scope of this phase

### Specification Source

- Spec file: `OPENBRAIN-DEV-READY-SPEC.md` (sections above the hardened contract)

### Branch Strategy

| Strategy | Convention |
|----------|------------|
| **Feature branch** | `feature/dev-ready-upgrade` |

**Branch**: `feature/dev-ready-upgrade`
**Created from**: current default branch at HEAD

---

## Required Decisions (Resolve Before Execution)

| # | Decision | Options | Resolution |
|---|----------|---------|------------|
| 1 | **Test framework** — No test framework or tests exist in the project | vitest / jest / node:test | **vitest** — ESM-native, TypeScript-first, zero-config for TS; add `vitest` to devDependencies, add `"test": "vitest run"` to scripts |
| 2 | **Migration file strategy** — Project uses a single `db/init.sql` with no migration tooling | (a) Modify `init.sql` only / (b) Separate migration file + update `init.sql` | **Both** — Create `db/migrations/001-dev-ready-upgrade.sql` for existing deployments + update `db/init.sql` for fresh installs |
| 3 | **`match_thoughts()` parameter order** — Current: `(embedding, threshold, count, filter)`. Spec proposes swapping `count` and `threshold`. | (a) Preserve existing order, append new params / (b) Change order per spec | **Preserve existing order** — New signature: `(embedding, threshold, count, filter, project_filter, include_archived)`. Avoids breaking any direct RPC callers. Update `src/db/queries.ts` call site to match. |
| 4 | **P3 features (linking + archival) inclusion** — Spec designs them fully but labels P3 | (a) Implement all P1–P3 / (b) Schema-only for P3, defer logic | **Implement all** — Spec provides full technical design for P3 features; schema + logic + API endpoints all included in this phase |
| 5 | **Plan Forge e2e validation** — Success criteria require "Plan Forge memory extension works end-to-end" | (a) Automated integration test / (b) Manual verification | **Manual verification** — Plan Forge extension is an external dependency; add as human sign-off step in Definition of Done |
| 6 | **"Existing tests pass" claim** — Spec states "existing tests pass without modification" but there are zero existing tests | Acknowledge gap | **N/A** — No existing test suite exists. Slice 7 creates the first tests. No backward compatibility risk from test perspective. |

> **Status**: All decisions resolved. Execution may proceed.

---

## Execution Slices

### Slice 1: Database Schema Migration `[sequential]`

**Goal**: Add `project`, `archived`, `supersedes` columns to `thoughts` table; create indexes; update `match_thoughts()` RPC with new filter parameters
**Estimated Time**: 45 min
**Traces to**: Scenarios 1, 2, 7, 8
**Parallelism**: `[sequential]`
**Depends On**: None
**Inputs**: Current `db/init.sql`, spec Technical Design § Data Model Changes
**Outputs**: `db/migrations/001-dev-ready-upgrade.sql` (new file), updated `db/init.sql`

**Context Files** (load before starting):
- `db/init.sql`
- `OPENBRAIN-DEV-READY-SPEC.md` § Technical Design > Data Model Changes
- `02-DATABASE-SCHEMA.md`

**Tasks**:
1. Create `db/migrations/` directory
2. Create `db/migrations/001-dev-ready-upgrade.sql`:
   - `ALTER TABLE thoughts ADD COLUMN project TEXT;`
   - `ALTER TABLE thoughts ADD COLUMN archived BOOLEAN DEFAULT false;`
   - `ALTER TABLE thoughts ADD COLUMN supersedes UUID REFERENCES thoughts(id);`
   - `CREATE INDEX idx_thoughts_project ON thoughts(project);`
   - `CREATE INDEX idx_thoughts_archived ON thoughts(archived) WHERE archived = false;`
   - `CREATE INDEX idx_thoughts_supersedes ON thoughts(supersedes);`
   - `CREATE OR REPLACE FUNCTION match_thoughts(...)` with preserved parameter order + appended `project_filter TEXT DEFAULT NULL`, `include_archived BOOLEAN DEFAULT false`
3. Update `db/init.sql`: Add columns to CREATE TABLE, add indexes, replace `match_thoughts()` function for fresh installs
4. **Constraint**: Preserve existing `match_thoughts()` parameter order: `(query_embedding, match_threshold, match_count, filter, project_filter, include_archived)` — do NOT swap threshold/count

**Test Strategy**: No new TS tests (SQL-only slice)

**Validation Gates**:
- [ ] `db/migrations/001-dev-ready-upgrade.sql` file exists with valid SQL
- [ ] `db/init.sql` includes new columns in CREATE TABLE + updated `match_thoughts()`
- [ ] `npm run build` passes (no TS changes, confirm no regressions)
- [ ] SQL syntax check: `psql -h localhost -U openbrain -d openbrain -f db/migrations/001-dev-ready-upgrade.sql` (if DB available) OR manual review of SQL

**Files Touched**:
- `db/init.sql`
- `db/migrations/001-dev-ready-upgrade.sql` (new)

---

### Slice 2: Extend Thought Types + LLM Extraction Prompt `[parallel-safe]` Group A

**Goal**: Add 6 new thought types and update the LLM metadata extraction prompt with definitions
**Estimated Time**: 30 min
**Traces to**: Scenario 4
**Parallelism**: `[parallel-safe]` Group A
**Depends On**: None
**Inputs**: Current `src/embedder/types.ts`
**Outputs**: Updated `src/embedder/types.ts` with 13 thought types + expanded prompt

**Context Files** (load before starting):
- `src/embedder/types.ts`
- `OPENBRAIN-DEV-READY-SPEC.md` § Updated Thought Types Enum

**Tasks**:
1. Add exported `ThoughtType` union type: `"observation" | "task" | "idea" | "reference" | "person_note" | "decision" | "meeting" | "architecture" | "pattern" | "postmortem" | "requirement" | "bug" | "convention"`
2. Update `ThoughtMetadataExtracted.type` to use `ThoughtType` instead of bare `string`
3. Update `METADATA_PROMPT` to list all 13 types with definitions:
   - Keep existing 7 type definitions
   - Add: `architecture` (system design decisions, layer choices, technology selection)
   - Add: `pattern` (reusable code patterns, conventions, approaches)
   - Add: `postmortem` (lessons learned, what went wrong, what to repeat)
   - Add: `requirement` (functional or non-functional requirements)
   - Add: `bug` (bug discoveries, root causes, fixes)
   - Add: `convention` (naming, formatting, workflow conventions)
4. **Constraint**: Do NOT change `DEFAULT_METADATA` — keep `type: "observation"` as default

**Test Strategy**: No new tests (type + prompt changes only; tested in Slice 7)

**Validation Gates**:
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Verify: `grep -c "architecture\|pattern\|postmortem\|requirement\|bug\|convention" src/embedder/types.ts` returns ≥ 6

**Files Touched**:
- `src/embedder/types.ts`

---

### Slice 3: Update DB Query Layer — Types + Existing Functions `[parallel-safe]` Group A

**Goal**: Add project/archived/supersedes to type interfaces and update all 4 existing query functions to accept new filter parameters
**Estimated Time**: 60 min
**Traces to**: Scenarios 1, 3, 8
**Parallelism**: `[parallel-safe]` Group A
**Depends On**: None (interfaces are self-contained within `queries.ts`)
**Inputs**: Current `src/db/queries.ts`, spec MCP/REST parameter definitions
**Outputs**: Updated types + function signatures in `src/db/queries.ts`

**Context Files** (load before starting):
- `src/db/queries.ts`
- `OPENBRAIN-DEV-READY-SPEC.md` § MCP Tool Changes, § REST API Changes, § `match_thoughts()` RPC Update

**Tasks**:
1. Update `ThoughtRow` interface: add `project?: string | null`, `archived?: boolean`, `supersedes?: string | null`
2. Update `ListFilters` interface: add `project?: string`, `include_archived?: boolean`
3. Update `insertThought()`:
   - Add optional `project?: string` and `supersedes?: string` parameters
   - Include `project` and `supersedes` in INSERT statement
   - Backward compatible: existing callers omit the new params → NULL values
4. Update `searchThoughts()`:
   - Add optional `project?: string`, `type?: string`, `topic?: string`, `include_archived?: boolean` parameters
   - Build JSONB `filter` object from `type` (as `{"type": "..."}`) and `topic` (as `{"topics": ["..."]}`)
   - Pass `project` and `include_archived` as new positional args to `match_thoughts()` RPC
   - Preserve existing parameter order in RPC call: `(embedding, threshold, count, filter, project_filter, include_archived)`
5. Update `listThoughts()`:
   - Add `project` WHERE clause when `filters.project` is set
   - Add `archived = false` WHERE clause unless `filters.include_archived` is true
6. Update `getThoughtStats()`:
   - Accept optional `project?: string` parameter
   - Add `WHERE project = $1` when scoped (across all sub-queries)

**Test Strategy**: No new tests in this slice (deferred to Slice 7)

**Validation Gates**:
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] Verify exports: `grep "export async function" src/db/queries.ts` still shows `insertThought`, `searchThoughts`, `listThoughts`, `getThoughtStats`

**Files Touched**:
- `src/db/queries.ts`

---

### Parallel Merge Checkpoint (after Group A — Slices 2, 3)

- [ ] All Group A slices passed their individual validation gates
- [ ] `npm run build` passes after combining all Group A outputs
- [ ] `npm run typecheck` passes
- [ ] No file conflicts (Slice 2 → `types.ts`, Slice 3 → `queries.ts` — no overlap)
- [ ] Re-anchor: all changes remain in-scope

---

### Slice 4: Add New DB Query Functions `[sequential]`

**Goal**: Add `updateThought`, `deleteThought`, `batchInsertThoughts` functions to the query layer
**Estimated Time**: 45 min
**Traces to**: Scenarios 2, 5
**Parallelism**: `[sequential]`
**Depends On**: Slice 1 (schema — columns must exist), Slice 3 (types — interfaces must be updated)
**Inputs**: Updated `src/db/queries.ts` from Slice 3, migration schema from Slice 1
**Outputs**: Three new exported functions in `src/db/queries.ts`

**Context Files** (load before starting):
- `src/db/queries.ts` (post-Slice 3)
- `db/migrations/001-dev-ready-upgrade.sql` (from Slice 1)
- `OPENBRAIN-DEV-READY-SPEC.md` § update_thought, § delete_thought, § capture_thoughts (batch)

**Tasks**:
1. Add `updateThought(pool, id, content, embedding, metadata)`:
   - `UPDATE thoughts SET content = $2, embedding = $3::vector, metadata = $4::jsonb WHERE id = $1 RETURNING ...`
   - The `updated_at` column auto-updates via the existing `set_updated_at` trigger
   - Return updated `ThoughtRow`
   - Throw/return error if thought not found
2. Add `deleteThought(pool, id)`:
   - `DELETE FROM thoughts WHERE id = $1 RETURNING id`
   - Return `{ deleted: boolean; id: string }`
3. Add `batchInsertThoughts(pool, thoughts[])`:
   - Accept array of `{ content, embedding, metadata, project? }`
   - Use a PostgreSQL transaction (`BEGIN` / `COMMIT` / `ROLLBACK`) for atomicity
   - Insert each thought within the transaction
   - Return array of `ThoughtRow`

**Test Strategy**: No new tests in this slice (deferred to Slice 7)

**Validation Gates**:
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] Verify: `grep "export async function" src/db/queries.ts` shows 7 functions total (4 existing + 3 new)

**Files Touched**:
- `src/db/queries.ts`

---

### Slice 5: Update MCP Server — Existing Tools + New Tools `[parallel-safe]` Group B

**Goal**: Add parameters to 4 existing MCP tools + add 3 new tools (update_thought, delete_thought, capture_thoughts)
**Estimated Time**: 90 min
**Traces to**: Scenarios 1–6
**Parallelism**: `[parallel-safe]` Group B
**Depends On**: Slice 2 (thought types), Slice 3 (query signatures), Slice 4 (new functions)
**Inputs**: Updated `src/db/queries.ts`, updated `src/embedder/types.ts`
**Outputs**: Updated `src/mcp/server.ts` with 7 tools (4 updated + 3 new)

**Context Files** (load before starting):
- `src/mcp/server.ts`
- `src/db/queries.ts` (post-Slice 4)
- `src/embedder/types.ts` (post-Slice 2)
- `OPENBRAIN-DEV-READY-SPEC.md` § MCP Tool Changes

**Tasks**:
1. **Update `capture_thought`** tool:
   - Add `project` (string, optional), `source` (string, optional, default "mcp"), `supersedes` (string/UUID, optional) to inputSchema
   - Pass `project` and `supersedes` to `insertThought()`
   - Use `source` param (or "mcp" default) instead of hardcoded "mcp"
2. **Update `search_thoughts`** tool:
   - Add `project`, `type`, `topic`, `include_archived` to inputSchema
   - Pass new params to `searchThoughts()`
3. **Update `list_thoughts`** tool:
   - Add `project`, `include_archived` to inputSchema
   - Pass to `listThoughts()` via filters object
4. **Update `thought_stats`** tool:
   - Add `project` to inputSchema
   - Pass to `getThoughtStats()`
5. **Add `update_thought`** tool:
   - inputSchema: `id` (string, required), `content` (string, required)
   - Generate new embedding + extract metadata (re-process)
   - Call `updateThought()`
6. **Add `delete_thought`** tool:
   - inputSchema: `id` (string, required)
   - Call `deleteThought()`
7. **Add `capture_thoughts`** (batch) tool:
   - inputSchema: `thoughts` (array of `{content}`, required), `project` (optional), `source` (optional)
   - For each thought: generate embedding + extract metadata
   - Call `batchInsertThoughts()`
   - Return array of results
8. **Update `ListToolsRequestSchema` handler** to register all 7 tools

**Test Strategy**: No new tests in this slice (deferred to Slice 7)

**Validation Gates**:
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] Verify tool count: `grep -c '"name":' src/mcp/server.ts` in the tools array returns 7

**Files Touched**:
- `src/mcp/server.ts`

---

### Slice 6: Update REST API — Existing Routes + New Routes `[parallel-safe]` Group B

**Goal**: Add parameters to 4 existing REST routes + add 3 new routes (batch, update, delete)
**Estimated Time**: 90 min
**Traces to**: Scenarios 1–6
**Parallelism**: `[parallel-safe]` Group B
**Depends On**: Slice 2 (thought types), Slice 3 (query signatures), Slice 4 (new functions)
**Inputs**: Updated `src/db/queries.ts`, updated `src/embedder/types.ts`
**Outputs**: Updated `src/api/routes.ts` with 8 routes (5 existing/updated + 3 new)

**Context Files** (load before starting):
- `src/api/routes.ts`
- `src/db/queries.ts` (post-Slice 4)
- `src/embedder/types.ts` (post-Slice 2)
- `OPENBRAIN-DEV-READY-SPEC.md` § REST API Changes

**Tasks**:
1. **Update `POST /memories`**: Accept `project`, `supersedes` in request body; pass to `insertThought()`
2. **Update `POST /memories/search`**: Accept `project`, `type`, `topic`, `include_archived` in body; pass to `searchThoughts()`
3. **Update `POST /memories/list`**: Accept `project`, `include_archived` in body; pass to `listThoughts()`
4. **Update `GET /stats`**: Accept `?project=` query parameter; pass to `getThoughtStats()`
5. **Add `POST /memories/batch`**: Accept `{ thoughts: [{content}], project?, source? }`; embed + extract each; call `batchInsertThoughts()`; return array of results
6. **Add `PUT /memories/:id`**: Accept `{ content }` in body; re-embed + re-extract metadata; call `updateThought()`; return updated thought
7. **Add `DELETE /memories/:id`**: Call `deleteThought()`; return `{ status: "deleted", id }`
8. **Input validation**: All new/updated routes validate required fields, return 400 on missing input
9. **Update entry point log messages** in `src/index.ts`: Add new routes to the startup banner (the 3 new endpoints)

**Test Strategy**: No new tests in this slice (deferred to Slice 7)

**Validation Gates**:
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Verify route count: `grep -cE "app\.(get|post|put|delete)\(" src/api/routes.ts` returns 8

**Files Touched**:
- `src/api/routes.ts`
- `src/index.ts` (startup banner only — console.log lines)

---

### Parallel Merge Checkpoint (after Group B — Slices 5, 6)

- [ ] All Group B slices passed their individual validation gates
- [ ] `npm run build` passes after combining all Group B outputs
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] No file conflicts (Slice 5 → `server.ts`, Slice 6 → `routes.ts` + `index.ts` banner — no overlap)
- [ ] Re-anchor: all changes remain in-scope

---

### Slice 7: Test Infrastructure + Test Suite `[sequential]`

**Goal**: Install vitest, configure test runner, write comprehensive tests for all new functionality
**Estimated Time**: 120 min
**Traces to**: All scenarios (verification layer)
**Parallelism**: `[sequential]`
**Depends On**: Slices 1–6 (all code must be in place)
**Inputs**: All updated source files, stable build
**Outputs**: Test config + test files, green test suite

**Context Files** (load before starting):
- `package.json`
- `tsconfig.json`
- `src/db/queries.ts` (final)
- `src/mcp/server.ts` (final)
- `src/api/routes.ts` (final)
- `src/embedder/types.ts` (final)

**Tasks**:
1. `npm install -D vitest` — install test framework
2. Add to `package.json` scripts: `"test": "vitest run"`
3. Create `vitest.config.ts` with TypeScript + ESM configuration
4. Write `src/db/__tests__/queries.test.ts` (unit tests with mocked pg pool):
   - `insertThought` with `project` param stores project column
   - `insertThought` without `project` defaults to null (backward compat)
   - `searchThoughts` passes project/type/topic/include_archived to RPC
   - `listThoughts` filters by project when provided
   - `listThoughts` excludes archived by default
   - `getThoughtStats` scopes by project when provided
   - `updateThought` returns updated row
   - `deleteThought` returns deletion confirmation
   - `batchInsertThoughts` inserts all within transaction
5. Write `src/mcp/__tests__/server.test.ts`:
   - Tool listing returns exactly 7 tools
   - `capture_thought` accepts project + source + supersedes params
   - `search_thoughts` accepts project + type + topic + include_archived
   - `update_thought` tool exists with id + content schema
   - `delete_thought` tool exists with id schema
   - `capture_thoughts` (batch) accepts thoughts array + project + source
6. Write `src/api/__tests__/routes.test.ts`:
   - `POST /memories` accepts project + supersedes in body
   - `POST /memories/search` accepts filter params
   - `PUT /memories/:id` returns updated thought
   - `DELETE /memories/:id` returns deletion status
   - `POST /memories/batch` returns array of results
   - `GET /health` still returns healthy (regression check)

**Test Strategy**: Unit tests with mocked dependencies (pg pool, embedder)

**Validation Gates**:
- [ ] `npm test` passes (all tests green)
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes

**Files Touched**:
- `package.json` (add vitest dep + test script)
- `vitest.config.ts` (new)
- `src/db/__tests__/queries.test.ts` (new)
- `src/mcp/__tests__/server.test.ts` (new)
- `src/api/__tests__/routes.test.ts` (new)

---

### Slice 8: Documentation Updates `[sequential]`

**Goal**: Update all user-facing documentation to reflect new capabilities
**Estimated Time**: 30 min
**Traces to**: Success criteria — "Documentation updated"
**Parallelism**: `[sequential]`
**Depends On**: Slices 5, 6 (API surfaces must be finalized)
**Inputs**: Final tool schemas, REST routes, thought types
**Outputs**: Updated documentation files

**Context Files** (load before starting):
- `README.md`
- `04-MCP-SERVER.md`
- `src/mcp/server.ts` (for tool schemas)
- `src/api/routes.ts` (for route signatures)

**Tasks**:
1. Update `README.md`:
   - Update MCP tool list from 4 → 7 tools with descriptions
   - Update REST endpoint list from 5 → 8 routes
   - Document new parameters for existing tools/routes
   - Add new thought types (13 total) to type reference
   - Add migration instructions section for existing deployments
2. Update `04-MCP-SERVER.md`:
   - Document all 7 MCP tools with complete parameter schemas
   - Include examples for new tools (update, delete, batch)
3. **Constraint**: Do not modify the spec sections above the hardened contract

**Test Strategy**: No code tests (documentation only)

**Validation Gates**:
- [ ] `npm run build` passes (no regressions from doc changes)
- [ ] README lists all 7 MCP tools
- [ ] README lists all 8 REST endpoints
- [ ] `04-MCP-SERVER.md` documents all 7 tools

**Files Touched**:
- `README.md`
- `04-MCP-SERVER.md`

---

## Re-anchor Checkpoints

After completing each slice, the executing agent MUST:

- [ ] Re-read the **Scope Contract** — confirm all changes are in-scope
- [ ] Re-read the **Forbidden Actions** — confirm nothing off-limits was touched
- [ ] Re-read the **Stop Conditions** — confirm no halt triggers fired
- [ ] Summarize what changed in ≤ 5 bullets
- [ ] Record validation gate results (pass/fail with exact command output)
- [ ] Confirm the next slice's inputs are ready
- [ ] Confirm the next slice's dependencies are satisfied

> **If any checkbox fails**: STOP execution and report the issue. Do not proceed to the next slice.

---

## Definition of Done

This phase is COMPLETE when ALL of the following are true:

### Build & Test
- [ ] `npm run build` passes with zero errors
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] `npm test` passes with all tests green
- [ ] All 8 execution slices have passed their individual validation gates

### Functionality (per spec Success Criteria)
- [ ] All 4 existing MCP tools accept new parameters (backward compatible)
- [ ] 3 new MCP tools work: `update_thought`, `delete_thought`, `capture_thoughts`
- [ ] All 5 existing REST routes accept new parameters (backward compatible)
- [ ] 3 new REST routes work: `PUT /memories/:id`, `DELETE /memories/:id`, `POST /memories/batch`
- [ ] `match_thoughts()` RPC supports `project_filter` + `include_archived` parameters
- [ ] 6 new thought types recognized by LLM extraction prompt (13 total)
- [ ] Database migration applies cleanly to existing data (additive, nullable columns)

### Drift & Quality
- [ ] All re-anchor checkpoints passed (no drift detected)
- [ ] Completeness Sweep passed (zero TODO/mock/stub/placeholder artifacts)
- [ ] Reviewer Gate passed (run in fresh agent session — Section 6.2 of Runbook)
- [ ] Zero 🔴 Critical findings (or all lockout slices re-executed)
- [ ] All Required Decisions resolved (no TBD rows remain)
- [ ] No Forbidden Actions were violated

### Documentation & Sign-Off
- [ ] `README.md` updated with 7 MCP tools, 8 REST endpoints, 13 thought types
- [ ] `04-MCP-SERVER.md` updated with all 7 tool schemas
- [ ] Plan Forge memory extension verified manually against upgraded API (human sign-off)
- [ ] Human review confirms deliverables match spec

---

## Stop Conditions (Execution Must Halt)

Execution STOPS immediately if:

1. A **Required Decision** is still marked TBD
2. The agent needs to **guess** about behavior, schema, or architecture not described in the spec
3. A task would **touch Forbidden files/directories**: `src/embedder/ollama.ts`, `src/embedder/openrouter.ts`, `src/embedder/index.ts`, `Dockerfile`, `docker-compose.yml`, `k8s/`, `config/`
4. A **Validation Gate fails** (`npm run build` breaks, `npm run typecheck` fails, `npm test` fails)
5. The work required **exceeds the current slice boundary** (e.g., Slice 3 tries to add MCP tools)
6. The agent discovers a **conflict** with an existing code pattern that the spec doesn't address
7. A **new npm dependency** would be introduced beyond `vitest`
8. **Embedding dimensions (768) or model selection** would need to change
9. A **new database table** would be required (only ALTER existing `thoughts` table)
10. The `match_thoughts()` RPC change would break **unknown external callers** (discovered at runtime)
11. A change would require modifying the **MCP transport/SSE/auth layer** in `src/index.ts`

**When stopped**:
- Report what triggered the halt
- Do NOT attempt to work around the issue
- Do NOT invent behavior, architecture, or scope not in the spec
- Wait for human resolution before continuing
