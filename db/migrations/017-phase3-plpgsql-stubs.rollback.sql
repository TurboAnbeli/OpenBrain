-- 017-phase3-plpgsql-stubs.rollback.sql
--
-- Rollback: drop the three intentionally deferred Phase 3 PL/pgSQL stubs.
-- These functions have no callers — they exist only as contracts for future
-- implementation. Safe to drop at any time.

BEGIN;

DROP FUNCTION IF EXISTS recall_temporal(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS expand_by_graph(UUID[], TEXT, TEXT, INT, INT, TEXT);
DROP FUNCTION IF EXISTS recall_memories(TEXT, TEXT, VECTOR(768), TEXT, INT, TEXT[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, UUID[]);

COMMIT;