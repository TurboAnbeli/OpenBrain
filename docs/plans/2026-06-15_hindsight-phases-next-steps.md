# Hindsight phases — next concrete steps after heldout eval

Date: 2026-06-15
Repo: `/home/ryan/workspace/openbrain`

## What just changed

We now have a heldout-safe documents eval for the non-wiki `one-brain-agent-notes` corpus and can stop using the 8-query parity probe as the only guardrail.

Artifacts now in place:
- `ryel/tools/openbrain-eval/ryel_documents_parity_seed_manifest_20260614.json`
- `ryel/tools/openbrain-eval/ryel_documents_parity_train_20260614.json`
- `ryel/tools/openbrain-eval/ryel_documents_parity_holdout_20260614.json`
- `ryel/tools/openbrain-eval/build_ryel_documents_parity_splits.py`
- `ryel/tools/openbrain-eval/validate_ryel_documents_parity_splits.py`
- `ryel/tools/openbrain-eval/eval_ryel_documents.py` (now with unique-source metrics + corpus metadata)
- `/home/ryan/workspace/openbrain/.local-archive/one-brain-agent-notes-heldout-eval/train-baseline.json`
- `/home/ryan/workspace/openbrain/.local-archive/one-brain-agent-notes-heldout-eval/holdout-baseline.json`

Baseline snapshot:
- train: R@5 95.8%, unique-source R@5 95.8%, duplicate-source-count@10 avg 3.96
- holdout: R@5 91.7%, unique-source R@5 91.7%, duplicate-source-count@10 avg 3.00

That means retrieval work can now be measured. It also means we should not guess about ranking changes anymore.

## Current Hindsight-class state (verified)

Live DB row counts:
- `memory_banks`: 1
- `directives`: 2
- `memory_links`: 0
- `mental_models`: 0
- `experiences`: 0
- `consolidation_jobs`: 0

Repo/runtime state:
- checked-in migrations now reproduce the currently-live bank/directive schema (`010-documents-semantic-fields.sql`, `011-memory-bank-core.sql`)
- there are no runtime TypeScript references to `memory_banks`, `directives`, `memory_links`, `mental_models`, `experiences`, or `consolidation_jobs` yet
- in other words: the advanced Hindsight-shaped schema exists, but it is still mostly inert

## The main implication

Do not jump straight to graph/temporal recall just because the tables exist.

Right now the bottleneck is not ranking logic. The bottleneck is that the higher-order tables are empty and unused.

A graph/temporal retriever without:
- populated `memory_links`
- populated `experiences`
- populated `mental_models`
- first-class `consolidated_observations`
will mostly be scoring empty air.

## Recommended adjusted order

The June 14 draft plan put TEMPR recall before observations/mental models. After seeing the live repo/DB state, I would invert that.

Recommended order now:

1. Observation substrate first
2. Directive-aware consolidation second
3. Experience capture third
4. Mental models fourth
5. Only then graph/temporal recall fusion
6. Web editor after the data model is producing real rows

Reason: Hindsight-style recall only becomes valuable once there is something richer than documents to recall.

## Next concrete implementation slices

### Slice A — add first-class `consolidated_observations`

Status: not present in live schema or repo migrations.

Why first:
- this is the first truly new durable memory unit beyond raw documents/thoughts
- it gives consolidation somewhere explicit to write
- it creates real evidence-bearing material for later mental-model refresh

Concrete work:
- add migration `012-observations.sql`
- create `consolidated_observations` table close to the June 14 draft note shape:
  - `id`
  - `bank_id`
  - `content_enc`
  - `embedding VECTOR(768)`
  - `fts`
  - `proof_count`
  - `source_memory_ids UUID[]`
  - `history JSONB`
  - `trend`
  - `trend_computed_at`
  - `project`
  - `created_by`
  - `archived`
  - timestamps
- create DB query helpers + API routes for:
  - create observation
  - search observations
  - fetch observation by id
  - update observation / supersede

Suggested file touchpoints:
- `db/migrations/012-observations.sql`
- `src/db/queries.ts`
- `src/api/routes.ts`
- `src/api/__tests__/routes.test.ts`

Definition of done:
- repo migrations create `consolidated_observations`
- CRUD/search works through API
- one seeded observation can be created and retrieved end-to-end in tests

### Slice B — make `consolidation_jobs` real with a minimal observation worker

Status: table exists, zero rows, no runtime usage.

Why second:
- without a worker, `consolidated_observations` stays empty
- this is the lowest-friction way to turn imported documents/thoughts into durable synthetic memory

Concrete work:
- implement a minimal background script, not full orchestration yet
- job types to start with:
  - `observe_documents`
  - `observe_thoughts`
- inputs should be explicit IDs / source URIs, not corpus-wide free-for-all
- output should be deterministic JSON envelopes written back to `consolidation_jobs.output`
- first pass can be batch/manual, not daemonized

Suggested file touchpoints:
- `src/synthesize.ts` or a new consolidation module
- `scripts/run_consolidation_job.ts` or `src/jobs/consolidate.ts`
- `src/db/queries.ts`
- `src/api/routes.ts` for job enqueue/status

Definition of done:
- enqueue job → run job → materialize observation rows → mark job success/error
- at least one successful job recorded in `consolidation_jobs`

### Slice C — apply `memory_banks` + `directives` in runtime code

Status: seeded in DB, not read by runtime.

Why third:
- the bank mission and directive rows are currently decorative
- reflect/consolidation should consume them before more autonomous memory generation ships

Concrete work:
- add query helpers to load bank config + active directives
- thread directives into:
  - consolidation prompts
  - synthesize prompts
  - any future reflect prompt assembly
- enforce the current seeded directives explicitly:
  - `no_pii_verbatim`
  - `no_fact_averaging`

Suggested file touchpoints:
- `src/db/queries.ts`
- `src/synthesize.ts`
- any future reflect orchestration module

Definition of done:
- runtime fetches bank + active directives by `bank_id`
- tests assert prompt/context assembly includes directive text

### Slice D — start first-class `experiences`

Status: table exists, zero rows, no runtime usage.

Why fourth:
- graph/temporal recall needs bank-self activity, not just imported notes
- this is the missing substrate for “what did the agent do / decide / try” memory

Concrete work:
- start narrow: log only explicit high-value events
  - user message
  - assistant final response
  - selected tool-call summaries
  - consolidation outcomes
- do not attempt full transcript mirroring yet
- add small retained schema for references back to documents/observations if available

Suggested file touchpoints:
- a new experience writer module
- `src/api/routes.ts` or agent-side hooks where events are emitted
- `src/db/queries.ts`

Definition of done:
- a real session writes a few `experiences` rows
- rows can be searched/retrieved by session_id and event_type

### Slice E — populate `memory_links` from conservative inference rules

Status: table exists, zero rows, no runtime usage.

Why fifth:
- graph recall should follow real edges, not hypothetical ones
- link inference is only useful after we have documents/consolidated-observations/experiences to connect

Start with only conservative edge types:
- `supersedes`
- `temporal_after`
- `semantic_similar`
- `entity_co`

Avoid causal inference initially.

Concrete work:
- link documents and observations by shared source/evidence
- link experiences in session order with `temporal_after`
- link superseding observations explicitly when a consolidation job updates an earlier one

Definition of done:
- non-zero `memory_links`
- at least one test proves edge generation is deterministic for known fixture data

### Slice F — add `mental_models` only after observations exist

Status: table exists, zero rows, no runtime usage.

Why sixth:
- mental models should be refreshed from observations, not authored into a vacuum
- otherwise they become another hand-maintained note layer

Concrete work:
- CRUD/search API for mental models
- hand-seed 3–5 models from durable recurring themes:
  - one-brain direction
  - retrieval-before-graph discipline
  - anti-PII / anti-fact-averaging constraints
- later add refresh from supporting observations

Definition of done:
- at least 3 active mental models in DB
- a reflect-style retrieval path can surface them deterministically

### Slice G — only now touch recall fusion

Status: deferred until slices A–F produce data.

What becomes reasonable here:
- graph expansion over `memory_links`
- temporal recall over `experiences.occurred_at` and document event timestamps
- mental-model-first / observation-second / raw-fact-third cascade

But only after the non-document memory layers are populated.

## Why this order is better than immediate TEMPR work

Because today:
- duplicate-source crowding is measurable already in the new eval
- document retrieval is already pretty strong
- the empty higher-order tables are the bigger product gap than raw search quality

So the next step with the highest leverage is not “new ranker math.”
It is “make the advanced tables contain useful memory objects.”

## Minimal success criteria for the next sprint

A good next sprint would end with all of this true:
- `consolidated_observations` exists in repo + DB
- `consolidation_jobs` has successful rows
- runtime actually reads `memory_banks` + `directives`
- at least a handful of `consolidated_observations` and `experiences` exist in production DB
- no retrieval logic changes have shipped yet

If that happens, then the next retrieval phase can be evaluated against something much closer to real Hindsight-class memory behavior.
