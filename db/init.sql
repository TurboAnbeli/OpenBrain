-- Open Brain Database Schema
-- PostgreSQL 17 + pgvector

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create thoughts table
CREATE TABLE IF NOT EXISTS thoughts (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    content    TEXT        NOT NULL,
    embedding  VECTOR(768),
    metadata   JSONB       DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON thoughts;
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON thoughts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- HNSW index for vector similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_thoughts_embedding
    ON thoughts
    USING hnsw (embedding vector_cosine_ops);

-- GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS idx_thoughts_metadata
    ON thoughts
    USING gin (metadata);

-- B-tree index for date ordering
CREATE INDEX IF NOT EXISTS idx_thoughts_created_at
    ON thoughts (created_at DESC);

-- Semantic search function
CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.5,
    match_count     INT   DEFAULT 10,
    filter          JSONB DEFAULT '{}'::jsonb
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
        t.content,
        t.metadata,
        1 - (t.embedding <=> query_embedding) AS similarity,
        t.created_at
    FROM thoughts t
    WHERE
        1 - (t.embedding <=> query_embedding) >= match_threshold
        AND t.metadata @> filter
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

-- Enable Row Level Security
ALTER TABLE thoughts ENABLE ROW LEVEL SECURITY;
