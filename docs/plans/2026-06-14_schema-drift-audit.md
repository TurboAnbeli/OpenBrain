# OpenBrain schema drift audit — 2026-06-14

## Scope

Compared:
- live schema dump: `/tmp/openbrain_schema_dump.sql`
- checked-in migrations: `db/migrations/001-dev-ready-upgrade.sql` through `db/migrations/009-documents.sql`

Focused objects:
- `documents`
- `document_chunks`
- `document_revisions`
- `memory_banks`
- `directives`
- `memory_links`
- `mental_models`
- `experiences`
- `consolidation_jobs`

## Bottom line

The live database is ahead of the repo migrations.

What is checked in today:
- `009-documents.sql` creates the baseline `documents`, `document_chunks`, and `document_revisions` tables.

What exists live but is not represented in checked-in migrations:
1. semantic / bank-aware document columns and indexes on `documents`
2. `chunk_kind` on `document_chunks`
3. the entire memory-bank schema family:
   - `memory_banks`
   - `directives`
   - `memory_links`
   - `mental_models`
   - `experiences`
   - `consolidation_jobs`
4. foreign keys from these objects back to `memory_banks`

This means a fresh DB migrated from repo state will not match the running one-brain system.

## Repo coverage vs live state

### 1) `documents`

Covered by `db/migrations/009-documents.sql`:
- base columns: `id`, `title`, `source_type`, `source_uri`, `content_enc`, `metadata`, `project`, `created_by`, `status`, `fts`, `created_at`, `updated_at`
- trigger: `set_documents_updated_at`
- indexes: `source_type`, `source_uri`, `project`, `created_by`, `status`, `metadata`, `fts`

Present live but missing from migrations:
- columns:
  - `bank_id TEXT NOT NULL DEFAULT 'openbrain'`
  - `document_kind TEXT NOT NULL DEFAULT 'article'`
  - `session_id TEXT`
  - `task_id TEXT`
  - `intent TEXT`
  - `event_started_at TIMESTAMPTZ`
  - `event_ended_at TIMESTAMPTZ`
- check constraints:
  - `documents_document_kind_check`
  - `documents_intent_check`
- indexes:
  - `idx_documents_bank`
  - `idx_documents_kind`
  - `idx_documents_intent`
  - `idx_documents_session`
  - `idx_documents_event`
- foreign key:
  - `documents_bank_id_fkey -> memory_banks(id)`

Important code-level consequence:
- `src/import/markdown.ts` already derives and posts `bank_id`, `document_kind`, `session_id`, `task_id`, `intent`, `event_started_at`, `event_ended_at`
- `src/api/routes.ts` already validates and persists these fields

So app code already expects schema that migrations do not create.

### 2) `document_chunks`

Covered by `db/migrations/009-documents.sql`:
- base columns: `id`, `document_id`, `chunk_index`, `content_enc`, `embedding`, `metadata`, `token_count`, `char_start`, `char_end`, `fts`, `created_at`, `updated_at`
- unique `(document_id, chunk_index)`
- trigger: `set_document_chunks_updated_at`
- indexes: `document_id`, `embedding`, `metadata`, `fts`

Present live but missing from migrations:
- column:
  - `chunk_kind TEXT NOT NULL DEFAULT 'content'`
- check constraint:
  - `document_chunks_chunk_kind_check` with values `content|heading|evidence|citation`

### 3) `document_revisions`

`db/migrations/009-documents.sql` appears aligned with live schema for this table.

No material drift found in the dumped definition.

### 4) `memory_banks`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `name`, `mission`, `disposition`, `default_directive_ids`, `project`, `created_at`, `updated_at`
- primary key: `memory_banks_pkey`

No checked-in migration currently creates this table.

### 5) `directives`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `bank_id`, `name`, `rule_text`, `applies_to`, `severity`, `active`, `priority`, `revision`, `created_at`, `updated_at`
- constraints:
  - PK on `id`
  - unique `(bank_id, name)`
- index:
  - `idx_directives_bank` on active directives only
- FK:
  - `directives_bank_id_fkey -> memory_banks(id)`

### 6) `memory_links`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `source_type`, `source_id`, `target_type`, `target_id`, `relationship`, `weight`, `inferred`, `bank_id`, `created_at`
- constraints:
  - PK on `id`
  - unique `(source_type, source_id, target_type, target_id, relationship)`
  - enum-like checks for `source_type`, `target_type`, `relationship`
- indexes:
  - `idx_memory_links_bank`
  - `idx_memory_links_rel`
  - `idx_memory_links_source`
  - `idx_memory_links_target`
- FK:
  - `memory_links_bank_id_fkey -> memory_banks(id)`

### 7) `mental_models`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `bank_id`, `name`, `query`, `content_enc`, `embedding`, `fts`, `structured`, `tags`, `trigger_tags`, `priority`, `refresh_meta`, `history`, `active`, `project`, `created_by`, `created_at`, `updated_at`
- constraints:
  - PK on `id`
  - unique `(bank_id, name)`
- indexes:
  - `idx_mental_models_active`
  - `idx_mental_models_bank`
  - `idx_mental_models_embed`
  - `idx_mental_models_tags`
- FK:
  - `mental_models_bank_id_fkey -> memory_banks(id)`

### 8) `experiences`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `bank_id`, `session_id`, `agent_id`, `occurred_at`, `event_type`, `content_enc`, `embedding`, `fts`, `refs`, `project`, `created_by`, `created_at`
- constraints:
  - PK on `id`
  - `experiences_event_type_check`
- indexes:
  - `idx_experiences_bank`
  - `idx_experiences_embed`
  - `idx_experiences_event`
  - `idx_experiences_fts`
  - `idx_experiences_occurred`
  - `idx_experiences_session`
- FK:
  - `experiences_bank_id_fkey -> memory_banks(id)`

### 9) `consolidation_jobs`

Present live, absent from checked-in migrations.

Live schema:
- columns: `id`, `bank_id`, `job_type`, `status`, `input`, `output`, `error`, `started_at`, `finished_at`, `attempts`, `created_at`
- constraints:
  - PK on `id`
  - `consolidation_jobs_job_type_check`
  - `consolidation_jobs_status_check`
- indexes:
  - `idx_consolidation_jobs_bank`
  - `idx_consolidation_jobs_status`
- FK:
  - `consolidation_jobs_bank_id_fkey -> memory_banks(id)`

## Recommended migration breakdown

### Recommended `010-documents-semantic-fields.sql`

Add only the live drift on the document tables created by `009-documents.sql`:
- `documents.bank_id`
- `documents.document_kind`
- `documents.session_id`
- `documents.task_id`
- `documents.intent`
- `documents.event_started_at`
- `documents.event_ended_at`
- `documents` check constraints for `document_kind` and `intent`
- `documents` indexes: bank/kind/intent/session/event
- `document_chunks.chunk_kind`
- `document_chunks_chunk_kind_check`

Reason for isolating this migration:
- keeps the `009 -> live` document-table drift small and auditable
- matches the fact that importer/API code already uses these fields

### Recommended `011-memory-bank-core.sql`

Create:
- `memory_banks`
- `directives`
- `memory_links`
- `mental_models`
- `experiences`
- `consolidation_jobs`

Also add:
- all PKs / unique constraints
- all check constraints
- all indexes
- all FKs back to `memory_banks`
- seed row for bank `openbrain`
- seed directives now live in the DB:
  - `no_pii_verbatim`
  - `no_fact_averaging`

Reason for isolating this migration:
- the memory-bank family is conceptually separate from document-table enrichment
- easier to test / reason about rollback and idempotence

## Suggested follow-up order

1. add `010-documents-semantic-fields.sql`
2. add `011-memory-bank-core.sql`
3. verify app builds/tests still pass
4. then import the 2 missing markdown files
5. only after that, build the heldout-safe documents eval

## Risk if left unfixed

- new environments will boot with app code that expects columns/tables not created by migrations
- importer/API behavior will depend on undocumented manual DB history
- evaluation work will sit on a non-reproducible schema baseline
