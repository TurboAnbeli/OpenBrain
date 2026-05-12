/**
 * Open Brain — Entry Point
 *
 * Starts both:
 * 1. Hono REST API server (port 8000)
 * 2. MCP HTTP server via raw Node.js HTTP (port 8080)
 *
 * The REST API provides direct HTTP access for testing, Slack webhooks,
 * and any non-MCP integrations.
 *
 * The MCP server is the primary interface for AI tools (Claude, ChatGPT, etc).
 * Two transport protocols are exposed concurrently:
 *   - /mcp               — Streamable HTTP (MCP 2025-03, preferred)
 *   - /sse + /messages   — legacy SSE transport (kept for backwards compat)
 * Uses raw Node.js HTTP because the MCP SDK transports require Node ServerResponse.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";

import { initializeDatabase, closePool } from "./db/connection.js";
import { createApi } from "./api/routes.js";
import { createMcpServer } from "./mcp/server.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║           Open Brain v1.0.0              ║");
  console.log("║    Personal Semantic Memory System       ║");
  console.log("╚══════════════════════════════════════════╝");

  // Initialize database connection pool
  await initializeDatabase();

  // ── REST API Server (Hono) ──────────────────────────────────────

  const api = createApi();
  const apiPort = parseInt(process.env.API_PORT ?? "8000", 10);

  serve({ fetch: api.fetch, port: apiPort }, () => {
    console.log(`[api] REST API listening on http://0.0.0.0:${apiPort}`);
    console.log(`[api]   POST /memories         — capture thought`);
    console.log(`[api]   POST /memories/batch    — batch capture`);
    console.log(`[api]   POST /memories/search   — semantic search`);
    console.log(`[api]   POST /memories/list     — filtered listing`);
    console.log(`[api]   PUT  /memories/:id      — update thought`);
    console.log(`[api]   DELETE /memories/:id     — delete thought`);
    console.log(`[api]   GET  /stats             — brain statistics`);
    console.log(`[api]   GET  /health            — health check`);
  });

  // ── MCP Server (HTTP, both transports) ─────────────────────────

  const mcpPort = parseInt(process.env.MCP_PORT ?? "8080", 10);
  const mcpAccessKey = process.env.MCP_ACCESS_KEY ?? "";

  // Track active transports for cleanup, separated by protocol
  const sseTransports = new Map<string, SSEServerTransport>();
  const httpTransports = new Map<string, StreamableHTTPServerTransport>();

  const mcpHttpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-brain-key, mcp-session-id"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${mcpPort}`);

    // Health check — no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", service: "open-brain-mcp" }));
      return;
    }

    // ─── Streamable HTTP transport (MCP 2025-03, preferred) ────────────────
    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? httpTransports.get(sessionId) : undefined;

      if (!transport) {
        // No existing session — must be POST to open one (an initialize request)
        if (req.method !== "POST") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "No session. Open one with POST /mcp first.",
            })
          );
          return;
        }

        // Auth check on new-session creation only
        const key =
          (req.headers["x-brain-key"] as string | undefined) ??
          url.searchParams.get("key");
        if (mcpAccessKey && key !== mcpAccessKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            httpTransports.set(sid, transport!);
            console.log(`[mcp] Streamable HTTP session ${sid} connected`);
          },
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) {
            httpTransports.delete(sid);
            console.log(`[mcp] Streamable HTTP session ${sid} closed`);
          }
        };

        const server = createMcpServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res);
      return;
    }

    // ─── Legacy SSE transport (kept for backwards compat) ──────────────────
    // SSE endpoint — AI clients connect here
    // Auth is checked here; /messages skips the key check because
    // having a valid sessionId proves the client already authenticated.
    if (url.pathname === "/sse" && req.method === "GET") {
      const key =
        (req.headers["x-brain-key"] as string | undefined) ??
        url.searchParams.get("key");
      if (mcpAccessKey && key !== mcpAccessKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      sseTransports.set(sessionId, transport);

      res.on("close", () => {
        sseTransports.delete(sessionId);
        console.log(`[mcp] SSE session ${sessionId} closed`);
      });

      const server = createMcpServer();
      await server.connect(transport);
      console.log(`[mcp] SSE session ${sessionId} connected`);
      return;
    }

    // Messages endpoint — receives JSON-RPC calls from legacy SSE clients
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? sseTransports.get(sessionId) : undefined;

      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "No active session. Connect to /sse first." })
        );
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    // 404 fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  mcpHttpServer.listen(mcpPort, "0.0.0.0", () => {
    console.log(`[mcp] MCP HTTP server listening on http://0.0.0.0:${mcpPort}`);
    console.log(`[mcp]   POST /mcp                — Streamable HTTP (preferred)`);
    console.log(`[mcp]   GET  /mcp                — Streamable HTTP SSE stream`);
    console.log(`[mcp]   DELETE /mcp              — terminate Streamable HTTP session`);
    console.log(`[mcp]   GET  /sse                — legacy SSE connection`);
    console.log(`[mcp]   POST /messages           — legacy SSE JSON-RPC`);
    console.log(`[mcp]   GET  /health             — health check`);
    console.log("");
    console.log("[mcp] Connect AI clients to:");
    console.log(`[mcp]   http://<host>:${mcpPort}/mcp?key=<MCP_ACCESS_KEY>  (preferred)`);
    console.log(`[mcp]   http://<host>:${mcpPort}/sse?key=<MCP_ACCESS_KEY>  (legacy)`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[shutdown] Received SIGINT, closing...");
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[shutdown] Received SIGTERM, closing...");
  await closePool();
  process.exit(0);
});

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
