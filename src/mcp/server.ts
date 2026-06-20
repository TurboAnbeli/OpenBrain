/**
 * MCP Server for Open Brain.
 * Exposes seven tools: search_thoughts, list_thoughts, capture_thought, thought_stats,
 * update_thought, delete_thought, capture_thoughts (batch).
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
  bm25SearchThoughts,
  listThoughts,
  getThoughtStats,
  updateThought,
  deleteThought,
  batchInsertThoughts,
  findNearDuplicate,
  bumpProofCount,
  getThoughtsByIds,
  archiveThoughts,
  searchThoughtsByEntity,
  insertConsolidatedObservation,
  type ListFilters,
  type BatchThoughtInput,
  type SearchResult,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";
import {
  hasSpecificityMarker,
  applyRecencyBoost,
  overfetchLimit,
} from "../api/recency_boost.js";
import {
  shouldExpand,
  generateHydeAnswer,
  reciprocalRankFusion,
} from "../api/query_expansion.js";
import { rerankResults, shouldRerank, crossEncoderRerank } from "../api/rerank.js";
import { applyProofCountBoost } from "../api/proof_count_boost.js";
import { synthesizeObservation } from "../api/synthesize.js";
import {
  shouldUseEntityRanking,
  extractQueryEntityNames,
  entityWeightedRRF,
} from "../api/entity_ranking.js";
import { extractEntities } from "../api/entity_extraction.js";

// Search pipeline configuration — centralized in config/search.ts
import {
  HYDE_MODEL, HYDE_ENDPOINT, HYDE_ENABLED,
  RERANK_MODEL, RERANK_ENDPOINT, RERANK_ENABLED, RERANK_TOPN,
  CROSS_ENCODER_ENABLED, DEDUP_ENABLED, DEDUP_THRESHOLD,
  SYNTHESIS_MODEL, SYNTHESIS_ENDPOINT,
} from "../config/search.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Audit Logging ─────────────────────────────────────────────────────────
const CONTENT_TOOLS = new Set(["capture_thought", "capture_thoughts", "update_thought"]);

function sanitizeArgs(tool: string, args: Record<string, unknown>): string {
  const safe = { ...args };
  // Redact full content on write tools
  if (CONTENT_TOOLS.has(tool) && "content" in safe) {
    (safe as Record<string, unknown>).content_length = String(safe.content).length;
    delete safe.content;
  }
  // For batch capture, redact each thought's content
  if (tool === "capture_thoughts" && Array.isArray(safe.thoughts)) {
    safe.thoughts = (safe.thoughts as Array<{ content: string }>).map((t) => ({
      content_length: t.content?.length ?? 0,
    }));
  }
  return JSON.stringify(safe).slice(0, 500);
}

async function auditLog(
  pool: ReturnType<typeof getPool>,
  consumerId: string,
  transport: string,
  tool: string,
  argsSummary: string,
  success: boolean,
  errorMsg: string | null,
  durationMs: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (consumer_id, transport, tool, args_summary, success, error_msg, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [consumerId, transport, tool, argsSummary, success, errorMsg?.slice(0, 200) ?? null, durationMs]
    );
  } catch (e) {
    console.error("[audit] log write failed:", e);
  }
}

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
          "Search your brain for thoughts semantically related to a query. Returns results ranked by similarity score. Supports project scoping and metadata filters.",
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
            project: {
              type: "string",
              description: "Scope search to a specific project",
            },
            type: {
              type: "string",
              description:
                "Filter by thought type: observation, task, idea, reference, person_note, decision, meeting, architecture, pattern, postmortem, requirement, bug, convention",
            },
            topic: {
              type: "string",
              description: "Filter by topic tag",
            },
            include_archived: {
              type: "boolean",
              description: "Include archived thoughts (default: false)",
              default: false,
            },
            created_by: {
              type: "string",
              description: "Filter results to thoughts created by a specific user",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_thoughts",
        description:
          "List thoughts filtered by type, topic, person mentioned, project, or time range.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              description:
                "Filter by thought type: observation, task, idea, reference, person_note, decision, meeting, architecture, pattern, postmortem, requirement, bug, convention",
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
            project: {
              type: "string",
              description: "Scope to a specific project",
            },
            include_archived: {
              type: "boolean",
              description: "Include archived thoughts (default: false)",
              default: false,
            },
            created_by: {
              type: "string",
              description: "Filter results to thoughts created by a specific user",
            },
          },
        },
      },
      {
        name: "capture_thought",
        description:
          "Save a new thought to your brain. Automatically generates embedding and extracts metadata (type, topics, people, action items). Supports project scoping and provenance tracking.",
        inputSchema: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "The thought to capture (raw text)",
            },
            project: {
              type: "string",
              description: "Scope this thought to a project/workspace",
            },
            source: {
              type: "string",
              description: "Provenance tracking — where this thought came from (default: 'mcp')",
            },
            supersedes: {
              type: "string",
              description: "UUID of a prior thought this one replaces",
            },
            created_by: {
              type: "string",
              description: "User who created this thought (optional, for multi-developer provenance)",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "thought_stats",
        description:
          "Get statistics about your brain: total thoughts, type distribution, top topics, and top people mentioned. Optionally scoped to a project or user.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project: {
              type: "string",
              description: "Scope stats to a specific project",
            },
            created_by: {
              type: "string",
              description: "Scope stats to a specific user",
            },
          },
        },
      },
      {
        name: "update_thought",
        description:
          "Update an existing thought's content. Re-generates embedding and re-extracts metadata automatically.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "UUID of the thought to update",
            },
            content: {
              type: "string",
              description: "New content for the thought",
            },
          },
          required: ["id", "content"],
        },
      },
      {
        name: "delete_thought",
        description:
          "Permanently delete a thought by ID. Deleted thoughts no longer appear in search or list results.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: {
              type: "string",
              description: "UUID of the thought to delete",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "capture_thoughts",
        description:
          "Batch capture multiple thoughts in one call. Each thought gets independent embedding and metadata extraction. All share the same project and source.",
        inputSchema: {
          type: "object" as const,
          properties: {
            thoughts: {
              type: "array",
              description: "Array of thoughts to capture",
              items: {
                type: "object",
                properties: {
                  content: {
                    type: "string",
                    description: "The thought content (raw text)",
                  },
                },
                required: ["content"],
              },
            },
            project: {
              type: "string",
              description: "Scope all thoughts to a project/workspace",
            },
            source: {
              type: "string",
              description: "Provenance tracking (default: 'mcp')",
            },
            created_by: {
              type: "string",
              description: "User who created these thoughts (optional, for multi-developer provenance)",
            },
          },
          required: ["thoughts"],
        },
      },
      {
        name: "consolidate_observations",
        description:
          "Synthesize multiple related thoughts into a single consolidated observation using a local LLM. The source thoughts are archived after consolidation. Returns the new observation's ID.",
        inputSchema: {
          type: "object" as const,
          properties: {
            thought_ids: {
              type: "array",
              description: "UUIDs of the thoughts to consolidate (minimum 2)",
              items: { type: "string" },
              minItems: 2,
            },
            project: {
              type: "string",
              description: "Scope the consolidated observation to a project (optional)",
            },
            created_by: {
              type: "string",
              description: "User attribution for the consolidated observation (optional)",
            },
          },
          required: ["thought_ids"],
        },
      },
    ],
  }));

  // ─── Call Tool ───────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const consumerId = process.env.OPENBRAIN_CONSUMER_ID ?? "unknown";
    const transport = process.env.OPENBRAIN_TRANSPORT ?? "stdio";
    const t0 = Date.now();

    try {
      switch (name) {
        // ── search_thoughts ──
        case "search_thoughts": {
          const query = args?.query as string;
          const limit = (args?.limit as number) ?? 10;
          const threshold = (args?.threshold as number) ?? 0.5;
          const project = args?.project as string | undefined;
          const type = args?.type as string | undefined;
          const topic = args?.topic as string | undefined;
          const include_archived = (args?.include_archived as boolean) ?? false;
          const created_by = args?.created_by as string | undefined;

          // Build JSONB filter from type/topic
          const filter: Record<string, unknown> = {};
          if (type) filter.type = type;
          if (topic) filter.topics = [topic];

          const boost = hasSpecificityMarker(query);
          const rerank = !boost && RERANK_ENABLED && shouldRerank(query);
          const hyde = !boost && HYDE_ENABLED && shouldExpand(query);
          const fetchLimit = overfetchLimit(limit, boost || hyde || rerank);
          const useEntity = shouldUseEntityRanking(query);
          const entityNames = useEntity ? extractQueryEntityNames(query) : [];

          const [queryEmbedding, bm25Results, entityResultsRaw] = await Promise.all([
            embedder.generateEmbedding(query),
            bm25SearchThoughts(pool, query, fetchLimit, filter, project, include_archived, created_by),
            useEntity
              ? searchThoughtsByEntity(pool, entityNames, fetchLimit, project, include_archived, created_by)
              : Promise.resolve([]),
          ]);
          const rawResults = await searchThoughts(
            pool, queryEmbedding, fetchLimit, threshold, filter, project, include_archived, created_by
          );
          let denseFused = rawResults;
          let hydeAnswer: string | null = null;
          if (hyde) {
            hydeAnswer = await generateHydeAnswer(query, {
              endpoint: HYDE_ENDPOINT, model: HYDE_MODEL,
            });
            if (hydeAnswer) {
              const hydeEmbedding = await embedder.generateEmbedding(hydeAnswer);
              const hydeResults = await searchThoughts(
                pool, hydeEmbedding, fetchLimit, threshold, filter, project, include_archived, created_by
              );
              denseFused = reciprocalRankFusion([rawResults, hydeResults], 60, fetchLimit);
            }
          } else if (boost) {
            denseFused = applyRecencyBoost(rawResults);
          }
          const fusedLimit = rerank ? Math.max(limit * 2, RERANK_TOPN) : limit;

          let fusedResults: SearchResult[];
          if (useEntity && entityResultsRaw.length > 0) {
            fusedResults = applyProofCountBoost(
              entityWeightedRRF(
                entityResultsRaw as any,
                [denseFused as any, bm25Results as any],
                fusedLimit
              ) as any
            );
          } else {
            fusedResults = applyProofCountBoost(
              reciprocalRankFusion([denseFused, bm25Results], 60, fusedLimit)
            );
          }

          // Cross-encoder is opt-in (see routes.ts CROSS_ENCODER_ENABLED note).
          // The LLM reranker is the default for negation/complex queries; the
          // cross-encoder only runs as a companion when explicitly enabled and
          // never short-circuits the LLM fallback.
          const rerankOutput: { results: typeof fusedResults | null; fired: boolean } = {
            results: null,
            fired: false,
          };
          let crossEncoderFired = false;
          if (rerank) {
            if (CROSS_ENCODER_ENABLED) {
              const ceOutput = await crossEncoderRerank(query, fusedResults);
              if (ceOutput.fired && ceOutput.results !== null) {
                rerankOutput.results = ceOutput.results;
                rerankOutput.fired = true;
                crossEncoderFired = true;
              }
            }
            const llmOutput = await rerankResults(query, fusedResults, {
              endpoint: RERANK_ENDPOINT,
              model: RERANK_MODEL,
              topN: RERANK_TOPN,
            });
            if (llmOutput.fired && llmOutput.results !== null) {
              rerankOutput.results = llmOutput.results;
              rerankOutput.fired = true;
            }
          }
          const rerankedResults = rerankOutput.results;
          const results = (rerankedResults ?? fusedResults).slice(0, limit);

          const formatted = results.map((r) => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            similarity: Math.round(r.similarity * 1000) / 1000,
            created_at: r.created_at.toISOString(),
          }));

          const durSearch = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durSearch);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  count: formatted.length,
                  recency_boosted: boost,
                  hyde_expanded: hyde && hydeAnswer !== null,
                  bm25_fused: true,
                  entity_ranked: useEntity,
                  reranked: rerankedResults !== null,
                  cross_encoder_reranked: crossEncoderFired,
                  reranker_fired: rerankOutput.fired,
                  results: formatted,
                }, null, 2),
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
            project: args?.project as string | undefined,
            created_by: args?.created_by as string | undefined,
            include_archived: (args?.include_archived as boolean) ?? false,
          };

          const results = await listThoughts(pool, filters);

          const formatted = results.map((r) => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            created_at: r.created_at.toISOString(),
          }));

          const durList = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durList);
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
          const project = args?.project as string | undefined;
          const source = (args?.source as string) ?? "mcp";
          const supersedes = args?.supersedes as string | undefined;
          const created_by = args?.created_by as string | undefined;

          if (supersedes && !UUID_RE.test(supersedes)) {
            return {
              content: [{ type: "text" as const, text: "Error: supersedes must be a valid UUID" }],
              isError: true,
            };
          }

          // Generate embedding first; dedup check happens before extractMetadata
          // so we skip the metadata roundtrip on near-duplicates.
          const embedding = await embedder.generateEmbedding(content);

          // Dedup gate: skip when supersedes is set (explicit replacement always inserts).
          if (DEDUP_ENABLED && !supersedes) {
            const dup = await findNearDuplicate(pool, embedding, project, created_by, DEDUP_THRESHOLD);
            if (dup) {
              const bumped = await bumpProofCount(pool, dup.id);
              const durCap = Date.now() - t0;
              await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durCap);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        status: "deduplicated",
                        id: bumped.id,
                        proof_count: bumped.proof_count,
                        captured_at: bumped.created_at.toISOString(),
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
          }

          const metadata = await embedder.extractMetadata(content);
          const fullMetadata = { ...metadata, source, embedder_version: embedder.getVersion() };
          const result = await insertThought(pool, content, embedding, fullMetadata, project, supersedes, created_by);

          // Link extracted entities (fire-and-forget)
          try {
            const entities = extractEntities(content, metadata);
            if (entities.length > 0) {
              const { extractAndLinkEntities } = await import("../db/queries.js");
              await extractAndLinkEntities(pool, result.id, entities);
            }
          } catch (e) {
            console.error("[mcp] Entity linking failed (non-fatal):", e);
          }

          const durCap = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durCap);
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
                    proof_count: result.proof_count,
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
          const project = args?.project as string | undefined;
          const created_by = args?.created_by as string | undefined;
          const stats = await getThoughtStats(pool, project, created_by);

          const durStats = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durStats);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(stats, null, 2),
              },
            ],
          };
        }

        // ── update_thought ──
        case "update_thought": {
          const id = args?.id as string;
          const content = args?.content as string;

          if (!UUID_RE.test(id)) {
            return {
              content: [{ type: "text" as const, text: "Error: id must be a valid UUID" }],
              isError: true,
            };
          }

          // Re-generate embedding and re-extract metadata
          const [embedding, metadata] = await Promise.all([
            embedder.generateEmbedding(content),
            embedder.extractMetadata(content),
          ]);

          const result = await updateThought(pool, id, content, embedding, metadata);

          const durUpd = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durUpd);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "updated",
                    id: result.id,
                    type: metadata.type,
                    topics: metadata.topics,
                    updated_at: result.created_at.toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // ── delete_thought ──
        case "delete_thought": {
          const id = args?.id as string;

          if (!UUID_RE.test(id)) {
            return {
              content: [{ type: "text" as const, text: "Error: id must be a valid UUID" }],
              isError: true,
            };
          }

          const result = await deleteThought(pool, id);

          const durDel = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durDel);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        // ── capture_thoughts (batch) ──
        case "capture_thoughts": {
          const thoughtInputs = args?.thoughts as Array<{ content: string }>;
          const project = args?.project as string | undefined;
          const source = (args?.source as string) ?? "mcp";
          const created_by = args?.created_by as string | undefined;

          // Process each thought: embed + extract metadata
          const embedder_version = embedder.getVersion();
          const processed: BatchThoughtInput[] = await Promise.all(
            thoughtInputs.map(async (t) => {
              const [embedding, metadata] = await Promise.all([
                embedder.generateEmbedding(t.content),
                embedder.extractMetadata(t.content),
              ]);
              return {
                content: t.content,
                embedding,
                metadata: { ...metadata, source, embedder_version },
                project,
                created_by,
              };
            })
          );

          const results = await batchInsertThoughts(pool, processed);

          const formatted = results.map((r) => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            captured_at: r.created_at.toISOString(),
          }));

          const durBatch = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durBatch);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ count: formatted.length, results: formatted }, null, 2),
              },
            ],
          };
        }

        // ── consolidate_observations ──
        case "consolidate_observations": {
          const thoughtIds = args?.thought_ids as string[];
          const project = args?.project as string | undefined;
          const created_by = args?.created_by as string | undefined;

          if (!Array.isArray(thoughtIds) || thoughtIds.length < 2) {
            return {
              content: [{ type: "text" as const, text: "Error: thought_ids must be an array of at least 2 UUIDs" }],
              isError: true,
            };
          }
          for (const id of thoughtIds) {
            if (!UUID_RE.test(id)) {
              return {
                content: [{ type: "text" as const, text: `Error: invalid UUID: ${id}` }],
                isError: true,
              };
            }
          }

          const sources = await getThoughtsByIds(pool, thoughtIds);
          if (sources.length < 2) {
            return {
              content: [{ type: "text" as const, text: "Error: at least 2 source thoughts must exist and not be archived" }],
              isError: true,
            };
          }

          const synthesis = await synthesizeObservation(
            sources.map((s) => s.content),
            { endpoint: SYNTHESIS_ENDPOINT, model: SYNTHESIS_MODEL }
          );
          if (!synthesis) {
            return {
              content: [{ type: "text" as const, text: "Error: synthesis quality gate failed — try again or check the synthesis model" }],
              isError: true,
            };
          }

          const [obsEmbedding, obsMetadata] = await Promise.all([
            embedder.generateEmbedding(synthesis),
            embedder.extractMetadata(synthesis),
          ]);

          const obsResult = await insertConsolidatedObservation(pool, {
            content: synthesis,
            embedding: obsEmbedding,
            proof_count: sources.length,
            source_memory_ids: sources.map((s) => s.id),
            source_quotes: Object.fromEntries(sources.map((s) => [s.id, s.content])),
            tags: obsMetadata.topics ?? [],
            history: [],
            trend: null,
            trend_computed_at: null,
            project,
            created_by,
          });
          const archived = await archiveThoughts(pool, sources.map((s) => s.id));

          const durCons = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), true, null, durCons);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    status: "consolidated",
                    id: obsResult.id,
                    sources_archived: archived,
                    captured_at: obsResult.created_at.toISOString(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default: {
          const durUnk = Date.now() - t0;
          await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), false, `Unknown tool: ${name}`, durUnk);
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mcp] Tool "${name}" failed:`, message);
      const durErr = Date.now() - t0;
      await auditLog(pool, consumerId, transport, name, sanitizeArgs(name, (args ?? {}) as Record<string, unknown>), false, message, durErr);
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
