-- 012-consolidated-observations.sql
-- First-class consolidated observations store: encrypted content, vector search,
-- provenance/evidence pointers, and lightweight revision history.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS consolidated_observations (
    id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    bank_id            TEXT        NOT NULL DEFAULT 'openbrain' REFERENCES memory_banks(id) ON DELETE RESTRICT,
    content_enc        BYTEA       NOT NULL,
    embedding          VECTOR(768),
    fts                TSVECTOR,
    proof_count        INTEGER     NOT NULL DEFAULT 1,
    source_memory_ids  UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
    source_quotes      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    tags               JSONB       NOT NULL DEFAULT '[]'::jsonb,
    history            JSONB       NOT NULL DEFAULT '[]'::jsonb,
    trend              TEXT,
    trend_computed_at  TIMESTAMPTZ,
    project            TEXT,
    created_by         TEXT,
    archived           BOOLEAN     NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT consolidated_observations_proof_count_check CHECK (proof_count >= 0),
    CONSTRAINT consolidated_observations_trend_check CHECK (
        trend IS NULL OR trend IN ('strengthening', 'stable', 'weakening', 'stale')
    )
);

DROP TRIGGER IF EXISTS set_consolidated_observations_updated_at ON consolidated_observations;
CREATE TRIGGER set_consolidated_observations_updated_at
    BEFORE UPDATE ON consolidated_observations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_consobs_bank_project
    ON consolidated_observations(bank_id, project, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consobs_created_by
    ON consolidated_observations(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consobs_source_memory_ids
    ON consolidated_observations USING GIN(source_memory_ids);
CREATE INDEX IF NOT EXISTS idx_consobs_tags
    ON consolidated_observations USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_consobs_history
    ON consolidated_observations USING GIN(history);
CREATE INDEX IF NOT EXISTS idx_consobs_fts
    ON consolidated_observations USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_consobs_source_quotes
    ON consolidated_observations USING GIN(source_quotes);
CREATE INDEX IF NOT EXISTS idx_consobs_embedding_hnsw
    ON consolidated_observations USING hnsw (embedding vector_cosine_ops);

COMMIT;
