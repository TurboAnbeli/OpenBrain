# Deferred: PL/pgSQL TEMPR Unification

**Status:** Deferred (2026-06-18)
**Plan ref:** v2.3.2 §7 Phase 3 — "TEMPR 4-lane recall_memories() PL/pgSQL function"

## Context

The v2.3.2 plan specified creating three PL/pgSQL functions as the canonical
recall interface:

1. `recall_memories(pool, embedding, options)` — unified 4-lane retrieval
2. `expand_by_graph(pool, entity_ids, options)` — graph expansion
3. `recall_temporal(pool, options)` — temporal lane

## Why deferred

All three capabilities are **already implemented in TypeScript** and wired
into the `/recall` POST endpoint in `src/api/routes.ts`:

| Capability | TypeScript implementation | PL/pgSQL stub |
|---|---|---|
| Semantic + BM25 | `searchThoughts()`, `searchDocumentChunks()` | None |
| Chunk graph (entity overlap) | `searchDocumentChunksByEntity()` | None |
| Temporal | `recallTemporalMemories()` | None |
| Memory link expansion | `expandMemoryLinks()` | None |
| Observation retrieval | `searchConsolidatedObservations()` | None |
| Mental model retrieval | `searchMentalModels()` | None |
| Source routing | `extractQueryEntityNames()`, heuristic router | N/A |
| Result blending | `upsertRecallResult()`, `rankRecallResults()` | N/A |

Creating PL/pgSQL wrappers that duplicate this logic adds surface with no
caller. The API route assembles lanes in-process and blends via TypeScript.
A future optimization could push the full TEMPR pipeline into a single DB
round-trip, but that requires a clear performance bottleneck to justify the
migration risk.

## Revisit criteria

- `/recall` p95 latency exceeds 800ms in production
- A single-DB-round-trip TEMPR function would cut measurable latency
- The TypeScript lane assembly becomes a maintenance burden

Until then, the TypeScript implementation is canonical.
