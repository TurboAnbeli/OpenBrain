/**
 * CLI entry point for the consolidation worker daemon.
 *
 * Usage: tsx src/workers/consolidation-worker-cli.ts [--once]
 *
 * Flags:
 *   --once   Run a single consolidation cycle then exit (for systemd timer use).
 *
 * Environment:
 *   CONSOLIDATION_INTERVAL_MS              — poll interval in ms (default 900000 = 15 min)
 *   OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT   — LLM endpoint for consolidation (overrides OLLAMA_ENDPOINT)
 *   OPENBRAIN_LLM_CONSOLIDATION_MODEL      — LLM model for consolidation (default gemma-4-E4B-it)
 *   OPENBRAIN_SYNTHESIS_MODEL              — Legacy model env var (fallback if above not set)
 *   OLLAMA_ENDPOINT                        — Ollama endpoint (default http://127.0.0.1:11434)
 *   DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, CIPHER_KEY_PATH — DB + encryption
 */

import { closePool, getPool, initializeDatabase } from "../db/connection.js";
import { getEmbedder } from "../embedder/index.js";
import { runConsolidationWorkerLoop, runSingleConsolidationCycle } from "./consolidation-worker.js";

const args = process.argv.slice(2);
const singleCycle = args.includes("--once");

async function main(): Promise<void> {
  console.error(`[consolidation-worker-cli] initializing… (mode=${singleCycle ? "single-cycle" : "daemon"})`);

  await initializeDatabase();

  const pool = getPool();
  const embedder = getEmbedder();
  const synthesisEndpoint =
    process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT ??
    process.env.OLLAMA_ENDPOINT ??
    "http://127.0.0.1:11434";
  const synthesisModel =
    process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL ??
    process.env.OPENBRAIN_SYNTHESIS_MODEL ??
    "gemma-4-E4B-it";

  const opts = {
    pool,
    embedder,
    synthesis: {
      endpoint: synthesisEndpoint,
      model: synthesisModel,
    },
  };

  if (singleCycle) {
    await runSingleConsolidationCycle(opts);
  } else {
    await runConsolidationWorkerLoop(opts);
  }
}

main()
  .catch((error) => {
    console.error("[consolidation-worker-cli] fatal:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
