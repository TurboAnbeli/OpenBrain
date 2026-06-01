-- ─────────────────────────────────────────────────────────────────────
-- ryel-local migration: supersession-aware match_thoughts
--
-- The thoughts table has had a `supersedes UUID REFERENCES thoughts(id)`
-- column since init.sql, but the column was never read by retrieval —
-- so a newer thought that explicitly superseded an older one would still
-- compete with it in semantic search, and stale facts could outrank
-- current ones.
--
-- This migration replaces match_thoughts() with one that hides any thought
-- referenced by another thought's `supersedes` column. Default is true
-- (hide superseded); pass `exclude_superseded = false` to see the full
-- chain (audit / debugging).
--
-- The new parameter is appended at the end of the function signature so
-- existing 8-arg callers (src/db/queries.ts:searchThoughts) keep working
-- without code changes — Postgres fills the default.
--
-- Backfill of historical `supersedes` edges is event-driven going forward:
-- when an ingest produces a thought that explicitly supersedes another,
-- populate the column at insert time. Retroactive backfill is a separate
-- workflow (see openbrain-ingest manifest schema).
--
-- Apply manually (matches the convention from migrations 001-003):
--   docker exec -i openbrain-postgres psql -U openbrain -d openbrain \
--     < db/migrations/004-supersession-aware-retrieval.sql
-- ─────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS match_thoughts(VECTOR, TEXT, FLOAT, INT, JSONB, TEXT, BOOLEAN, TEXT);

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
        pgp_sym_decrypt(t.content_enc, cipher_key)::TEXT AS content,
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
