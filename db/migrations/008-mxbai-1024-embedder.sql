-- Migration 008: embedder cutover nomic-embed-text (768) -> mxbai-embed-large (1024)
--
-- 2026-06-09. Measured on the live corpus (1364 thoughts): mxbai-embed-large
-- dramatically outperforms nomic-embed-text on this KB. Pure-vector eval
-- (tools/openbrain-eval/eval_v2.py): standard R@5 78% -> 97%, MRR 0.71 -> 0.87;
-- adversarial paraphrase 62% -> 88%. Full-stack after retuning (see notes):
-- standard R@5 90.6%, adversarial 76.7%.
--
-- This migration is a RECORD + schema assertion. The actual cutover was a DATA
-- migration, not pure DDL, performed as:
--   1. tools/openbrain-eval/reembed_parallel.py --model mxbai-embed-large --dim 1024
--      (re-embeds every thought into a parallel thoughts_v2 table)
--   2. snapshot old vectors:  CREATE TABLE thoughts_emb_backup_768 AS
--                             SELECT id, embedding FROM thoughts;
--   3. in one transaction: DROP INDEX idx_thoughts_embedding;
--      ALTER TABLE thoughts ALTER COLUMN embedding TYPE vector(1024) USING NULL;
--      UPDATE thoughts t SET embedding = v.embedding FROM thoughts_v2 v WHERE t.id=v.id;
--      (abort if any NULL remained);  rebuild HNSW index.
--   4. metadata.embedder_version set to 'mxbai-embed-large'.
--
-- match_thoughts() takes an UNTYPED `vector` param and INSERT casts `$2::vector`,
-- so no function/code signature changes were needed — only the column typmod.
--
-- REQUIRED .env for this to work (NOT in git):
--   OLLAMA_EMBED_MODEL=mxbai-embed-large
--   EMBEDDING_DIMENSIONS=1024
--   OPENBRAIN_ENTITY_RANKING=false   -- entity-weighted RRF was tuned for the
--     weaker nomic embeddings; on mxbai it DILUTES the (much stronger) dense
--     ranking. Measured: enabling it drops standard R@5 90.6% -> 75%. Re-enable
--     only with a much lower entity weight (raise ENTITY_K in entity_ranking.ts)
--     after re-measuring. The entity graph (migration 007) remains populated.
--
-- Idempotent assertion: ensure the column is vector(1024). Safe to run on an
-- already-migrated DB; on a fresh init.sql (now 1024) it is a no-op. Do NOT run
-- on a populated 768 DB without the re-embed data step above — there is nothing
-- to cast 768->1024 to and embeddings would be lost.

DO $$
DECLARE dim int;
BEGIN
  SELECT atttypmod INTO dim FROM pg_attribute
   WHERE attrelid = 'thoughts'::regclass AND attname = 'embedding';
  IF dim IS DISTINCT FROM 1024 THEN
    RAISE NOTICE 'thoughts.embedding typmod is % (expected 1024). Run the data migration in this file''s header.', dim;
  ELSE
    RAISE NOTICE 'thoughts.embedding already vector(1024) — OK.';
  END IF;
END $$;
