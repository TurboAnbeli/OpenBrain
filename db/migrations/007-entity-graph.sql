-- ─────────────────────────────────────────────────────────────────────
-- ryel-local migration: entity graph layer (typed entities + thought links)
--
-- Adds an `entities` table (canonical names + type + aliases) and a
-- `thought_entities` junction table linking thoughts to the entities they
-- mention.  A `search_thoughts_by_entity()` function returns thoughts
-- ranked by how many query entities they share.
--
-- Design notes:
--   - entity.type is open-text (person, org, concept, product, …) so
--     future ingest pipelines can add new taxonomies without schema changes.
--   - aliases[] stores variant spellings / abbreviations for fuzzy
--     matching without requiring a separate aliases table.
--   - weight on thought_entities defaults to 1.0; future relationship
--     types (e.g. "contradicts") can use negative or fractional weights.
--   - The HNSW + JOIN ordering warning from the 2026-05-31 reflection
--     is respected: entity search runs as a separate SQL query and its
--     results are fused via RRF in TypeScript, never joined into the
--     vector search.
--
-- Apply:
--   psql -U openbrain -d openbrain < db/migrations/007-entity-graph.sql
-- ─────────────────────────────────────────────────────────────────────

-- ── entities ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
    id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    name       TEXT        NOT NULL,
    type       TEXT        NOT NULL DEFAULT 'concept',
    aliases    JSONB       DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (name, type)
);

CREATE INDEX IF NOT EXISTS idx_entities_name
    ON entities USING gin (to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS idx_entities_type
    ON entities(type);

-- ── thought_entities ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thought_entities (
    thought_id UUID    NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
    entity_id  UUID    NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship TEXT  NOT NULL DEFAULT 'mentions',
    weight     FLOAT   NOT NULL DEFAULT 1.0,
    PRIMARY KEY (thought_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_thought_entities_entity
    ON thought_entities(entity_id);

CREATE INDEX IF NOT EXISTS idx_thought_entities_thought
    ON thought_entities(thought_id);

CREATE INDEX IF NOT EXISTS idx_thought_entities_rel
    ON thought_entities(relationship);

-- ── search_thoughts_by_entity ───────────────────────────────────────────
-- Returns thoughts that mention any of the supplied entity names,
-- ordered by the number of matching entities (densest overlap first).
-- Only non-archived thoughts are considered.  Optional project / user
-- scoping mirrors match_thoughts().  Supersession-aware: hides thoughts
-- that have been superseded unless include_superseded is true.
--
-- The overlap_count column is useful for RRF weighting in TypeScript.

DROP FUNCTION IF EXISTS search_thoughts_by_entity(TEXT[], TEXT, INT, TEXT, BOOLEAN, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION search_thoughts_by_entity(
    entity_names       TEXT[],
    cipher_key         TEXT,
    match_count        INT     DEFAULT 10,
    project_filter     TEXT    DEFAULT NULL,
    include_archived   BOOLEAN DEFAULT false,
    user_filter        TEXT    DEFAULT NULL,
    exclude_superseded BOOLEAN DEFAULT true
)
RETURNS TABLE (
    id            UUID,
    content       TEXT,
    metadata      JSONB,
    overlap_count INT,
    proof_count   INT,
    created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        pgp_sym_decrypt(t.content_enc, cipher_key)::TEXT AS content,
        t.metadata,
        COUNT(DISTINCT e.id)::INT AS overlap_count,
        t.proof_count,
        t.created_at
    FROM thoughts t
    JOIN thought_entities te ON te.thought_id = t.id
    JOIN entities e ON e.id = te.entity_id
    WHERE
        lower(e.name) = ANY(ARRAY(SELECT lower(x) FROM unnest(entity_names) AS x))
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(e.aliases) AS a
            WHERE lower(a) = ANY(ARRAY(SELECT lower(x) FROM unnest(entity_names) AS x))
        )
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
    GROUP BY t.id, t.content_enc, t.metadata, t.proof_count, t.created_at
    ORDER BY overlap_count DESC, t.created_at DESC
    LIMIT match_count;
END;
$$;
