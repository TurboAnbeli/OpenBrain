/**
 * Consolidation worker service.
 *
 * Long-running timer-based process that:
 *   1. Claims the next queued consolidation job (SELECT … FOR UPDATE SKIP LOCKED)
 *   2. If no queued job, auto-discovers eligible unconsolidated thoughts and enqueues one
 *   3. Runs the job: calls an LLM to synthesize, writes to consolidated_observations
 *      and memory_links, logs to consolidation_jobs
 *
 * Design constraints (plan v2.3.2):
 *   - One LLM call per cycle
 *   - Single observation per cycle
 *   - Must NOT re-consolidate thoughts that are archived or have supersedes links
 *   - LLM endpoint configurable via OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT
 *   - LLM model configurable via OPENBRAIN_LLM_CONSOLIDATION_MODEL
 *   - Hard cap 512 MB RSS — exit if exceeded
 *   - Poll interval: configurable via CONSOLIDATION_INTERVAL_MS (default 15 min)
 */

import type pg from "pg";

import { runConsolidationJob, type RunConsolidationJobOptions } from "../jobs/consolidation.js";
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
 * Resolve the LLM endpoint for consolidation synthesis.
 * Priority: OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT > OLLAMA_ENDPOINT > default.
 */
function resolveSynthesisEndpoint(): string {
  return (
    process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT ??
    process.env.OLLAMA_ENDPOINT ??
    "http://127.0.0.1:11434"
  );
}

/**
 * Resolve the LLM model for consolidation synthesis.
 * Priority: OPENBRAIN_LLM_CONSOLIDATION_MODEL > OPENBRAIN_SYNTHESIS_MODEL > default.
 */
function resolveSynthesisModel(): string {
  return (
    process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL ??
    process.env.OPENBRAIN_SYNTHESIS_MODEL ??
    "gemma-4-E4B-it"
  );
}

/**
 * Run a single consolidation cycle (one job or one auto-discovery).
 * Used by the --once CLI mode for systemd timer invocation.
 */
export async function runSingleConsolidationCycle(
  options: ConsolidationWorkerOptions
): Promise<void> {
  const { pool, embedder } = options;
  const synthesisEndpoint = resolveSynthesisEndpoint();
  const synthesisModel = resolveSynthesisModel();
  const synthesis: RunConsolidationJobOptions["synthesis"] = {
    ...options.synthesis,
    endpoint: options.synthesis.endpoint || synthesisEndpoint,
    model: options.synthesis.model || synthesisModel,
  };

  // ── Memory cap ────────────────────────────────────────────────
  const rss = getRssMb();
  if (rss > MEMORY_CAP_MB) {
    throw new Error(`RSS ${Math.round(rss)}MB exceeds cap ${MEMORY_CAP_MB}MB — aborting cycle`);
  }

  // ── Step 1: Claim and run a queued job ──────────────────────
  const job = await claimNextQueuedJob(pool);
  if (job) {
    console.error(`[consolidation-worker] claimed job ${job.id} (type=${job.job_type})`);
    const result = await runConsolidationJob(pool, job, { embedder, synthesis });
    if (result.observation) {
      console.error(`[consolidation-worker] job ${job.id} → observation ${result.observation.id}`);
    } else {
      console.error(`[consolidation-worker] job ${job.id} completed (no observation — ${result.job.status})`);
    }
    return;
  }

  // ── Step 2: Auto-discover and enqueue ─────────────────────
  const candidates = await findConsolidationCandidates(pool);
  if (candidates && candidates.length > 0) {
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

/**
 * Main worker loop.  Runs forever until SIGTERM or memory cap.
 *
 * Each iteration:
 *   1. Claim next queued job → run it
 *   2. If no queued job, discover eligible candidates and enqueue one
 *   3. Sleep for the configured interval (abortable on SIGTERM)
 */
export async function runConsolidationWorkerLoop(
  options: ConsolidationWorkerOptions
): Promise<void> {
  const { pool, embedder } = options;
  const synthesisEndpoint = resolveSynthesisEndpoint();
  const synthesisModel = resolveSynthesisModel();
  const synthesis: RunConsolidationJobOptions["synthesis"] = {
    ...options.synthesis,
    endpoint: options.synthesis.endpoint || synthesisEndpoint,
    model: options.synthesis.model || synthesisModel,
  };
  const intervalMs = options.intervalMs ?? (parseInt(process.env.CONSOLIDATION_INTERVAL_MS ?? "", 10) || DEFAULT_INTERVAL_MS);
  let shuttingDown = false;

  /** Abort controller for cancelling in-flight sleep on shutdown. */
  let shutdownAbort = new AbortController();

  const onSignal = () => {
    console.error("[consolidation-worker] received shutdown signal, draining…");
    shuttingDown = true;
    shutdownAbort.abort();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  console.error(`[consolidation-worker] starting (interval=${intervalMs}ms, endpoint=${synthesis.endpoint}, model=${synthesis.model}, memory_cap=${MEMORY_CAP_MB}MB)`);

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
          const result = await runConsolidationJob(pool, job, { embedder, synthesis });
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
        if (candidates && candidates.length > 0) {
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

    if (shuttingDown) break;

    // ── Sleep (abortable — SIGTERM wakes immediately) ─────────────
    shutdownAbort = new AbortController();
    await sleep(intervalMs, shutdownAbort.signal);
  }

  console.error("[consolidation-worker] shut down gracefully");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(timer); resolve(); };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
