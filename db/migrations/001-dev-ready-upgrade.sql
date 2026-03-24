-- Migration 001: Dev-Ready Upgrade
-- Adds project scoping, archival, supersedes linking, and updated match_thoughts() RPC.
-- Safe to run on existing data: all new columns are nullable or have defaults.

BEGIN;

-- Add project column (nullable for backward compatibility)
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS project TEXT;
CREATE INDEX IF NOT EXISTS idx_thoughts_project ON thoughts(project);

-- Add archived flag
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_thoughts_archived ON thoughts(archived) WHERE archived = false;

-- Add supersedes reference
ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES thoughts(id);
CREATE INDEX IF NOT EXISTS idx_thoughts_supersedes ON thoughts(supersedes);

-- Updated semantic search function with project + archive filtering
CREATE OR REPLACE FUNCTION match_thoughts(
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.5,
    match_count     INT   DEFAULT 10,
    filter          JSONB DEFAULT '{}'::jsonb,
    project_filter  TEXT  DEFAULT NULL,
    include_archived BOOLEAN DEFAULT false
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
        AND (project_filter IS NULL OR t.project = project_filter)
        AND (include_archived OR t.archived = false)
    ORDER BY t.embedding <=> query_embedding ASC
    LIMIT match_count;
END;
$$;

COMMIT;
