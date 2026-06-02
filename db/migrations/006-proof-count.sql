-- ─────────────────────────────────────────────────────────────────────
-- ryel-local migration: proof_count — confidence signal for repeated
-- near-duplicate observations.
--
-- Adds `proof_count INT NOT NULL DEFAULT 1` to thoughts. When the
-- capture path detects a near-duplicate (cosine sim >= threshold,
-- controlled by OPENBRAIN_DEDUP_THRESHOLD), it increments proof_count
-- on the existing thought instead of inserting a new row. This mirrors
-- Hindsight's "observation reinforcement" pattern.
--
-- Retrieval applies a multiplicative boost: score × (1 + 0.05 × min(ln(n), 1))
-- which yields up to +5% for highly-reinforced thoughts (n >= e^1 ≈ 2.7).
-- The boost is applied in TypeScript (src/api/proof_count_boost.ts) after
-- RRF and before the optional cross-encoder rerank.
--
-- match_thoughts() and bm25_search_thoughts() are recreated to add
-- proof_count to their RETURNS TABLE. Callers that don't select proof_count
-- explicitly are unaffected.
--
-- Apply:
--   docker exec -i openbrain-postgres psql -U openbrain -d openbrain \
--     < db/migrations/006-proof-count.sql
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS proof_count INT NOT NULL DEFAULT 1;

-- ── match_thoughts ────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS match_thoughts(VECTOR, TEXT, FLOAT, INT, JSONB, TEXT, BOOLEAN, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding    VECTOR(768),
    cipher_key         TEXT,
    match_threshold    FLOAT   DEFAULT 0.5,
    match_count        INT     DEFAULT 10,
    filter             JSONB   DEFAULT '{}'::jsonb,
    project_filter     TEXT    DEFAULT NULL,
    include_archived   BOOLEAN DEFAULT false,
    user_filter        TEXT    DEFAULT NULL,
    exclude_superseded BOOLEAN DEFAULT true
)
RETURNS TABLE (
    id          UUID,
    content     TEXT,
    metadata    JSONB,
    similarity  FLOAT,
    proof_count INT,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        pgp_sym_decrypt(t.content_enc, cipher_key)::TEXT AS content,
        t.metadata,
        1 - (t.embedding <=> query_embedding) AS similarity,
        t.proof_count,
        t.created_at
    FROM thoughts t
    WHERE
        1 - (t.embedding <=> query_embedding) >= match_threshold
        AND t.metadata @> filter
        AND (project_filter IS NULL OR t.project = project_filter)
        AND (include_archived OR t.archived = false)
        AND (user_filter IS NULL OR t.created_by = user_filter)
        AND (
            NOT exclude_superseded
            OR NOT EXISTS (
                SELECT 1 FROM thoughts newer
                WHERE newer.supersedes = t.id
                  AND (include_archived OR newer.archived = false)
            )
        )
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- ── bm25_search_thoughts ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS bm25_search_thoughts(TEXT, TEXT, INT, JSONB, TEXT, BOOLEAN, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION bm25_search_thoughts(
    query_text         TEXT,
    cipher_key         TEXT,
    match_count        INT     DEFAULT 10,
    filter             JSONB   DEFAULT '{}'::jsonb,
    project_filter     TEXT    DEFAULT NULL,
    include_archived   BOOLEAN DEFAULT false,
    user_filter        TEXT    DEFAULT NULL,
    exclude_superseded BOOLEAN DEFAULT true
)
RETURNS TABLE (
    id          UUID,
    content     TEXT,
    metadata    JSONB,
    bm25_rank   FLOAT,
    proof_count INT,
    created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    tsq TSQUERY;
BEGIN
    tsq := websearch_to_tsquery('english', query_text);
    IF tsq IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        pgp_sym_decrypt(t.content_enc, cipher_key)::TEXT AS content,
        t.metadata,
        ts_rank_cd(t.fts, tsq)::FLOAT AS bm25_rank,
        t.proof_count,
        t.created_at
    FROM thoughts t
    WHERE
        t.fts @@ tsq
        AND t.fts IS NOT NULL
        AND t.metadata @> filter
        AND (project_filter IS NULL OR t.project = project_filter)
        AND (include_archived OR t.archived = false)
        AND (user_filter IS NULL OR t.created_by = user_filter)
        AND (
            NOT exclude_superseded
            OR NOT EXISTS (
                SELECT 1 FROM thoughts newer
                WHERE newer.supersedes = t.id
                  AND (include_archived OR newer.archived = false)
            )
        )
    ORDER BY bm25_rank DESC
    LIMIT match_count;
END;
$$;

-- ── find_near_duplicate ───────────────────────────────────────────────
-- Used by the capture path to detect near-identical thoughts before
-- inserting. Returns the id and similarity of the closest match above
-- the supplied threshold, or no rows if none found.
-- Scoped to project when project_filter is non-null.

CREATE OR REPLACE FUNCTION find_near_duplicate(
    query_embedding VECTOR(768),
    threshold       FLOAT   DEFAULT 0.95,
    project_filter  TEXT    DEFAULT NULL,
    user_filter     TEXT    DEFAULT NULL
)
RETURNS TABLE (
    id         UUID,
    similarity FLOAT
)
LANGUAGE sql
AS $$
    SELECT t.id,
           1 - (t.embedding <=> query_embedding) AS similarity
    FROM thoughts t
    WHERE
        1 - (t.embedding <=> query_embedding) >= threshold
        AND t.archived = false
        AND (project_filter IS NULL OR t.project = project_filter)
        AND (user_filter IS NULL OR t.created_by = user_filter)
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT 1;
$$;
