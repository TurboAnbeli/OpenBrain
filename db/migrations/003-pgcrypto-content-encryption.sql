-- ─────────────────────────────────────────────────────────────────────
-- ryel-local migration: column-level encryption on thoughts.content
--
-- Applies pgcrypto symmetric encryption (AES-256 via PGP message format)
-- to the thought body. Embedding stays plaintext (it's a numeric vector,
-- not the original text — required for similarity search).
--
-- Threat model: protects against DB-file leakage, backup leakage, and
-- another local process reading the docker volume. FileVault + loopback
-- networking + DB credentials are the other layers; this closes the
-- "plaintext at rest in the database" gap.
--
-- Apply manually (not part of upstream init.sql):
--   docker exec -i openbrain-postgres psql -U openbrain -d openbrain \
--     < db/migrations/003-pgcrypto-content-encryption.sql
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add the encrypted column. Bytea holds the PGP-formatted ciphertext.
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS content_enc BYTEA;

-- 2. Drop existing rows (smoke-test data only at this point) so we don't
--    leave orphaned plaintext content. Real data lands after this migration.
TRUNCATE thoughts;

-- 3. Drop the plaintext column. Embedding/metadata remain plaintext by design.
ALTER TABLE thoughts DROP COLUMN IF EXISTS content;

-- 4. Make content_enc NOT NULL — an unencrypted thought is a bug, not a state.
ALTER TABLE thoughts ALTER COLUMN content_enc SET NOT NULL;

-- 5. Replace match_thoughts() with a version that takes the cipher key and
--    returns decrypted content. Same return shape as the original — callers
--    upstream code that selects (id, content, metadata, similarity, created_at)
--    keeps working.
DROP FUNCTION IF EXISTS match_thoughts(VECTOR, FLOAT, INT, JSONB, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding  VECTOR(768),
    cipher_key       TEXT,
    match_threshold  FLOAT   DEFAULT 0.5,
    match_count      INT     DEFAULT 10,
    filter           JSONB   DEFAULT '{}'::jsonb,
    project_filter   TEXT    DEFAULT NULL,
    include_archived BOOLEAN DEFAULT false,
    user_filter      TEXT    DEFAULT NULL
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
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;
