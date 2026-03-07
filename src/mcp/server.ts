/**
 * MCP Server for Open Brain.
 * Exposes four tools: search_thoughts, list_thoughts, capture_thought, thought_stats.
 *
 * Uses the official @modelcontextprotocol/sdk TypeScript SDK.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { getPool } from "../db/connection.js";
import {
  insertThought,
  searchThoughts,
  listThoughts,
  getThoughtStats,
  type ListFilters,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";

export function createMcpServer(): Server {
  const server = new Server(
    { name: "open-brain", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const embedder = getEmbedder();
  const pool = getPool();

  // ─── List Tools ──────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_thoughts",
        description:
          "Search your brain for thoughts semantically related to a query. Returns results ranked by similarity score.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "Natural language search query",
            },
            limit: {
              type: "integer",
              description: "Maximum results to return (default: 10)",
              default: 10,
            },
            threshold: {
              type: "number",
              description: "Minimum similarity score 0-1 (default: 0.5)",
              default: 0.5,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_thoughts",
        description:
          "List thoughts filtered by type, topic, person mentioned, or time range.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              description:
                "Filter by thought type: observation, task, idea, reference, person_note, decision, meeting",
            },
            topic: {
              type: "string",
              description: "Filter by topic tag",
            },
            person: {
              type: "string",
              description: "Filter by person mentioned",
            },
            days: {
              type: "integer",
              description: "Only return thoughts from the last N days",
            },
          },
        },
      },
      {
        name: "capture_thought",
        description:
          "Save a new thought to your brain. Automatically generates embedding and extracts metadata (type, topics, people, action items).",
        inputSchema: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "The thought to capture (raw text)",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "thought_stats",
        description:
          "Get statistics about your brain: total thoughts, type distribution, top topics, and top people mentioned.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ],
  }));

  // ─── Call Tool ───────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        // ── search_thoughts ──
        case "search_thoughts": {
          const query = args?.query as string;
          const limit = (args?.limit as number) ?? 10;
          const threshold = (args?.threshold as number) ?? 0.5;

          const queryEmbedding = await embedder.generateEmbedding(query);
          const results = await searchThoughts(pool, queryEmbedding, limit, threshold);

          const formatted = results.map((r) => ({
            content: r.content,
            metadata: r.metadata,
            similarity: Math.round(r.similarity * 1000) / 1000,
            created_at: r.created_at.toISOString(),
          }));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
              },
            ],
          };
        }

        // ── list_thoughts ──
        case "list_thoughts": {
          const filters: ListFilters = {
            type: args?.type as string | undefined,
            topic: args?.topic as string | undefined,
            person: args?.person as string | undefined,
            days: args?.days as number | undefined,
          };

          const results = await listThoughts(pool, filters);

          const formatted = results.map((r) => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            created_at: r.created_at.toISOString(),
          }));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
              },
            ],
          };
        }

        // ── capture_thought ──
        case "capture_thought": {
          const content = args?.content as string;

          // Generate embedding and extract metadata in parallel
          const [embedding, metadata] = await Promise.all([
            embedder.generateEmbedding(content),
            embedder.extractMetadata(content),
          ]);

          const fullMetadata = { ...metadata, source: "mcp" };
          const result = await insertThought(pool, content, embedding, fullMetadata);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "captured",
                    id: result.id,
                    type: metadata.type,
                    topics: metadata.topics,
                    people: metadata.people,
                    action_items: metadata.action_items,
                    captured_at: result.created_at.toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── thought_stats ──
        case "thought_stats": {
          const stats = await getThoughtStats(pool);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(stats, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mcp] Tool "${name}" failed:`, message);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server on stdio transport.
 * Used when running as a standalone MCP process (e.g., `npx open-brain-mcp`).
 */
export async function startMcpStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Server running on stdio transport");
}
