/**
 * Stale-reindex worker — self-healing background sweeper.
 *
 * Periodically polls document chunk embedder versions and automatically
 * reindexes documents whose chunks are stale (embedding model mismatch).
 *
 * Design constraints:
 *   - One batch per cycle (configurable batch size, default 25)
 *   - Respects DISABLE_AUTO_REINDEX env var for manual-only mode
 *   - Continues on individual document failure (logs failure, moves on)
 *   - Uses same embedder circuit-breaker chain as API routes
 *   - Poll interval: configurable via AUTO_REINDEX_INTERVAL_MS (default 15 min)
 */

import type pg from "pg";

import {
  listDocumentsForReindex,
  getDocumentChunkEmbedderVersionStats,
  updateDocumentWithChunks,
  extractAndLinkChunkEntities,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";
import type { Embedder } from "../embedder/types.js";
import { chunkMarkdown } from "../import/markdown.js";
import { extractEntities } from "../api/entity_extraction.js";

const DEFAULT_INTERVAL_MS = 900_000; // 15 minutes
const DEFAULT_BATCH_SIZE = 25;

export interface EmbedderVersionStat {
  embedder_version: string;
  count: number;
}

export interface StaleReindexResult {
  /** Number of documents successfully reindexed. */
  reindexed: number;
  /** Number of documents that failed reindex. */
  failed: number;
  /** Stale embedder version stats detected this cycle. */
  staleVersions: EmbedderVersionStat[];
  /** Whether this cycle was skipped (disabled or no stale chunks). */
  skipped: boolean;
  /** Human-readable summary. */
  summary: string;
}

export interface StaleReindexWorkerOptions {
  pool: pg.Pool;
  intervalMs?: number;
  batchSize?: number;
}

function incompatibleChunkVersions(stats: EmbedderVersionStat[], targetVersion: string): EmbedderVersionStat[] {
  return stats.filter((stat) => stat.count > 0 && stat.embedder_version !== targetVersion);
}

export class StaleReindexWorker {
  private readonly pool: pg.Pool;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  public running = false;
  private shutdownAbort = new AbortController();

  constructor(options: StaleReindexWorkerOptions) {
    this.pool = options.pool;
    this.intervalMs = options.intervalMs ?? (parseInt(process.env.AUTO_REINDEX_INTERVAL_MS ?? "", 10) || DEFAULT_INTERVAL_MS);
    this.batchSize = options.batchSize ?? (parseInt(process.env.AUTO_REINDEX_BATCH_SIZE ?? "", 10) || DEFAULT_BATCH_SIZE);
  }

  /**
   * Run a single sweep cycle. Detects stale chunks and reindexes them.
   * Returns a result summary for logging/monitoring.
   */
  async runOnce(): Promise<StaleReindexResult> {
    // Check if auto-reindex is disabled
    if ((process.env.DISABLE_AUTO_REINDEX ?? "").toLowerCase() === "true") {
      return {
        reindexed: 0,
        failed: 0,
        staleVersions: [],
        skipped: true,
        summary: "Auto-reindex disabled (DISABLE_AUTO_REINDEX=true)",
      };
    }

    const embedder: Embedder = getEmbedder();
    const targetVersion = embedder.getVersion();

    // Step 1: Check for stale chunk versions
    const allVersionStats = await getDocumentChunkEmbedderVersionStats(this.pool);
    const staleVersions = incompatibleChunkVersions(allVersionStats, targetVersion);

    if (staleVersions.length === 0) {
      return {
        reindexed: 0,
        failed: 0,
        staleVersions: [],
        skipped: true,
        summary: `No stale chunks \u2014 all ${allVersionStats.reduce((sum, s) => sum + s.count, 0)} chunks match ${targetVersion}`,
      };
    }

    const totalStale = staleVersions.reduce((sum, s) => sum + s.count, 0);
    console.error(
      `[stale-reindex] Detected ${totalStale} stale chunks across ${staleVersions.length} versions: ` +
      staleVersions.map((v) => `${v.embedder_version}(${v.count})`).join(", ")
    );

    // Step 2: Fetch documents needing reindex
    const candidates = await listDocumentsForReindex(this.pool, {
      targetVersion,
      staleOnly: true,
      limit: this.batchSize,
    });

    if (candidates.length === 0) {
      return {
        reindexed: 0,
        failed: 0,
        staleVersions,
        skipped: true,
        summary: `Stale versions detected but no documents found for reindex`,
      };
    }

    // Step 3: Reindex each document
    let reindexed = 0;
    let failed = 0;

    for (const document of candidates) {
      try {
        // Build new chunk inputs with current embedder
        const markdownChunks = chunkMarkdown(document.content);
        const chunkInputs = await Promise.all(
          markdownChunks.map(async (chunk, index) => ({
            chunk_index: index,
            content: chunk.content,
            embedding: await embedder.generateEmbedding(chunk.content),
            metadata: { ...(chunk.metadata ?? {}), embedder_version: targetVersion },
            token_count: chunk.token_count,
            char_start: chunk.char_start,
            char_end: chunk.char_end,
          }))
        );

        const result = await updateDocumentWithChunks(
          this.pool,
          document.id,
          { edit_reason: "auto stale reindex", updated_by: "stale-reindex-worker" },
          chunkInputs
        );

        // Re-extract and link entities for each chunk
        for (const chunkRow of result.chunks) {
          const entities = extractEntities(
            chunkRow.content,
            chunkRow.metadata as { people?: string[]; topics?: string[] } | undefined
          );
          if (entities.length > 0) {
            await extractAndLinkChunkEntities(this.pool, chunkRow.id, entities);
          }
        }

        reindexed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[stale-reindex] Failed to reindex document ${document.id} (${document.title}): ${message}`);
        failed++;
      }
    }

    return {
      reindexed,
      failed,
      staleVersions,
      skipped: false,
      summary: `Reindexed ${reindexed}/${candidates.length} documents (${failed} failed), ${totalStale} stale chunks across ${staleVersions.length} versions`,
    };
  }

  /**
   * Start the background worker loop. Runs until stop() is called.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.shutdownAbort = new AbortController();

    console.error(`[stale-reindex] Starting worker (interval=${this.intervalMs}ms, batchSize=${this.batchSize})`);

    while (this.running) {
      try {
        const result = await this.runOnce();
        if (result.skipped) {
          console.error(`[stale-reindex] Cycle skipped: ${result.summary}`);
        } else {
          console.error(`[stale-reindex] Cycle complete: ${result.summary}`);
        }
      } catch (err) {
        console.error(`[stale-reindex] Cycle error: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!this.running) break;

      // Sleep (abortable on stop)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.intervalMs);
        this.shutdownAbort.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    console.error("[stale-reindex] Worker stopped");
  }

  /**
   * Stop the background worker loop. Waits for current cycle to complete.
   */
  stop(): void {
    this.running = false;
    this.shutdownAbort.abort();
  }
}
