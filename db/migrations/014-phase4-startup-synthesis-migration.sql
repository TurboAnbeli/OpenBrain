-- 014-phase4-startup-synthesis-migration.sql
-- Slice S data migration: promote legacy synthesis thoughts to first-class
-- consolidated_observations rows and archive the original synthesis thoughts.
--
-- Idempotent success states:
--   - pre-run: 29 active type='synthesis' thoughts, 0 migrated CO rows/links
--   - post-run: 0 active type='synthesis' thoughts, 29 migrated CO rows, 29 supersedes links

BEGIN;

CREATE TEMP TABLE slice_s_inserted (
    source_thought_id UUID PRIMARY KEY,
    co_id UUID NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
    active_synthesis_count INT;
    migrated_co_count INT;
    migrated_link_count INT;
BEGIN
    SELECT COUNT(*) INTO active_synthesis_count
    FROM thoughts
    WHERE type = 'synthesis' AND archived = false;

    SELECT COUNT(*) INTO migrated_co_count
    FROM consolidated_observations
    WHERE history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

    SELECT COUNT(*) INTO migrated_link_count
    FROM memory_links ml
    JOIN consolidated_observations co
      ON co.id = ml.source_id
     AND ml.source_type = 'consolidated_observation'
     AND ml.target_type = 'thought'
     AND ml.relationship = 'supersedes'
     AND ml.inferred = false
     AND ml.bank_id = 'openbrain'
    WHERE co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

    IF active_synthesis_count NOT IN (0, 29) THEN
        RAISE EXCEPTION 'Slice S expected active synthesis count 29 before migration or 0 after migration, got %', active_synthesis_count;
    END IF;

    IF active_synthesis_count = 0 AND (migrated_co_count <> 29 OR migrated_link_count <> 29) THEN
        RAISE EXCEPTION 'Slice S appears partially migrated: active synthesis=0, migrated_co=%, migrated_links=%', migrated_co_count, migrated_link_count;
    END IF;
END $$;

WITH source_thoughts AS (
    SELECT t.*
    FROM thoughts t
    WHERE t.type = 'synthesis'
      AND t.archived = false
      AND NOT EXISTS (
        SELECT 1
        FROM consolidated_observations co
        WHERE t.id = ANY(co.source_memory_ids)
          AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
      )
    ORDER BY t.created_at, t.id
    FOR UPDATE
), inserted AS (
    INSERT INTO consolidated_observations (
        bank_id,
        content_enc,
        embedding,
        fts,
        proof_count,
        source_memory_ids,
        source_quotes,
        tags,
        history,
        trend,
        project,
        created_by,
        archived,
        created_at,
        updated_at
    )
    SELECT
        COALESCE(t.bank_id, 'openbrain'),
        t.content_enc,
        t.embedding,
        t.fts,
        COALESCE(NULLIF(t.proof_count, 0), 1),
        ARRAY[t.id]::UUID[],
        jsonb_build_object(t.id::text, '<see source thought>'),
        CASE
            WHEN jsonb_typeof(t.metadata->'topics') = 'array' THEN t.metadata->'topics'
            ELSE '[]'::jsonb
        END,
        jsonb_build_array(jsonb_build_object(
            'event', 'phase4_startup_synthesis_migration',
            'source', 'slice_s',
            'source_thought_id', t.id::text,
            'migrated_at', now()
        )),
        'stable',
        t.project,
        t.created_by,
        false,
        t.created_at,
        now()
    FROM source_thoughts t
    RETURNING id, source_memory_ids
)
INSERT INTO slice_s_inserted (source_thought_id, co_id)
SELECT source_memory_ids[1], id
FROM inserted;

INSERT INTO memory_links (
    source_type,
    source_id,
    target_type,
    target_id,
    relationship,
    weight,
    inferred,
    bank_id
)
SELECT
    'consolidated_observation',
    co_id,
    'thought',
    source_thought_id,
    'supersedes',
    1.0,
    false,
    'openbrain'
FROM slice_s_inserted
ON CONFLICT (source_type, source_id, target_type, target_id, relationship) DO NOTHING;

UPDATE thoughts t
SET archived = true,
    updated_at = now()
FROM slice_s_inserted s
WHERE t.id = s.source_thought_id
  AND t.type = 'synthesis';

DO $$
DECLARE
    active_synthesis_count INT;
    archived_synthesis_count INT;
    migrated_co_count INT;
    active_migrated_co_count INT;
    migrated_link_count INT;
    linked_source_count INT;
    duplicate_source_count INT;
    active_original_with_active_co_count INT;
BEGIN
    SELECT COUNT(*) INTO active_synthesis_count
    FROM thoughts
    WHERE type = 'synthesis' AND archived = false;

    SELECT COUNT(*) INTO archived_synthesis_count
    FROM thoughts
    WHERE type = 'synthesis' AND archived = true;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE archived = false)
    INTO migrated_co_count, active_migrated_co_count
    FROM consolidated_observations
    WHERE history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

    SELECT COUNT(*) INTO migrated_link_count
    FROM memory_links ml
    JOIN consolidated_observations co
      ON co.id = ml.source_id
     AND ml.source_type = 'consolidated_observation'
     AND ml.target_type = 'thought'
     AND ml.relationship = 'supersedes'
     AND ml.inferred = false
     AND ml.bank_id = 'openbrain'
    JOIN thoughts t ON t.id = ml.target_id AND t.type = 'synthesis'
    WHERE co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

    SELECT COUNT(DISTINCT t.id) INTO linked_source_count
    FROM thoughts t
    JOIN memory_links ml
      ON ml.target_id = t.id
     AND ml.source_type = 'consolidated_observation'
     AND ml.target_type = 'thought'
     AND ml.relationship = 'supersedes'
     AND ml.inferred = false
     AND ml.bank_id = 'openbrain'
    JOIN consolidated_observations co
      ON co.id = ml.source_id
     AND t.id = ANY(co.source_memory_ids)
    WHERE t.type = 'synthesis'
      AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

    SELECT COUNT(*) INTO duplicate_source_count
    FROM (
        SELECT source_id, COUNT(*) AS refs
        FROM (
            SELECT unnest(source_memory_ids) AS source_id
            FROM consolidated_observations
            WHERE history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
        ) refs
        GROUP BY source_id
        HAVING COUNT(*) > 1
    ) duplicates;

    SELECT COUNT(*) INTO active_original_with_active_co_count
    FROM thoughts t
    WHERE t.type = 'synthesis'
      AND t.archived = false
      AND EXISTS (
        SELECT 1
        FROM consolidated_observations co
        WHERE t.id = ANY(co.source_memory_ids)
          AND co.archived = false
          AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb
      );

    IF active_synthesis_count <> 0 THEN
        RAISE EXCEPTION 'Slice S expected 0 active synthesis originals after migration, got %', active_synthesis_count;
    END IF;
    IF archived_synthesis_count < 29 THEN
        RAISE EXCEPTION 'Slice S expected at least 29 archived synthesis originals, got %', archived_synthesis_count;
    END IF;
    IF migrated_co_count <> 29 THEN
        RAISE EXCEPTION 'Slice S expected 29 migrated consolidated_observations, got %', migrated_co_count;
    END IF;
    IF active_migrated_co_count <> 29 THEN
        RAISE EXCEPTION 'Slice S expected 29 active migrated consolidated_observations, got %', active_migrated_co_count;
    END IF;
    IF migrated_link_count <> 29 THEN
        RAISE EXCEPTION 'Slice S expected 29 migrated supersedes links, got %', migrated_link_count;
    END IF;
    IF linked_source_count <> 29 THEN
        RAISE EXCEPTION 'Slice S expected 29 distinct migrated source thoughts with matching links, got %', linked_source_count;
    END IF;
    IF duplicate_source_count <> 0 THEN
        RAISE EXCEPTION 'Slice S expected no duplicate migrated source refs, got %', duplicate_source_count;
    END IF;
    IF active_original_with_active_co_count <> 0 THEN
        RAISE EXCEPTION 'Slice S expected no active originals with active migrated CO rows, got %', active_original_with_active_co_count;
    END IF;
END $$;

COMMIT;
