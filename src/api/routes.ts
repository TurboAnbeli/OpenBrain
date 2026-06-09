/**
 * REST API routes using Hono.
 * Provides /health, /memories, /memories/search, /memories/list, /memories/batch,
 * /memories/:id (PUT, DELETE), /stats endpoints.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

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
  type ListFilters,
  type BatchThoughtInput,
  type SearchResult,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";
import { hasSpecificityMarker, applyRecencyBoost, overfetchLimit } from "./recency_boost.js";
import {
  shouldExpand,
  generateHydeAnswer,
  reciprocalRankFusion,
} from "./query_expansion.js";
import { rerankResults, shouldRerank, crossEncoderRerank } from "./rerank.js";
import { applyProofCountBoost } from "./proof_count_boost.js";
import { synthesizeObservation } from "./synthesize.js";
import {
  shouldUseEntityRanking,
  extractQueryEntityNames,
  entityWeightedRRF,
} from "./entity_ranking.js";
import { extractEntities } from "./entity_extraction.js";

const HYDE_MODEL = process.env.OPENBRAIN_HYDE_MODEL ?? "smollm2:1.7b";
const HYDE_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
const HYDE_ENABLED = (process.env.OPENBRAIN_HYDE_ENABLED ?? "true").toLowerCase() !== "false";
const RERANK_MODEL =
  process.env.OPENBRAIN_RERANK_MODEL ??
  process.env.OPENBRAIN_HYDE_MODEL ??
  "smollm2:1.7b";
const RERANK_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
const RERANK_ENABLED = (process.env.OPENBRAIN_RERANK_ENABLED ?? "true").toLowerCase() !== "false";
const RERANK_TOPN = parseInt(process.env.OPENBRAIN_RERANK_TOPN ?? "6", 10);
// MS MARCO cross-encoder OFF by default — measured regression on this KB
// (2026-06-09 eval: standard R@1 77.4% → 68.8%, negation pass 0/5). Opt in
// with OPENBRAIN_CROSS_ENCODER_ENABLED=true for A/B testing.
const CROSS_ENCODER_ENABLED =
  (process.env.OPENBRAIN_CROSS_ENCODER_ENABLED ?? "false").toLowerCase() === "true";
const DEDUP_ENABLED = (process.env.OPENBRAIN_DEDUP_ENABLED ?? "true").toLowerCase() !== "false";
const DEDUP_THRESHOLD = parseFloat(process.env.OPENBRAIN_DEDUP_THRESHOLD ?? "0.95");
const SYNTHESIS_MODEL =
  process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "hf.co/unsloth/gemma-4-E4B-it-GGUF:Q4_0";
const SYNTHESIS_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApi(): Hono {
  const app = new Hono();
  const embedder = getEmbedder();
  const pool = getPool();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());

  // Global error handler — return structured JSON for all errors
  app.onError((err, c) => {
    console.error("[api] Unhandled error:", err.message);
    return c.json(
      { error: err.message, service: "open-brain-api" },
      500
    );
  });

  // ─── Health Check ────────────────────────────────────────────────

  app.get("/health", (c) =>
    c.json({ status: "healthy", service: "open-brain-api" })
  );

  // ─── Capture Memory ──────────────────────────────────────────────

  app.post("/memories", async (c) => {
    const body = await c.req.json<{
      content: string;
      source?: string;
      project?: string;
      created_by?: string;
      supersedes?: string;
      // ryel-local: when present, the client is supplying pre-extracted
      // metadata (typically from a stronger LLM than the one running in
      // openbrain-ollama). Skip the local extractMetadata step.
      metadata?: {
        type?: string;
        topics?: string[];
        people?: string[];
        action_items?: string[];
        dates?: string[];
      };
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }

    if (body.supersedes && !UUID_RE.test(body.supersedes)) {
      return c.json({ error: "supersedes must be a valid UUID" }, 400);
    }

    try {
      const embedding = await embedder.generateEmbedding(body.content);

      // Dedup gate: skip if supersedes is set (explicit replacement always inserts).
      if (DEDUP_ENABLED && !body.supersedes) {
        const dup = await findNearDuplicate(pool, embedding, body.project, body.created_by, DEDUP_THRESHOLD);
        if (dup) {
          const bumped = await bumpProofCount(pool, dup.id);
          return c.json({
            id: bumped.id,
            type: bumped.metadata.type,
            topics: bumped.metadata.topics,
            people: bumped.metadata.people,
            project: bumped.project,
            captured_at: bumped.created_at.toISOString(),
            deduplicated: true,
            proof_count: bumped.proof_count,
          });
        }
      }

      const metadata = body.metadata ?? (await embedder.extractMetadata(body.content));
      const fullMetadata = {
        ...metadata,
        source: body.source ?? "api",
        embedder_version: embedder.getVersion(),
      };
      const result = await insertThought(
        pool, body.content, embedding, fullMetadata, body.project, body.supersedes, body.created_by
      );

      // Link extracted entities to the new thought (fire-and-forget; failure
      // does not invalidate the capture since the thought itself succeeded).
      try {
        const entities = extractEntities(body.content, metadata);
        if (entities.length > 0) {
          const { extractAndLinkEntities } = await import("../db/queries.js");
          await extractAndLinkEntities(pool, result.id, entities);
        }
      } catch (e) {
        console.error("[api] Entity linking failed (non-fatal):", e);
      }

      return c.json({
        id: result.id,
        type: metadata.type,
        topics: metadata.topics,
        people: metadata.people,
        project: result.project,
        captured_at: result.created_at.toISOString(),
        deduplicated: false,
        proof_count: result.proof_count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Capture failed:", message);
      return c.json(
        { error: "Failed to capture thought", detail: message },
        502
      );
    }
  });

  // ─── Batch Capture ───────────────────────────────────────────────

  app.post("/memories/batch", async (c) => {
    const body = await c.req.json<{
      thoughts: Array<{
        content: string;
        // ryel-local: optional client-supplied metadata; skip local extraction.
        metadata?: {
          type?: string;
          topics?: string[];
          people?: string[];
          action_items?: string[];
          dates?: string[];
        };
      }>;
      project?: string;
      created_by?: string;
      source?: string;
    }>();

    if (!body.thoughts || !Array.isArray(body.thoughts) || body.thoughts.length === 0) {
      return c.json({ error: "thoughts array is required and must not be empty" }, 400);
    }

    for (const t of body.thoughts) {
      if (!t.content || t.content.trim().length === 0) {
        return c.json({ error: "each thought must have non-empty content" }, 400);
      }
    }

    try {
      const source = body.source ?? "api";
      const embedder_version = embedder.getVersion();

      const processed: BatchThoughtInput[] = await Promise.all(
        body.thoughts.map(async (t) => {
          const embedding = await embedder.generateEmbedding(t.content);
          const metadata = t.metadata ?? (await embedder.extractMetadata(t.content));
          return {
            content: t.content,
            embedding,
            metadata: { ...metadata, source, embedder_version },
            project: body.project,
            created_by: body.created_by,
          };
        })
      );

      const results = await batchInsertThoughts(pool, processed);

      return c.json({
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          project: r.project,
          captured_at: r.created_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Batch capture failed:", message);
      return c.json(
        { error: "Failed to batch capture thoughts", detail: message },
        502
      );
    }
  });

  // ─── Search Memories ─────────────────────────────────────────────

  app.post("/memories/search", async (c) => {
    const body = await c.req.json<{
      query: string;
      limit?: number;
      threshold?: number;
      project?: string;
      created_by?: string;
      type?: string;
      topic?: string;
      include_archived?: boolean;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }

    try {
      // Build JSONB filter from type/topic
      const filter: Record<string, unknown> = {};
      if (body.type) filter.type = body.type;
      if (body.topic) filter.topics = [body.topic];

      const requestedLimit = body.limit ?? 10;
      const boost = hasSpecificityMarker(body.query);
      const rerank = !boost && RERANK_ENABLED && shouldRerank(body.query);
      // HyDE fires only when recency boost does NOT (mutually exclusive — keeps
      // recency-gated queries on the fast path and avoids stacking two re-rankers).
      const hyde = !boost && HYDE_ENABLED && shouldExpand(body.query);
      const fetchLimit = overfetchLimit(requestedLimit, boost || hyde || rerank);

      const threshold = body.threshold ?? 0.5;
      const useEntity = shouldUseEntityRanking(body.query);
      const entityNames = useEntity ? extractQueryEntityNames(body.query) : [];

      const [queryEmbedding, bm25Results, entityResultsRaw] = await Promise.all([
        embedder.generateEmbedding(body.query),
        bm25SearchThoughts(
          pool, body.query, fetchLimit, filter,
          body.project, body.include_archived, body.created_by
        ),
        useEntity
          ? searchThoughtsByEntity(
              pool, entityNames, fetchLimit,
              body.project, body.include_archived, body.created_by
            )
          : Promise.resolve([]),
      ]);
      const rawResults = await searchThoughts(
        pool, queryEmbedding, fetchLimit, threshold, filter,
        body.project, body.include_archived, body.created_by
      );

      let denseFused = rawResults;
      let hydeAnswer: string | null = null;
      if (hyde) {
        hydeAnswer = await generateHydeAnswer(body.query, {
          endpoint: HYDE_ENDPOINT, model: HYDE_MODEL,
        });
        if (hydeAnswer) {
          const hydeEmbedding = await embedder.generateEmbedding(hydeAnswer);
          const hydeResults = await searchThoughts(
            pool, hydeEmbedding, fetchLimit, threshold, filter,
            body.project, body.include_archived, body.created_by
          );
          denseFused = reciprocalRankFusion([rawResults, hydeResults], 60, fetchLimit);
        }
      } else if (boost) {
        denseFused = applyRecencyBoost(rawResults);
      }

      const fusedLimit = rerank ? Math.max(requestedLimit * 2, RERANK_TOPN) : requestedLimit;

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

      // Cross-encoder is opt-in (see CROSS_ENCODER_ENABLED note above). The
      // LLM reranker is the default and is what should run on negation/complex
      // queries. Cross-encoder only runs as a *companion* to the LLM when the
      // operator explicitly enables it, so it never short-circuits the fallback.
      // crossEncoderFired is tracked separately so the response flag is honest.
      const rerankOutput: { results: typeof fusedResults | null; fired: boolean } = {
        results: null,
        fired: false,
      };
      let crossEncoderFired = false;
      if (rerank) {
        if (CROSS_ENCODER_ENABLED) {
          const ceOutput = await crossEncoderRerank(body.query, fusedResults);
          if (ceOutput.fired && ceOutput.results !== null) {
            rerankOutput.results = ceOutput.results;
            rerankOutput.fired = true;
            crossEncoderFired = true;
          }
        }
        const llmOutput = await rerankResults(body.query, fusedResults, {
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
      const results = (rerankedResults ?? fusedResults).slice(0, requestedLimit);

      return c.json({
        query: body.query,
        count: results.length,
        recency_boosted: boost,
        hyde_expanded: hyde && hydeAnswer !== null,
        bm25_fused: true,
        entity_ranked: useEntity,
        reranked: rerankedResults !== null,
        cross_encoder_reranked: crossEncoderFired,
        reranker_fired: rerankOutput.fired,
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          similarity: Math.round(r.similarity * 1000) / 1000,
          created_at: r.created_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Search failed:", message);
      return c.json(
        { error: "Failed to search thoughts", detail: message },
        502
      );
    }
  });

  // ─── List Memories ───────────────────────────────────────────────

  app.post("/memories/list", async (c) => {
    try {
      const body = await c.req.json<ListFilters>();
      const results = await listThoughts(pool, body, body.limit ?? 50);

      return c.json({
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          metadata: r.metadata,
          project: r.project,
          created_by: r.created_by,
          created_at: r.created_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] List failed:", message);
      return c.json(
        { error: "Failed to list thoughts", detail: message },
        500
      );
    }
  });

  // ─── Update Memory ───────────────────────────────────────────────

  app.put("/memories/:id", async (c) => {
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    const body = await c.req.json<{ content: string }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }

    try {
      const [embedding, metadata] = await Promise.all([
        embedder.generateEmbedding(body.content),
        embedder.extractMetadata(body.content),
      ]);

      const result = await updateThought(pool, id, body.content, embedding, metadata);

      return c.json({
        status: "updated",
        id: result.id,
        type: metadata.type,
        topics: metadata.topics,
        content: result.content,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      console.error("[api] Update failed:", message);
      return c.json(
        { error: "Failed to update thought", detail: message },
        502
      );
    }
  });

  // ─── Delete Memory ───────────────────────────────────────────────

  app.delete("/memories/:id", async (c) => {
    const id = c.req.param("id");

    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    try {
      const result = await deleteThought(pool, id);

      if (!result.deleted) {
        return c.json({ error: `Thought not found: ${id}` }, 404);
      }

      return c.json({ status: "deleted", id: result.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Delete failed:", message);
      return c.json(
        { error: "Failed to delete thought", detail: message },
        502
      );
    }
  });

  // ─── Consolidate Observations ────────────────────────────────────────

  app.post("/observations", async (c) => {
    const body = await c.req.json<{
      thought_ids: string[];
      project?: string;
      created_by?: string;
    }>();

    if (!Array.isArray(body.thought_ids) || body.thought_ids.length < 2) {
      return c.json({ error: "thought_ids must be an array of at least 2 UUIDs" }, 400);
    }
    for (const id of body.thought_ids) {
      if (!UUID_RE.test(id)) {
        return c.json({ error: `invalid UUID: ${id}` }, 400);
      }
    }

    try {
      const sources = await getThoughtsByIds(pool, body.thought_ids);
      if (sources.length < 2) {
        return c.json(
          { error: "at least 2 source thoughts must exist and not be archived" },
          422
        );
      }

      const synthesis = await synthesizeObservation(
        sources.map((s) => s.content),
        { endpoint: SYNTHESIS_ENDPOINT, model: SYNTHESIS_MODEL }
      );
      if (!synthesis) {
        return c.json(
          { error: "synthesis quality gate failed — try again or check the synthesis model" },
          422
        );
      }

      const [embedding, metadata] = await Promise.all([
        embedder.generateEmbedding(synthesis),
        embedder.extractMetadata(synthesis),
      ]);
      const fullMetadata = {
        ...metadata,
        type: "observation" as const,
        source: "observations-api",
        embedder_version: embedder.getVersion(),
        consolidates: sources.map((s) => s.id),
      };

      const result = await insertThought(
        pool, synthesis, embedding, fullMetadata, body.project, undefined, body.created_by
      );
      const archived = await archiveThoughts(pool, sources.map((s) => s.id));

      return c.json({
        id: result.id,
        sources_archived: archived,
        captured_at: result.created_at.toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Consolidate failed:", message);
      return c.json(
        { error: "Failed to consolidate observations", detail: message },
        502
      );
    }
  });

  // ─── Stats ───────────────────────────────────────────────────────

  app.get("/stats", async (c) => {
    try {
      const project = c.req.query("project");
      const created_by = c.req.query("created_by");
      const stats = await getThoughtStats(pool, project, created_by);
      return c.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Stats failed:", message);
      return c.json(
        { error: "Failed to get stats", detail: message },
        500
      );
    }
  });

  return app;
}
