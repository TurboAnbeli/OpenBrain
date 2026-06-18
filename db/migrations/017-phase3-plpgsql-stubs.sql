-- 017-phase3-plpgsql-stubs.sql
--
-- Intentionally deferred Phase 3 PL/pgSQL function stubs.
--
-- These three functions define the *contract* for future TEMPR (TEMPoral,
-- Entity-graph, BM25, Reciprocal-rank-fusion) unification inside PostgreSQL.
-- They are **stubbed** — each raises 'not implemented' — because all three
-- capabilities are currently handled in TypeScript by the /recall endpoint
-- (src/api/routes.ts). See docs/deferred-pl-pgsql-unification.md for the
-- full rationale and revisit criteria.
--
-- DO NOT implement these functions until the revisit criteria are met:
--   1. /recall p95 latency exceeds 800ms in production, OR
--   2. A single-DB-round-trip TEMPR function would cut measurable latency, OR
--   3. The TypeScript lane assembly becomes a maintenance burden.
--
-- Until then, the TypeScript implementation is canonical.

BEGIN;

-- =============================================================================
-- recall_memories: unified 4-lane retrieval (semantic + BM25 + graph + temporal)
-- -----------------------------------------------------------------------------
-- This function would accept a query embedding + text and return blended
-- results from all four recall lanes using reciprocal-rank fusion. Currently
-- the /recall POST endpoint assembles lanes in-process via TypeScript:
--   - Semantic + BM25: searchThoughts(), searchDocumentChunks()
--   - Entity-graph:    searchDocumentChunksByEntity()
--   - Temporal:         recallTemporalMemories()
--   - Blending:         upsertRecallResult(), rankRecallResults()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recall_memories(
    bank_id            TEXT,
    query_text         TEXT,
    query_embedding     VECTOR(768),
    cipher_key         TEXT,
    match_count        INT     DEFAULT 20,
    fact_type_filter   TEXT[]  DEFAULT NULL,
    project_filter     TEXT    DEFAULT NULL,
    time_start         TIMESTAMPTZ DEFAULT NULL,
    time_end           TIMESTAMPTZ DEFAULT NULL,
    include_superseded BOOLEAN DEFAULT false,
    entity_hint_ids    UUID[]  DEFAULT NULL
) RETURNS TABLE (
    id              UUID,
    source_type     TEXT,
    content         TEXT,
    similarity      FLOAT,
    bm25_rank       FLOAT,
    graph_score     FLOAT,
    temporal_score  FLOAT,
    proof_count     INT,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'not implemented: recall_memories is a Phase 3 stub. '
                    'The /recall endpoint currently handles all lane blending in TypeScript. '
                    'See docs/deferred-pl-pgsql-unification.md for revisit criteria.';
END;
$$;

-- =============================================================================
-- expand_by_graph: entity-graph expansion from seed memory IDs
-- -----------------------------------------------------------------------------
-- Given a set of seed thought/document/chunk IDs, walk entity and
-- relationship edges N hops and return overlapping memories. Currently
-- handled by expandMemoryLinks() and searchDocumentChunksByEntity() in
-- TypeScript. No current code path calls this SQL function.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expand_by_graph(
    seed_ids       UUID[],
    bank_id        TEXT,
    cipher_key     TEXT,
    depth          INT     DEFAULT 1,
    max_results    INT     DEFAULT 30,
    project_filter TEXT    DEFAULT NULL
) RETURNS TABLE (
    id UUID, content TEXT, hop_count INT, overlap_count INT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'not implemented: expand_by_graph is a Phase 3 stub. '
                    'Graph expansion is handled by expandMemoryLinks() in TypeScript. '
                    'See docs/deferred-pl-pgsql-unification.md for revisit criteria.';
END;
$$;

-- =============================================================================
-- recall_temporal: temporal-lane recall over event windows
-- -----------------------------------------------------------------------------
-- Retrieve facts that occurred within or overlap a given time window.
-- Currently handled by recallTemporalMemories() in TypeScript. No current
-- code path calls this SQL function.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recall_temporal(
    bank_id        TEXT,
    window_start   TIMESTAMPTZ,
    window_end     TIMESTAMPTZ,
    cipher_key     TEXT,
    match_count    INT     DEFAULT 50,
    project_filter TEXT    DEFAULT NULL
) RETURNS TABLE (
    id UUID, content TEXT, event_started_at TIMESTAMPTZ, event_ended_at TIMESTAMPTZ,
    match_kind TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'not implemented: recall_temporal is a Phase 3 stub. '
                    'Temporal recall is handled by recallTemporalMemories() in TypeScript. '
                    'See docs/deferred-pl-pgsql-unification.md for revisit criteria.';
END;
$$;

COMMIT;