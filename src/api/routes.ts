/**
 * REST API routes using Hono.
 * Provides /health, /memories, /memories/search, /memories/list, /stats endpoints.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { getPool } from "../db/connection.js";
import {
  insertThought,
  searchThoughts,
  listThoughts,
  getThoughtStats,
  type ListFilters,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";

export function createApi(): Hono {
  const app = new Hono();
  const embedder = getEmbedder();
  const pool = getPool();

  // Middleware
  app.use("*", cors());
  app.use("*", logger());

  // ─── Health Check ────────────────────────────────────────────────

  app.get("/health", (c) =>
    c.json({ status: "healthy", service: "open-brain-api" })
  );

  // ─── Capture Memory ──────────────────────────────────────────────

  app.post("/memories", async (c) => {
    const body = await c.req.json<{ content: string; source?: string }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }

    // Generate embedding and extract metadata in parallel
    const [embedding, metadata] = await Promise.all([
      embedder.generateEmbedding(body.content),
      embedder.extractMetadata(body.content),
    ]);

    const fullMetadata = { ...metadata, source: body.source ?? "api" };
    const result = await insertThought(pool, body.content, embedding, fullMetadata);

    return c.json({
      id: result.id,
      type: metadata.type,
      topics: metadata.topics,
      people: metadata.people,
      captured_at: result.created_at.toISOString(),
    });
  });

  // ─── Search Memories ─────────────────────────────────────────────

  app.post("/memories/search", async (c) => {
    const body = await c.req.json<{
      query: string;
      limit?: number;
      threshold?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }

    const queryEmbedding = await embedder.generateEmbedding(body.query);
    const results = await searchThoughts(
      pool,
      queryEmbedding,
      body.limit ?? 10,
      body.threshold ?? 0.5
    );

    return c.json({
      query: body.query,
      count: results.length,
      results: results.map((r) => ({
        content: r.content,
        metadata: r.metadata,
        similarity: Math.round(r.similarity * 1000) / 1000,
        created_at: r.created_at.toISOString(),
      })),
    });
  });

  // ─── List Memories ───────────────────────────────────────────────

  app.post("/memories/list", async (c) => {
    const body = await c.req.json<ListFilters>();

    const results = await listThoughts(pool, body);

    return c.json({
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        created_at: r.created_at.toISOString(),
      })),
    });
  });

  // ─── Stats ───────────────────────────────────────────────────────

  app.get("/stats", async (c) => {
    const stats = await getThoughtStats(pool);
    return c.json(stats);
  });

  return app;
}
