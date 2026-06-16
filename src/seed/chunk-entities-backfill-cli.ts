/**
 * Slice V backfill — populate chunk_entities for existing document_chunks.
 *
 * Reads chunks in batches, runs extractEntities() over each chunk's content,
 * and inserts into chunk_entities (upserting entities by name+type). Skips
 * chunks that already have entries unless --force is passed.
 *
 * Usage:
 *   tsx src/seed/chunk-entities-backfill-cli.ts                 # run
 *   tsx src/seed/chunk-entities-backfill-cli.ts --dry-run       # report only
 *   tsx src/seed/chunk-entities-backfill-cli.ts --batch-size 50 # tune batch
 */

import { closePool, getPool, initializeDatabase } from "../db/connection.js";
import { extractEntities } from "../api/entity_extraction.js";
import { extractAndLinkChunkEntities } from "../db/queries.js";
import { getCipherKey } from "../db/connection.js";

interface CliOptions {
  dry_run: boolean;
  force: boolean;
  batch_size: number;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let batch = 200;
  const i = args.indexOf("--batch-size");
  if (i !== -1 && args[i + 1]) batch = parseInt(args[i + 1]!, 10);
  return {
    dry_run: args.includes("--dry-run"),
    force: args.includes("--force"),
    batch_size: Math.max(10, Math.min(1000, Number.isFinite(batch) ? batch : 200)),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  await initializeDatabase();
  const pool = getPool();
  const key = getCipherKey();

  const { rows: totalRow } = await pool.query<{ count: string }>("SELECT count(*) FROM document_chunks");
  const total = parseInt(totalRow[0]!.count, 10);
  const { rows: preRow } = await pool.query<{ count: string }>("SELECT count(*) FROM chunk_entities");
  const preCount = parseInt(preRow[0]!.count, 10);

  console.log(`[backfill] chunks=${total} chunk_entities(pre)=${preCount} dry_run=${opts.dry_run} force=${opts.force} batch=${opts.batch_size}`);

  let processed = 0;
  let withEntities = 0;
  let skipped = 0;
  let entitiesLinked = 0;
  let lastSeenId: string | null = null;

  // Use keyset pagination on chunk_id so we don't depend on offset advancing
  // against a set whose membership we are mutating (chunk_entities INSERT moves
  // rows out of the NOT-EXISTS predicate, which made OFFSET skip rows).
  while (true) {
    const params: unknown[] = [key, opts.batch_size];
    let keysetClause = "";
    if (lastSeenId !== null) {
      params.push(lastSeenId);
      keysetClause = `AND id > $${params.length}`;
    }
    const sql: string = opts.force
      ? `SELECT id, pgp_sym_decrypt(content_enc, $1)::text AS content, metadata
         FROM document_chunks
         WHERE TRUE ${keysetClause}
         ORDER BY id LIMIT $2`
      : `SELECT id, pgp_sym_decrypt(content_enc, $1)::text AS content, metadata
         FROM document_chunks dc
         WHERE NOT EXISTS (SELECT 1 FROM chunk_entities ce WHERE ce.chunk_id = dc.id)
           ${keysetClause}
         ORDER BY id LIMIT $2`;
    const result = await pool.query<{ id: string; content: string; metadata: Record<string, unknown> }>(
      sql,
      params
    );
    const rows = result.rows;
    if (rows.length === 0) break;

    for (const chunk of rows) {
      processed++;
      const entities = extractEntities(
        chunk.content,
        chunk.metadata as { people?: string[]; topics?: string[] } | undefined
      );
      if (entities.length === 0) {
        skipped++;
        continue;
      }
      withEntities++;
      entitiesLinked += entities.length;
      if (!opts.dry_run) {
        await extractAndLinkChunkEntities(pool, chunk.id, entities);
      }
    }

    // In dry-run we never mutate, so the NOT-EXISTS set never shrinks; we must
    // advance lastSeenId to make progress. In live mode the NOT-EXISTS set
    // shrinks from the front (linked chunks no longer match), so resetting
    // lastSeenId to null still advances. For skipped (no-entity) chunks the
    // shrink doesn't apply, so we always keep keyset advance to be safe.
    lastSeenId = rows[rows.length - 1]!.id;
    if (processed % (opts.batch_size * 5) === 0 || rows.length < opts.batch_size) {
      console.log(`[backfill] processed=${processed} with_entities=${withEntities} skipped=${skipped} linked=${entitiesLinked}`);
    }
    if (rows.length < opts.batch_size) break;
  }

  const { rows: postRow } = await pool.query<{ count: string }>("SELECT count(*) FROM chunk_entities");
  const postCount = parseInt(postRow[0]!.count, 10);
  console.log(
    `[backfill] DONE processed=${processed} with_entities=${withEntities} skipped=${skipped} entities_linked=${entitiesLinked} chunk_entities(post)=${postCount} delta=${postCount - preCount} dry_run=${opts.dry_run}`
  );

  await closePool();
}

main().catch((err) => {
  console.error("[backfill] FAILED:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
