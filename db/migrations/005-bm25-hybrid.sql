-- ─────────────────────────────────────────────────────────────────────
-- ryel-local migration: BM25 full-text search column + hybrid function
--
-- Adds a `fts TSVECTOR` column to thoughts, a GIN index over it, and a
-- bm25_search_thoughts() function that returns results ranked by ts_rank_cd.
-- Callers combine BM25 and dense results via Reciprocal Rank Fusion.
--
-- The fts column is populated from plaintext content at INSERT/UPDATE time
-- by the application (queries.ts). It is NOT encrypted — it stores
-- stemmed/tokenized word forms, not raw content. Acceptable: the DB is
-- localhost-only, and tsvector leaks far less than plaintext.
--
-- After applying this migration, backfill existing rows:
--   UPDATE thoughts
--   SET fts = to_tsvector('english', pgp_sym_decrypt(content_enc, '<cipher_key>'))
--   WHERE fts IS NULL;
-- The cipher key lives at the path in CIPHER_KEY_PATH (/etc/openbrain/cipher.key).
-- A TypeScript backfill helper (backfillFts) is also available at server startup.
--
-- Apply:
--   psql -U openbrain -d openbrain < db/migrations/005-bm25-hybrid.sql
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS fts TSVECTOR;

CREATE INDEX IF NOT EXISTS idx_thoughts_fts
    ON thoughts USING GIN (fts);

-- bm25_search_thoughts: full-text search over decrypted content.
-- Returns (id, content, metadata, bm25_rank, created_at) ordered by BM25 rank.
-- Mirrors match_thoughts filters: project, archived, user, supersession.
-- websearch_to_tsquery is used over plainto_tsquery so multi-word natural-
-- language queries tokenize correctly; it gracefully drops pure-stopword queries.

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
    id         UUID,
    content    TEXT,
    metadata   JSONB,
    bm25_rank  FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    tsq TSQUERY;
BEGIN
    tsq := websearch_to_tsquery('english', query_text);
    -- If the query reduces to no lexemes (all stopwords / empty), return nothing.
    IF tsq IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        pgp_sym_decrypt(t.content_enc, cipher_key)::TEXT AS content,
        t.metadata,
        ts_rank_cd(t.fts, tsq)::FLOAT AS bm25_rank,
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
