/**
 * Open Brain — stdio MCP entry point.
 *
 * Used by in-VM MCP consumers (Hermes, Claude-Code-on-VM, anything else
 * co-installed with the openbrain backend) that should NOT traverse the
 * public Funnel + Caddy + OAuth perimeter. Process boundary is the trust
 * boundary; no key, no JWT.
 *
 * Stdout is reserved for the JSON-RPC stream. All log output is routed
 * to stderr — db/connection.ts and embedder/*.ts already use console.error,
 * so importing them here is safe.
 *
 * Cold-start cost is roughly one pg connection (~1s); the Ollama embedder
 * is lazy and only fires on the first tool call that needs it.
 */

import { initializeDatabase, closePool } from "./db/connection.js";
import { startMcpStdio } from "./mcp/server.js";

async function main(): Promise<void> {
  await initializeDatabase();
  await startMcpStdio();
}

process.on("SIGINT", async () => {
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closePool();
  process.exit(0);
});

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
