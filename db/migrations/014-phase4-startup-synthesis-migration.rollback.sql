-- 014-phase4-startup-synthesis-migration.rollback.sql
-- Roll back Slice S data migration by deleting migrated consolidated_observations,
-- deleting their deterministic supersedes links, and unarchiving the original
-- synthesis thoughts.

BEGIN;

CREATE TEMP TABLE slice_s_targets AS
SELECT
    co.id AS co_id,
    ml.target_id AS source_thought_id
FROM consolidated_observations co
JOIN memory_links ml
  ON ml.source_id = co.id
 AND ml.source_type = 'consolidated_observation'
 AND ml.target_type = 'thought'
 AND ml.relationship = 'supersedes'
 AND ml.inferred = false
 AND ml.bank_id = 'openbrain'
JOIN thoughts t ON t.id = ml.target_id AND t.type = 'synthesis'
WHERE co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

UPDATE thoughts t
SET archived = false,
    updated_at = now()
FROM slice_s_targets s
WHERE t.id = s.source_thought_id
  AND t.type = 'synthesis';

DELETE FROM memory_links ml
USING slice_s_targets s
WHERE ml.source_type = 'consolidated_observation'
  AND ml.source_id = s.co_id
  AND ml.target_type = 'thought'
  AND ml.target_id = s.source_thought_id
  AND ml.relationship = 'supersedes'
  AND ml.inferred = false
  AND ml.bank_id = 'openbrain';

DELETE FROM consolidated_observations co
USING slice_s_targets s
WHERE co.id = s.co_id
  AND co.history @> '[{"event":"phase4_startup_synthesis_migration"}]'::jsonb;

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

    IF active_synthesis_count < 29 THEN
        RAISE EXCEPTION 'Slice S rollback expected at least 29 active synthesis thoughts, got %', active_synthesis_count;
    END IF;
    IF migrated_co_count <> 0 THEN
        RAISE EXCEPTION 'Slice S rollback expected 0 migrated consolidated_observations, got %', migrated_co_count;
    END IF;
    IF migrated_link_count <> 0 THEN
        RAISE EXCEPTION 'Slice S rollback expected 0 migrated supersedes links, got %', migrated_link_count;
    END IF;
END $$;

COMMIT;
