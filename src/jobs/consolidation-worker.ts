/**
 * Consolidation worker daemon.
 *
 * Long-running process that polls consolidation_jobs for queued work,
 * and auto-discovers eligible thought clusters when the queue is empty.
 *
 * Design constraints (from plan v2.3.2):
 *   - One LLM call per cycle
 *   - Single observation update per cycle
 *   - Hard cap 512 MB RSS — exit if exceeded
 *   - Poll interval: configurable via CONSOLIDATION_INTERVAL_MS (default 15 min)
 */

import type pg from "pg";

import { runConsolidationJob, type RunConsolidationJobOptions } from "./consolidation.js";
import {
  claimNextQueuedJob,
  findConsolidationCandidates,
  enqueueConsolidationJob,
  type ConsolidationCandidateGroup,
} from "../db/queries.js";
import type { Embedder } from "../embedder/types.js";

const DEFAULT_INTERVAL_MS = 900_000; // 15 minutes
const MEMORY_CAP_MB = 512;

export interface ConsolidationWorkerOptions {
  pool: pg.Pool;
  embedder: Embedder;
  synthesis: RunConsolidationJobOptions["synthesis"];
  intervalMs?: number;
}

/** Check RSS in MB via process.memoryUsage() */
function getRssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

/**
 * Main worker loop.  Runs forever until SIGTERM or memory cap.
 *
 * Each iteration:
 *   1. Claim next queued job → run it
 *   2. If no queued job, discover eligible candidates and enqueue one
 *   3. Sleep for the configured interval
 */
export async function runConsolidationWorkerLoop(
  options: ConsolidationWorkerOptions
): Promise<void> {
  const { pool, embedder, synthesis } = options;
  const intervalMs = options.intervalMs ?? (parseInt(process.env.CONSOLIDATION_INTERVAL_MS ?? "", 10) || DEFAULT_INTERVAL_MS);
  let shuttingDown = false;

  const onSignal = () => {
    console.error("[consolidation-worker] received shutdown signal, draining…");
    shuttingDown = true;
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  console.error(`[consolidation-worker] starting (interval=${intervalMs}ms, memory_cap=${MEMORY_CAP_MB}MB)`);

  while (!shuttingDown) {
    // ── Memory cap ────────────────────────────────────────────────
    const rss = getRssMb();
    if (rss > MEMORY_CAP_MB) {
      console.error(`[consolidation-worker] RSS ${Math.round(rss)}MB exceeds cap ${MEMORY_CAP_MB}MB — exiting`);
      process.exitCode = 1;
      return;
    }

    try {
      // ── Step 1: Claim and run a queued job ──────────────────────
      const job = await claimNextQueuedJob(pool);
      if (job) {
        console.error(`[consolidation-worker] claimed job ${job.id} (type=${job.job_type})`);
        try {
          const result = await runConsolidationJob(pool, job.id, { embedder, synthesis });
          if (result.observation) {
            console.error(`[consolidation-worker] job ${job.id} → observation ${result.observation.id}`);
          } else {
            console.error(`[consolidation-worker] job ${job.id} completed (no observation — ${result.job.status})`);
          }
        } catch (error) {
          console.error(`[consolidation-worker] job ${job.id} failed:`, error instanceof Error ? error.message : String(error));
        }
      } else {
        // ── Step 2: Auto-discover and enqueue ─────────────────────
        const candidates = await findConsolidationCandidates(pool);
        if (candidates.length > 0) {
          const group: ConsolidationCandidateGroup = candidates[0]!;
          console.error(
            `[consolidation-worker] auto-discovered ${group.thought_ids.length} unconsolidated thoughts (project=${group.project ?? "(none)"})`
          );
          await enqueueConsolidationJob(pool, {
            job_type: "observe_thoughts",
            bank_id: group.bank_id,
            input: {
              thought_ids: group.thought_ids,
              project: group.project ?? undefined,
            },
          });
          console.error("[consolidation-worker] enqueued auto-discovered consolidation job");
        } else {
          console.error("[consolidation-worker] no queued jobs and no candidates — idle");
        }
      }
    } catch (error) {
      console.error("[consolidation-worker] cycle error:", error instanceof Error ? error.message : String(error));
    }

    // ── Sleep ────────────────────────────────────────────────────
    await sleep(intervalMs);
  }

  console.error("[consolidation-worker] shut down gracefully");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}