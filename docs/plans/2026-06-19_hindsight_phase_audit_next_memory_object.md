# Hindsight-phase audit and next memory-object slice — 2026-06-19

## Status

This audit was run after the W/X hardening sequence plus the six follow-up slices:

1. Admin-key protection for document/admin endpoints.
2. Systemd API deployment/healthcheck hardening.
3. Embedder-version compatibility guard.
4. Bulk stale-document reindex controls.
5. URL ingestion quality and de-duplication.
6. This Hindsight-phase audit.

The goal is to ground the next memory-object slice in the live OpenBrain schema rather than stale roadmap assumptions.

## Live route coverage

The current API code exposes the major Hindsight-style surfaces:

| Surface | Route family present? | Notes |
|---|---:|---|
| Retain raw facts | yes | `/memories`, `/documents`, URL/file ingestion |
| Recall | yes | `/recall`, `/memories/search`, `/documents/search` |
| Reflect | yes | `/reflect` with mental models → observations → raw facts cascade |
| Consolidated observations | yes | `/consolidated-observations` |
| Mental models | yes | `/mental-models` |
| Experiences | yes | `/experiences` |
| Memory links | yes | `/memory-links` |
| Source document provenance | yes | documents, chunks, revisions, diffs, source_uri de-dupe |

## Live table inventory

Observed live row counts on 2026-06-19:

| Table | Rows |
|---|---:|
| `thoughts` | 1077 |
| `documents` | 537 |
| `document_chunks` | 4233 |
| `consolidated_observations` | 63 |
| `mental_models` | 4 |
| `experiences` | 30 |
| `memory_links` | 179 |
| `memory_banks` | 1 |
| `consolidation_jobs` | 48 |

Important schema finding:

- `memory_banks` has `default_directive_ids`, but there is **no live `memory_bank_directives` / `directives` table**.
- This leaves directives as implicit IDs rather than first-class, inspectable memory objects.

## Current Hindsight-class object map

| Hindsight concept | OpenBrain status | Evidence |
|---|---|---|
| Raw memories / facts | implemented | `thoughts`, `documents`, `document_chunks` |
| Consolidated observations | implemented | `consolidated_observations`, 63 rows |
| Mental models | implemented but sparse | `mental_models`, 4 rows |
| Experiences | implemented but sparse | `experiences`, 30 rows |
| Memory graph | implemented | `memory_links`, 179 rows |
| Memory banks | partially implemented | `memory_banks`, 1 row |
| Directives / memory policy | **schema gap** | `memory_banks.default_directive_ids` exists, directive table missing |
| Directive runtime UI/editor | missing | no first-class CRUD surface |

## Highest-leverage next memory-object slice

### Slice H.1 — First-class memory-bank directives

Implement directives as editable, auditable memory objects before adding more ranker math or more Hindsight abstraction.

Why this is next:

1. The schema already hints at directives via `memory_banks.default_directive_ids`.
2. `/reflect` already uses bank mission/directive context conceptually, but directives are not first-class rows.
3. Ryan wants editable source docs, provenance, decisions, handoffs, links, revisions, and audit/reindex controls in the canonical DB. Directives are the missing policy layer for those behaviors.
4. This is additive and low-risk: it does not require replacing recall, re-embedding, or changing existing memory rows.

### Proposed schema

Migration `018-memory-bank-directives.sql`:

```sql
CREATE TABLE IF NOT EXISTS memory_bank_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id TEXT NOT NULL REFERENCES memory_banks(id),
  name TEXT NOT NULL,
  directive_type TEXT NOT NULL DEFAULT 'retention',
  content TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 50,
  active BOOLEAN NOT NULL DEFAULT true,
  project TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(bank_id, name)
);
```

Potential directive types:

- `retention`
- `privacy`
- `recall`
- `reflection`
- `consolidation`
- `routing`
- `operator_preference`

### API slice

Add routes:

| Method/path | Purpose |
|---|---|
| `POST /memory-bank-directives` | Create directive row |
| `GET /memory-bank-directives` | List active directives filtered by bank/project/type |
| `GET /memory-bank-directives/:id` | Fetch directive |
| `PATCH /memory-bank-directives/:id` | Edit content/priority/active flag |
| `DELETE /memory-bank-directives/:id` | Soft deactivate |

Update `getMemoryBankContext()` to read active directive rows rather than relying only on embedded/default IDs.

### UI slice

Add an admin/editor panel after the API lands:

- List bank mission + active directives.
- Edit directive content and priority.
- Show where directives are used by `/reflect`.
- Keep document editor/admin-key pattern from prior slices.

### Verification plan

Use TDD:

1. RED route tests for directive create/list/update/deactivate.
2. RED query tests for `getMemoryBankContext()` including active directives.
3. Migration apply/rollback check against the live DB.
4. API smoke:
   - create directive
   - list directive
   - call `/reflect` and verify directive appears in memory-bank context
   - deactivate directive
5. Ensure existing `/reflect`, `/recall`, document search, and consolidation tests remain green.

## What not to do next

Do **not** prioritize PL/pgSQL TEMPR unification yet. It remains correctly deferred because the TypeScript recall assembly is live and no current evidence shows `/recall` latency or maintainability has crossed the documented revisit threshold.

Do **not** add more heuristic reranking before directive/runtime context is first-class. The live object layer is now the higher-leverage gap.

## Success criteria for the next H-slice

A good next slice ends with:

- `memory_bank_directives` exists in repo migrations and live DB.
- Directive CRUD routes are tested and smoke-tested.
- `getMemoryBankContext()` returns actual active directive rows.
- `/reflect` includes those directives in its source context.
- No retrieval-ranking behavior changes ship in the same slice.
