# One-Brain Sequential Next Steps Implementation Plan

> **For Hermes:** Use `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Make the current live OpenBrain one-brain state reproducible in-repo, finish near-complete non-wiki document ingest, and add a heldout-safe documents eval before any retrieval behavior changes.

**Architecture:** First reconcile repo migrations with the live database schema so the checked-in code can reproduce the running system. Next close the remaining ingest gap, then build parity-derived train/holdout documents eval artifacts and validators. Do not change retrieval behavior during this pass; finish by assessing the next Hindsight-phase work from the now-grounded baseline.

**Tech Stack:** PostgreSQL migrations, TypeScript importer/API code, Vitest, Python eval scripts/JSON datasets.

---

### Task 1: Audit live-schema drift against checked-in migrations

**Objective:** Produce an exact diff between live DB tables/columns/indexes and repo migration coverage.

**Files:**
- Read: `db/migrations/*.sql`
- Read: live DB schema via `pg_dump --schema-only`
- Create: `docs/plans/2026-06-14_schema-drift-audit.md`

**Verification:**
- Audit note lists all live-only tables, columns, constraints, indexes, and triggers.
- Audit identifies which repo files already cover which objects.

### Task 2: Add missing migration(s) so repo reproduces live DB

**Objective:** Check in migration SQL for the live one-brain schema additions currently absent from repo.

**Files:**
- Create: `db/migrations/010-one-brain-memory-bank.sql` (or equivalent)
- Modify: docs/tests only if needed

**Verification:**
- Migration adds missing `documents`/`document_chunks` semantics fields and memory-bank tables.
- Migration is idempotent and ordered after `009-documents.sql`.

### Task 3: Diagnose and import the 2 missing non-wiki docs

**Objective:** Determine why two markdown files are not represented in `documents`, then import them safely.

**Files:**
- Read/modify importer files under `src/import/`
- Read the two missing markdown files

**Verification:**
- Non-wiki file coverage becomes complete for the current filesystem snapshot.
- Re-run coverage query and confirm no missing files remain.

### Task 4: Build parity-derived heldout documents eval artifacts

**Objective:** Implement the plan in the Ry-El note for seed manifest, train/holdout splits, validators, and harness support.

**Files:**
- Create/modify files under `../ryel/tools/openbrain-eval/`
- Modify: `src/import/parity.ts`
- Test: `src/import/__tests__/parity.test.ts`

**Verification:**
- Seed manifest, train split, and holdout split exist.
- Validation script passes.
- Tests pass.

### Task 5: Freeze retrieval changes and assess next Hindsight-phase work

**Objective:** End with a grounded status note: eval exists, retrieval changes remain deferred, and the next schema/data work for memory links / mental models / experiences is enumerated.

**Files:**
- Create: `docs/plans/2026-06-14_post-eval-next-steps.md`

**Verification:**
- Final note explicitly says retrieval behavior work is deferred until eval-guided iteration.
- Next Hindsight-phase tasks are based on live schema + repo state, not guesswork.
