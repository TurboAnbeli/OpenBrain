/**
 * CLI entry point for the consolidation worker daemon.
 *
 * Usage: tsx src/workers/consolidation-worker-cli.ts
 *
 * Environment:
 *   CONSOLIDATION_INTERVAL_MS              — poll interval in ms (default 900000 = 15 min)
 *   OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT   — LLM endpoint for consolidation (overrides OLLAMA_ENDPOINT)
 *   OPENBRAIN_SYNTHESIS_MODEL               — LLM model for synthesis (default qwen3:1.7b)
 *   OLLAMA_ENDPOINT                         — Ollama endpoint (default http://127.0.0.1:11434)
 *   DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, CIPHER_KEY_PATH — DB + encryption
 */

import { closePool, getPool, initializeDatabase } from "../db/connection.js";
import { getEmbedder } from "../embedder/index.js";
import { runConsolidationWorkerLoop } from "./consolidation-worker.js";

async function main(): Promise<void> {
  console.error("[consolidation-worker-cli] initializing…");

  await initializeDatabase();

  const pool = getPool();
  const embedder = getEmbedder();
  const synthesisEndpoint =
    process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT ??
    process.env.OLLAMA_ENDPOINT ??
    "http://127.0.0.1:11434";
  const synthesisModel = process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "qwen3:1.7b";

  await runConsolidationWorkerLoop({
    pool,
    embedder,
    synthesis: {
      endpoint: synthesisEndpoint,
      model: synthesisModel,
    },
  });
}

main()
  .catch((error) => {
    console.error("[consolidation-worker-cli] fatal:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });