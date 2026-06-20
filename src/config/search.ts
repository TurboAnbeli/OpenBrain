/**
 * Centralized search pipeline configuration.
 * Eliminates duplication between routes.ts and mcp/server.ts.
 */

export const HYDE_MODEL =
  process.env.OPENBRAIN_HYDE_MODEL ?? "smollm2:1.7b";
export const HYDE_ENDPOINT =
  process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
export const HYDE_ENABLED =
  (process.env.OPENBRAIN_HYDE_ENABLED ?? "true").toLowerCase() !== "false";
export const HYDE_CONF_THRESHOLD = parseFloat(
  process.env.OPENBRAIN_HYDE_CONF_THRESHOLD ?? "0.66",
);

export const RERANK_MODEL =
  process.env.OPENBRAIN_RERANK_MODEL ??
  process.env.OPENBRAIN_HYDE_MODEL ??
  "smollm2:1.7b";
export const RERANK_ENDPOINT =
  process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
export const RERANK_ENABLED =
  (process.env.OPENBRAIN_RERANK_ENABLED ?? "true").toLowerCase() !== "false";
export const RERANK_TOPN = parseInt(
  process.env.OPENBRAIN_RERANK_TOPN ?? "6",
  10,
);

export const CROSS_ENCODER_ENABLED =
  (process.env.OPENBRAIN_CROSS_ENCODER_ENABLED ?? "false").toLowerCase() ===
  "true";
export const DEDUP_ENABLED =
  (process.env.OPENBRAIN_DEDUP_ENABLED ?? "true").toLowerCase() !== "false";
export const DEDUP_THRESHOLD = parseFloat(
  process.env.OPENBRAIN_DEDUP_THRESHOLD ?? "0.95",
);

export const SYNTHESIS_MODEL =
  process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "qwen3:1.7b";
export const SYNTHESIS_ENDPOINT =
  process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
