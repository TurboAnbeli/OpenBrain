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
  insertDocument,
  getDocument,
  getDocumentBySourceUri,
  updateDocument,
  replaceDocumentChunks,
  listDocumentChunks,
  searchDocumentChunks,
  insertConsolidatedObservation,
  getConsolidatedObservation,
  searchConsolidatedObservations,
  updateConsolidatedObservation,
  enqueueConsolidationJob,
  getConsolidationJob,
  insertExperience,
  getExperience,
  listExperiences,
  searchExperiences,
  insertMemoryLink,
  getMemoryLink,
  listMemoryLinks,
  expandMemoryLinks,
  inferExperienceTemporalLinks,
  inferSupersedesMemoryLinks,
  inferExperienceReferenceLinks,
  getMemoryBankContext,
  type ListFilters,
  type BatchThoughtInput,
  type SearchResult,
  type DocumentKind,
  type DocumentIntent,
  type DocumentRow,
  type DocumentChunkSearchResult,
  type ConsolidatedObservationRow,
  type ConsolidatedObservationSearchResult,
  type ConsolidationJobRow,
  type ExperienceEventType,
  type ExperienceRow,
  type ExperienceSearchResult,
  type MemoryLinkSourceType,
  type MemoryLinkRelationship,
  type MemoryLinkRow,
  type MemoryLinkExpansionDirectionFilter,
  type MemoryLinkExpansionRow,
} from "../db/queries.js";
import { getEmbedder } from "../embedder/index.js";
import { hasSpecificityMarker, applyRecencyBoost, overfetchLimit } from "./recency_boost.js";
import {
  shouldExpand,
  generateHydeAnswer,
  reciprocalRankFusion,
} from "./query_expansion.js";
import { rerankResults, shouldRerank, crossEncoderRerank, extractNegatedTerms } from "./rerank.js";
import { applyProofCountBoost } from "./proof_count_boost.js";
import { runConsolidationJob } from "../jobs/consolidation.js";
import { synthesizeObservation } from "./synthesize.js";
import {
  shouldUseEntityRanking,
  extractQueryEntityNames,
  entityWeightedRRF,
} from "./entity_ranking.js";
import { extractEntities } from "./entity_extraction.js";
import { guardExperienceRetainDirectives } from "./experience_guard.js";

const HYDE_MODEL = process.env.OPENBRAIN_HYDE_MODEL ?? "smollm2:1.7b";
const HYDE_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";
const HYDE_ENABLED = (process.env.OPENBRAIN_HYDE_ENABLED ?? "true").toLowerCase() !== "false";
// HyDE confidence cascade: skip the ~1.5 s hypothetical-answer generation when
// the dense top hit is already strong. A confident match doesn't benefit from
// expansion, and HyDE can dilute it (measured regression on confident
// paraphrase queries, e.g. paraphrase-002 rank 3 → 7). Tunable for A/B.
const HYDE_CONF_THRESHOLD = parseFloat(process.env.OPENBRAIN_HYDE_CONF_THRESHOLD ?? "0.66");
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
  process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "qwen3:1.7b";
const SYNTHESIS_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCUMENT_KINDS: DocumentKind[] = [
  "article",
  "handoff",
  "decision",
  "reflection",
  "research",
  "postmortem",
  "reference",
  "project_note",
  "journal",
  "clipping",
];
const DOCUMENT_INTENTS: DocumentIntent[] = [
  "durable_knowledge",
  "operational_log",
  "transitional_archive",
];
const CONSOLIDATED_OBSERVATION_TRENDS = ["strengthening", "stable", "weakening", "stale"] as const;
const DOCUMENT_KIND_SET = new Set<string>(DOCUMENT_KINDS);
const DOCUMENT_INTENT_SET = new Set<string>(DOCUMENT_INTENTS);
const CONSOLIDATED_OBSERVATION_TREND_SET = new Set<string>(CONSOLIDATED_OBSERVATION_TRENDS);
const CONSOLIDATION_JOB_TYPES = ["observe_thoughts", "observe_documents"] as const;
const CONSOLIDATION_JOB_TYPE_SET = new Set<string>(CONSOLIDATION_JOB_TYPES);
const EXPERIENCE_EVENT_TYPES = ["tool_call", "user_message", "assistant_message", "decide", "external_inbox"] as const;
const EXPERIENCE_EVENT_TYPE_SET = new Set<string>(EXPERIENCE_EVENT_TYPES);
const MEMORY_LINK_SOURCE_TYPES = ["thought", "document", "chunk", "consolidated_observation", "experience", "mental_model"] as const;
const MEMORY_LINK_SOURCE_TYPE_SET = new Set<string>(MEMORY_LINK_SOURCE_TYPES);
const MEMORY_LINK_RELATIONSHIPS = ["temporal_after", "temporal_before", "causal_cause", "causal_effect", "semantic_similar", "entity_co", "supersedes", "evidence_for"] as const;
const MEMORY_LINK_RELATIONSHIP_SET = new Set<string>(MEMORY_LINK_RELATIONSHIPS);
const MEMORY_LINK_INFER_RULES = ["experience_temporal_after", "thought_supersedes", "experience_refs"] as const;
const MEMORY_LINK_INFER_RULE_SET = new Set<string>(MEMORY_LINK_INFER_RULES);
const MEMORY_LINK_EXPANSION_DIRECTIONS = ["incoming", "outgoing", "both"] as const;
const MEMORY_LINK_EXPANSION_DIRECTION_SET = new Set<string>(MEMORY_LINK_EXPANSION_DIRECTIONS);

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function serializeOptionalTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function serializeDocument(document: DocumentRow) {
  return {
    id: document.id,
    title: document.title,
    source_type: document.source_type,
    source_uri: document.source_uri ?? null,
    content: document.content,
    metadata: document.metadata,
    project: document.project ?? null,
    created_by: document.created_by ?? null,
    bank_id: document.bank_id ?? null,
    document_kind: document.document_kind ?? null,
    session_id: document.session_id ?? null,
    task_id: document.task_id ?? null,
    intent: document.intent ?? null,
    event_started_at: serializeOptionalTimestamp(document.event_started_at),
    event_ended_at: serializeOptionalTimestamp(document.event_ended_at),
    status: document.status,
    created_at: document.created_at.toISOString(),
    updated_at: document.updated_at.toISOString(),
  };
}

function serializeConsolidationJob(job: ConsolidationJobRow) {
  return {
    id: job.id,
    bank_id: job.bank_id,
    job_type: job.job_type,
    status: job.status,
    input: job.input ?? {},
    output: job.output ?? null,
    error: job.error ?? null,
    started_at: serializeOptionalTimestamp(job.started_at ?? null),
    finished_at: serializeOptionalTimestamp(job.finished_at ?? null),
    attempts: job.attempts,
    created_at: job.created_at.toISOString(),
  };
}

function serializeConsolidatedObservation(observation: ConsolidatedObservationRow & { similarity?: number }) {
  return {
    id: observation.id,
    bank_id: observation.bank_id ?? null,
    content: observation.content,
    proof_count: observation.proof_count,
    source_memory_ids: observation.source_memory_ids ?? [],
    source_quotes: observation.source_quotes ?? {},
    tags: observation.tags ?? [],
    history: observation.history ?? [],
    trend: observation.trend ?? null,
    trend_computed_at: serializeOptionalTimestamp(observation.trend_computed_at),
    project: observation.project ?? null,
    created_by: observation.created_by ?? null,
    archived: observation.archived,
    created_at: observation.created_at.toISOString(),
    updated_at: observation.updated_at.toISOString(),
    ...(typeof observation.similarity === "number" ? { similarity: observation.similarity } : {}),
  };
}

function serializeExperience(experience: ExperienceRow & { similarity?: number }) {
  return {
    id: experience.id,
    bank_id: experience.bank_id,
    session_id: experience.session_id ?? null,
    agent_id: experience.agent_id ?? null,
    occurred_at: experience.occurred_at.toISOString(),
    event_type: experience.event_type,
    content: experience.content,
    refs: experience.refs ?? {},
    project: experience.project ?? null,
    created_by: experience.created_by ?? null,
    created_at: experience.created_at.toISOString(),
    ...(typeof experience.similarity === "number" ? { similarity: experience.similarity } : {}),
  };
}

function serializeMemoryLink(link: MemoryLinkRow) {
  return {
    id: link.id,
    bank_id: link.bank_id,
    source_type: link.source_type,
    source_id: link.source_id,
    target_type: link.target_type,
    target_id: link.target_id,
    relationship: link.relationship,
    weight: link.weight,
    inferred: link.inferred,
    created_at: link.created_at.toISOString(),
  };
}

function serializeMemoryLinkExpansion(row: MemoryLinkExpansionRow) {
  return {
    link: serializeMemoryLink(row),
    seed: {
      source_type: row.seed_type,
      source_id: row.seed_id,
    },
    direction: row.direction,
    linked_memory: {
      source_type: row.linked_type,
      id: row.linked_id,
      content: row.linked_content ?? null,
      title: row.linked_title ?? null,
      metadata: row.linked_metadata ?? {},
      project: row.linked_project ?? null,
      created_at: serializeOptionalTimestamp(row.linked_created_at ?? null),
    },
  };
}

type RecallSourceType = "thought" | "document_chunk" | "consolidated_observation" | "experience" | MemoryLinkSourceType;

type RecallTemporalLaneStatus = "stub";

interface RecallApiResult {
  source_type: RecallSourceType;
  id: string;
  content: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  project: string | null;
  created_at: string | null;
  score: number;
  semantic_score: number;
  bm25_score: number;
  temporal_score: number;
  link_score: number;
  link?: ReturnType<typeof serializeMemoryLink>;
  seed?: { source_type: MemoryLinkSourceType; source_id: string };
  direction?: "incoming" | "outgoing";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function scoreValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recallKey(result: Pick<RecallApiResult, "source_type" | "id">): string {
  return `${result.source_type}:${result.id}`;
}

function upsertRecallResult(results: Map<string, RecallApiResult>, next: RecallApiResult): void {
  const key = recallKey(next);
  const current = results.get(key);
  if (!current) {
    results.set(key, next);
    return;
  }

  current.content = current.content ?? next.content;
  current.title = current.title ?? next.title;
  current.metadata = { ...current.metadata, ...next.metadata };
  current.project = current.project ?? next.project;
  current.created_at = current.created_at ?? next.created_at;
  current.semantic_score = Math.max(current.semantic_score, next.semantic_score);
  current.bm25_score = Math.max(current.bm25_score, next.bm25_score);
  current.temporal_score = Math.max(current.temporal_score, next.temporal_score);
  current.link_score = Math.max(current.link_score, next.link_score);
  current.score = Math.max(current.score, next.score);
  if (next.link) current.link = next.link;
  if (next.seed) current.seed = next.seed;
  if (next.direction) current.direction = next.direction;
}

function sortRecallResults(results: RecallApiResult[]): RecallApiResult[] {
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.created_at ? Date.parse(a.created_at) : 0;
    const bTime = b.created_at ? Date.parse(b.created_at) : 0;
    return bTime - aTime;
  });
}

function recallFromThought(row: SearchResult, lane: "semantic" | "bm25"): RecallApiResult {
  const score = scoreValue(row.similarity);
  return {
    source_type: "thought",
    id: row.id,
    content: row.content,
    title: null,
    metadata: asRecord(row.metadata),
    project: row.project ?? null,
    created_at: serializeOptionalTimestamp(row.created_at),
    score,
    semantic_score: lane === "semantic" ? score : 0,
    bm25_score: lane === "bm25" ? score : 0,
    temporal_score: 0,
    link_score: 0,
  };
}

function recallFromDocumentChunk(row: DocumentChunkSearchResult): RecallApiResult {
  return {
    source_type: "document_chunk",
    id: row.id,
    content: row.content,
    title: row.document_title,
    metadata: {
      ...asRecord(row.metadata),
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      document_source_type: row.document_source_type,
      document_source_uri: row.document_source_uri ?? null,
      fts_rank: row.fts_rank,
    },
    project: row.project ?? null,
    created_at: serializeOptionalTimestamp(row.created_at),
    score: scoreValue(row.score),
    semantic_score: scoreValue(row.similarity),
    bm25_score: scoreValue(row.fts_rank),
    temporal_score: 0,
    link_score: 0,
  };
}

function recallFromObservation(row: ConsolidatedObservationSearchResult): RecallApiResult {
  const score = scoreValue(row.similarity);
  return {
    source_type: "consolidated_observation",
    id: row.id,
    content: row.content,
    title: null,
    metadata: {
      proof_count: row.proof_count,
      source_memory_ids: row.source_memory_ids ?? [],
      source_quotes: row.source_quotes ?? {},
      tags: row.tags ?? [],
      trend: row.trend ?? null,
    },
    project: row.project ?? null,
    created_at: serializeOptionalTimestamp(row.created_at),
    score,
    semantic_score: score,
    bm25_score: 0,
    temporal_score: 0,
    link_score: 0,
  };
}

function recallFromExperience(row: ExperienceSearchResult): RecallApiResult {
  const score = scoreValue(row.similarity);
  return {
    source_type: "experience",
    id: row.id,
    content: row.content,
    title: null,
    metadata: {
      ...asRecord(row.refs),
      event_type: row.event_type,
      session_id: row.session_id ?? null,
      agent_id: row.agent_id ?? null,
      occurred_at: serializeOptionalTimestamp(row.occurred_at),
    },
    project: row.project ?? null,
    created_at: serializeOptionalTimestamp(row.created_at),
    score,
    semantic_score: score,
    bm25_score: 0,
    temporal_score: 0,
    link_score: 0,
  };
}

function recallFromMemoryLink(row: MemoryLinkExpansionRow): RecallApiResult {
  const score = scoreValue(row.weight);
  return {
    source_type: row.linked_type,
    id: row.linked_id,
    content: row.linked_content ?? null,
    title: row.linked_title ?? null,
    metadata: asRecord(row.linked_metadata),
    project: row.linked_project ?? null,
    created_at: serializeOptionalTimestamp(row.linked_created_at ?? null),
    score,
    semantic_score: 0,
    bm25_score: 0,
    temporal_score: 0,
    link_score: score,
    link: serializeMemoryLink(row),
    seed: { source_type: row.seed_type, source_id: row.seed_id },
    direction: row.direction,
  };
}

function parseBodyLimit(value: unknown, fallback = 10, max = 50): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function parseOptionalWeight(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseBoundedLimit(value: string | undefined, fallback = 50, max = 100): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

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

      if (body.supersedes) {
        try {
          await insertMemoryLink(pool, {
            bank_id: "openbrain",
            source_type: "thought",
            source_id: result.id,
            target_type: "thought",
            target_id: body.supersedes,
            relationship: "supersedes",
            weight: 1,
            inferred: true,
          });
        } catch (e) {
          console.error("[api] Supersedes memory link failed (non-fatal):", e);
        }
      }

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
      // HyDE fires only when neither recency boost nor reranking applies.
      // Recency: keep recency-gated queries on the fast path. Rerank: negation
      // queries are handled by the deterministic negation reranker, which is
      // both faster and more reliable than HyDE expansion (HyDE generation on
      // this CPU-only host costs seconds and tends to hallucinate on negation).
      // baseHyde is the eligibility gate; actual generation is additionally
      // gated below on dense-result confidence (the cascade).
      const baseHyde = !boost && !rerank && HYDE_ENABLED && shouldExpand(body.query);
      const fetchLimit = overfetchLimit(requestedLimit, boost || baseHyde || rerank);

      const SEARCH_THRESHOLD = parseFloat(process.env.OPENBRAIN_SEARCH_THRESHOLD ?? "0.3");
      const threshold = body.threshold ?? SEARCH_THRESHOLD;
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

      // Cascade: only actually run HyDE when the dense top hit is weak.
      const denseConfident = (rawResults[0]?.similarity ?? 0) >= HYDE_CONF_THRESHOLD;
      const hyde = baseHyde && !denseConfident;

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

      const fusedLimit = rerank ? Math.max(fetchLimit, requestedLimit * 2, RERANK_TOPN) : requestedLimit;

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
        negation_reranked: rerankOutput.fired,
        negation_terms: rerankOutput.fired ? extractNegatedTerms(body.query) : [],
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

  // ─── Recall Facade ───────────────────────────────────────────────

  app.post("/recall", async (c) => {
    const body = await c.req.json<{
      query?: string;
      bank_id?: string;
      project?: string;
      created_by?: string;
      type?: string;
      topic?: string;
      include_archived?: boolean;
      include_documents?: boolean;
      include_observations?: boolean;
      include_experiences?: boolean;
      expand_from_seeds?: Array<{ source_type?: string; source_id?: string }>;
      link_direction?: string;
      link_relationship?: string;
      limit?: number;
      threshold?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.include_archived !== undefined && typeof body.include_archived !== "boolean") {
      return c.json({ error: "include_archived must be a boolean" }, 400);
    }
    if (body.include_documents !== undefined && typeof body.include_documents !== "boolean") {
      return c.json({ error: "include_documents must be a boolean" }, 400);
    }
    if (body.include_observations !== undefined && typeof body.include_observations !== "boolean") {
      return c.json({ error: "include_observations must be a boolean" }, 400);
    }
    if (body.include_experiences !== undefined && typeof body.include_experiences !== "boolean") {
      return c.json({ error: "include_experiences must be a boolean" }, 400);
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isFinite(body.limit))) {
      return c.json({ error: "limit must be a finite number" }, 400);
    }
    if (body.threshold !== undefined && (typeof body.threshold !== "number" || !Number.isFinite(body.threshold))) {
      return c.json({ error: "threshold must be a finite number" }, 400);
    }

    const seeds: Array<{ source_type: MemoryLinkSourceType; source_id: string }> = [];
    if (body.expand_from_seeds !== undefined) {
      if (!Array.isArray(body.expand_from_seeds) || body.expand_from_seeds.length === 0) {
        return c.json({ error: "expand_from_seeds must be a non-empty array when provided" }, 400);
      }
      if (body.expand_from_seeds.length > 50) {
        return c.json({ error: "expand_from_seeds must contain no more than 50 entries" }, 400);
      }
      for (const seed of body.expand_from_seeds) {
        if (!seed || typeof seed !== "object") {
          return c.json({ error: "each expand_from_seeds entry must be an object" }, 400);
        }
        if (!seed.source_type || !MEMORY_LINK_SOURCE_TYPE_SET.has(seed.source_type)) {
          return c.json({ error: `seed.source_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
        }
        if (!seed.source_id || !UUID_RE.test(seed.source_id)) {
          return c.json({ error: "seed.source_id must be a valid UUID" }, 400);
        }
        seeds.push({ source_type: seed.source_type as MemoryLinkSourceType, source_id: seed.source_id });
      }
    }

    const linkDirection = body.link_direction ?? "both";
    if (!MEMORY_LINK_EXPANSION_DIRECTION_SET.has(linkDirection)) {
      return c.json({ error: `link_direction must be one of: ${MEMORY_LINK_EXPANSION_DIRECTIONS.join(", ")}` }, 400);
    }
    if (body.link_relationship !== undefined && !MEMORY_LINK_RELATIONSHIP_SET.has(body.link_relationship)) {
      return c.json({ error: `link_relationship must be one of: ${MEMORY_LINK_RELATIONSHIPS.join(", ")}` }, 400);
    }

    const bankId = body.bank_id ?? "openbrain";
    const limit = parseBodyLimit(body.limit, 10, 50);
    const threshold = body.threshold ?? parseFloat(process.env.OPENBRAIN_SEARCH_THRESHOLD ?? "0.3");
    const includeDocuments = body.include_documents ?? true;
    const includeObservations = body.include_observations ?? true;
    const includeExperiences = body.include_experiences ?? true;
    const filter: Record<string, unknown> = {};
    if (body.type) filter.type = body.type;
    if (body.topic) filter.topics = [body.topic];

    try {
      const queryEmbedding = await embedder.generateEmbedding(body.query);
      const [semanticResults, bm25Results, documentResults, observationResults, experienceResults, linkResults] = await Promise.all([
        searchThoughts(
          pool, queryEmbedding, limit, threshold, filter,
          body.project, body.include_archived, body.created_by
        ),
        bm25SearchThoughts(
          pool, body.query, limit, filter,
          body.project, body.include_archived, body.created_by
        ),
        includeDocuments
          ? searchDocumentChunks(pool, queryEmbedding, {
              query: body.query,
              mode: "hybrid",
              limit,
              threshold,
              project: body.project,
            })
          : Promise.resolve([]),
        includeObservations
          ? searchConsolidatedObservations(pool, queryEmbedding, {
              bank_id: bankId,
              project: body.project,
              created_by: body.created_by,
              include_archived: body.include_archived,
              limit,
              threshold,
            })
          : Promise.resolve([]),
        includeExperiences
          ? searchExperiences(pool, queryEmbedding, {
              bank_id: bankId,
              project: body.project,
              created_by: body.created_by,
              limit,
              threshold,
            })
          : Promise.resolve([]),
        seeds.length > 0
          ? expandMemoryLinks(pool, {
              bank_id: bankId,
              seeds,
              direction: linkDirection as MemoryLinkExpansionDirectionFilter,
              relationship: body.link_relationship as MemoryLinkRelationship | undefined,
              include_archived: body.include_archived ?? false,
              limit,
            })
          : Promise.resolve([]),
      ]);

      const recallResults = new Map<string, RecallApiResult>();
      semanticResults.forEach((row) => upsertRecallResult(recallResults, recallFromThought(row, "semantic")));
      bm25Results.forEach((row) => upsertRecallResult(recallResults, recallFromThought(row, "bm25")));
      documentResults.forEach((row) => upsertRecallResult(recallResults, recallFromDocumentChunk(row)));
      observationResults.forEach((row) => upsertRecallResult(recallResults, recallFromObservation(row)));
      experienceResults.forEach((row) => upsertRecallResult(recallResults, recallFromExperience(row)));
      linkResults.forEach((row) => upsertRecallResult(recallResults, recallFromMemoryLink(row)));

      const results = sortRecallResults([...recallResults.values()]).slice(0, limit);
      return c.json({
        query: body.query,
        bank_id: bankId,
        count: results.length,
        lanes: {
          semantic: true,
          bm25: true,
          documents: includeDocuments,
          observations: includeObservations,
          experiences: includeExperiences,
          link_expansion: seeds.length > 0,
          temporal: "stub" as RecallTemporalLaneStatus,
        },
        results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Recall failed:", message);
      return c.json({ error: "Failed to recall memories", detail: message }, 502);
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
  // ─── Memory Links ───────────────────────────────────────────────────

  app.post("/memory-links", async (c) => {
    const body = await c.req.json<{
      bank_id?: string;
      source_type?: string;
      source_id?: string;
      target_type?: string;
      target_id?: string;
      relationship?: string;
      weight?: number;
      inferred?: boolean;
    }>();

    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (!body.source_type || !MEMORY_LINK_SOURCE_TYPE_SET.has(body.source_type)) {
      return c.json({ error: `source_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
    }
    if (!body.target_type || !MEMORY_LINK_SOURCE_TYPE_SET.has(body.target_type)) {
      return c.json({ error: `target_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
    }
    if (!body.relationship || !MEMORY_LINK_RELATIONSHIP_SET.has(body.relationship)) {
      return c.json({ error: `relationship must be one of: ${MEMORY_LINK_RELATIONSHIPS.join(", ")}` }, 400);
    }
    if (!body.source_id || !UUID_RE.test(body.source_id)) {
      return c.json({ error: "source_id must be a valid UUID" }, 400);
    }
    if (!body.target_id || !UUID_RE.test(body.target_id)) {
      return c.json({ error: "target_id must be a valid UUID" }, 400);
    }
    const weight = parseOptionalWeight(body.weight);
    if (body.weight !== undefined && weight === undefined) {
      return c.json({ error: "weight must be a finite number" }, 400);
    }
    if (body.inferred !== undefined && typeof body.inferred !== "boolean") {
      return c.json({ error: "inferred must be a boolean" }, 400);
    }

    try {
      const result = await insertMemoryLink(pool, {
        bank_id: body.bank_id ?? "openbrain",
        source_type: body.source_type as MemoryLinkSourceType,
        source_id: body.source_id,
        target_type: body.target_type as MemoryLinkSourceType,
        target_id: body.target_id,
        relationship: body.relationship as MemoryLinkRelationship,
        weight,
        inferred: body.inferred ?? true,
      });
      return c.json(serializeMemoryLink(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory link upsert failed:", message);
      return c.json({ error: "Failed to upsert memory link", detail: message }, 502);
    }
  });

  app.get("/memory-links", async (c) => {
    const sourceType = c.req.query("source_type");
    const targetType = c.req.query("target_type");
    const relationship = c.req.query("relationship");
    const inferred = parseOptionalBoolean(c.req.query("inferred"));

    if (sourceType !== undefined && !MEMORY_LINK_SOURCE_TYPE_SET.has(sourceType)) {
      return c.json({ error: `source_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
    }
    if (targetType !== undefined && !MEMORY_LINK_SOURCE_TYPE_SET.has(targetType)) {
      return c.json({ error: `target_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
    }
    if (relationship !== undefined && !MEMORY_LINK_RELATIONSHIP_SET.has(relationship)) {
      return c.json({ error: `relationship must be one of: ${MEMORY_LINK_RELATIONSHIPS.join(", ")}` }, 400);
    }
    if (c.req.query("inferred") !== undefined && inferred === undefined) {
      return c.json({ error: "inferred must be true or false" }, 400);
    }
    const sourceId = c.req.query("source_id");
    const targetId = c.req.query("target_id");
    if (sourceId !== undefined && !UUID_RE.test(sourceId)) {
      return c.json({ error: "source_id must be a valid UUID" }, 400);
    }
    if (targetId !== undefined && !UUID_RE.test(targetId)) {
      return c.json({ error: "target_id must be a valid UUID" }, 400);
    }

    try {
      const results = await listMemoryLinks(pool, {
        bank_id: c.req.query("bank_id") ?? "openbrain",
        source_type: sourceType as MemoryLinkSourceType | undefined,
        source_id: sourceId,
        target_type: targetType as MemoryLinkSourceType | undefined,
        target_id: targetId,
        relationship: relationship as MemoryLinkRelationship | undefined,
        inferred,
        limit: parseBoundedLimit(c.req.query("limit"), 50, 500),
      });
      return c.json({ count: results.length, results: results.map(serializeMemoryLink) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory link list failed:", message);
      return c.json({ error: "Failed to list memory links", detail: message }, 502);
    }
  });

  app.post("/memory-links/expand", async (c) => {
    const body = await c.req.json<{
      bank_id?: string;
      seeds?: Array<{ source_type?: string; source_id?: string }>;
      direction?: string;
      relationship?: string;
      include_archived?: boolean;
      limit?: number;
    }>();

    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (!Array.isArray(body.seeds) || body.seeds.length === 0) {
      return c.json({ error: "seeds must be a non-empty array" }, 400);
    }
    if (body.seeds.length > 50) {
      return c.json({ error: "seeds must contain no more than 50 entries" }, 400);
    }
    const seeds: Array<{ source_type: MemoryLinkSourceType; source_id: string }> = [];
    for (const seed of body.seeds) {
      if (!seed || typeof seed !== "object") {
        return c.json({ error: "each seed must be an object" }, 400);
      }
      if (!seed.source_type || !MEMORY_LINK_SOURCE_TYPE_SET.has(seed.source_type)) {
        return c.json({ error: `seed.source_type must be one of: ${MEMORY_LINK_SOURCE_TYPES.join(", ")}` }, 400);
      }
      if (!seed.source_id || !UUID_RE.test(seed.source_id)) {
        return c.json({ error: "seed.source_id must be a valid UUID" }, 400);
      }
      seeds.push({ source_type: seed.source_type as MemoryLinkSourceType, source_id: seed.source_id });
    }

    const direction = body.direction ?? "both";
    if (!MEMORY_LINK_EXPANSION_DIRECTION_SET.has(direction)) {
      return c.json({ error: `direction must be one of: ${MEMORY_LINK_EXPANSION_DIRECTIONS.join(", ")}` }, 400);
    }
    if (body.relationship !== undefined && !MEMORY_LINK_RELATIONSHIP_SET.has(body.relationship)) {
      return c.json({ error: `relationship must be one of: ${MEMORY_LINK_RELATIONSHIPS.join(", ")}` }, 400);
    }
    if (body.include_archived !== undefined && typeof body.include_archived !== "boolean") {
      return c.json({ error: "include_archived must be a boolean" }, 400);
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isFinite(body.limit))) {
      return c.json({ error: "limit must be a finite number" }, 400);
    }

    try {
      const results = await expandMemoryLinks(pool, {
        bank_id: body.bank_id ?? "openbrain",
        seeds,
        direction: direction as MemoryLinkExpansionDirectionFilter,
        relationship: body.relationship as MemoryLinkRelationship | undefined,
        include_archived: body.include_archived ?? false,
        limit: body.limit === undefined ? 50 : Math.max(1, Math.min(100, Math.trunc(body.limit))),
      });
      return c.json({ count: results.length, results: results.map(serializeMemoryLinkExpansion) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory link expansion failed:", message);
      return c.json({ error: "Failed to expand memory links", detail: message }, 502);
    }
  });

  app.post("/memory-links/infer", async (c) => {
    const body = await c.req.json<{
      bank_id?: string;
      session_id?: string;
      rules?: string[];
    }>();

    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.rules !== undefined && !Array.isArray(body.rules)) {
      return c.json({ error: "rules must be an array" }, 400);
    }
    const requestedRules = body.rules ?? ["experience_temporal_after", "thought_supersedes", "experience_refs"];
    for (const rule of requestedRules) {
      if (!MEMORY_LINK_INFER_RULE_SET.has(rule)) {
        return c.json({ error: `rules must contain only: ${MEMORY_LINK_INFER_RULES.join(", ")}` }, 400);
      }
    }

    const bankId = body.bank_id ?? "openbrain";
    const results: MemoryLinkRow[] = [];
    const counts: Record<string, number> = {};
    try {
      if (requestedRules.includes("experience_temporal_after")) {
        const links = await inferExperienceTemporalLinks(pool, { bank_id: bankId, session_id: body.session_id });
        counts.experience_temporal_after = links.length;
        results.push(...links);
      }
      if (requestedRules.includes("thought_supersedes")) {
        const links = await inferSupersedesMemoryLinks(pool, { bank_id: bankId });
        counts.thought_supersedes = links.length;
        results.push(...links);
      }
      if (requestedRules.includes("experience_refs")) {
        const links = await inferExperienceReferenceLinks(pool, { bank_id: bankId, session_id: body.session_id });
        counts.experience_refs = links.length;
        results.push(...links);
      }
      return c.json({ count: results.length, rules: counts, results: results.map(serializeMemoryLink) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory link inference failed:", message);
      return c.json({ error: "Failed to infer memory links", detail: message }, 502);
    }
  });

  app.get("/memory-links/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }
    try {
      const result = await getMemoryLink(pool, id);
      if (!result) {
        return c.json({ error: `Memory link not found: ${id}` }, 404);
      }
      return c.json(serializeMemoryLink(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory link fetch failed:", message);
      return c.json({ error: "Failed to fetch memory link", detail: message }, 502);
    }
  });


  // ─── Experiences ───────────────────────────────────────────────────

  app.post("/experiences", async (c) => {
    const body = await c.req.json<{
      content?: string;
      bank_id?: string;
      session_id?: string;
      agent_id?: string;
      occurred_at?: string;
      event_type?: string;
      refs?: Record<string, unknown>;
      project?: string;
      created_by?: string;
    }>();

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }
    if (!body.event_type || !EXPERIENCE_EVENT_TYPE_SET.has(body.event_type)) {
      return c.json({ error: `event_type must be one of: ${EXPERIENCE_EVENT_TYPES.join(", ")}` }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.occurred_at !== undefined && !isValidTimestamp(body.occurred_at)) {
      return c.json({ error: "occurred_at must be a valid timestamp" }, 400);
    }
    if (body.refs !== undefined && (typeof body.refs !== "object" || Array.isArray(body.refs) || body.refs === null)) {
      return c.json({ error: "refs must be an object" }, 400);
    }

    const bankId = body.bank_id ?? "openbrain";
    try {
      const memoryBank = await getMemoryBankContext(pool, bankId, "retain");
      const guard = guardExperienceRetainDirectives(body.content, memoryBank);
      if (!guard.allowed) {
        return c.json({
          error: "experience content violates active retain directives",
          violations: guard.violations,
          directive_ids: guard.applied_directive_ids,
        }, 422);
      }

      const embedding = await embedder.generateEmbedding(body.content);
      const refs = {
        ...(body.refs ?? {}),
        applied_directive_ids: guard.applied_directive_ids,
      };
      const result = await insertExperience(pool, {
        content: body.content,
        embedding,
        event_type: body.event_type as ExperienceEventType,
        bank_id: bankId,
        session_id: body.session_id,
        agent_id: body.agent_id,
        occurred_at: body.occurred_at,
        refs,
        project: body.project,
        created_by: body.created_by,
      });

      if (result.session_id) {
        try {
          await inferExperienceTemporalLinks(pool, { bank_id: bankId, session_id: result.session_id });
          await inferExperienceReferenceLinks(pool, { bank_id: bankId, session_id: result.session_id });
        } catch (e) {
          console.error("[api] Experience memory link inference failed (non-fatal):", e);
        }
      }

      return c.json(serializeExperience(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Experience capture failed:", message);
      return c.json({ error: "Failed to capture experience", detail: message }, 502);
    }
  });

  app.get("/experiences", async (c) => {
    const eventType = c.req.query("event_type");
    if (eventType !== undefined && !EXPERIENCE_EVENT_TYPE_SET.has(eventType)) {
      return c.json({ error: `event_type must be one of: ${EXPERIENCE_EVENT_TYPES.join(", ")}` }, 400);
    }

    try {
      const results = await listExperiences(pool, {
        bank_id: c.req.query("bank_id") ?? "openbrain",
        session_id: c.req.query("session_id"),
        agent_id: c.req.query("agent_id"),
        event_type: eventType as ExperienceEventType | undefined,
        project: c.req.query("project"),
        created_by: c.req.query("created_by"),
        limit: parseBoundedLimit(c.req.query("limit")),
      });
      return c.json({ count: results.length, results: results.map(serializeExperience) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Experience list failed:", message);
      return c.json({ error: "Failed to list experiences", detail: message }, 502);
    }
  });

  app.post("/experiences/search", async (c) => {
    const body = await c.req.json<{
      query?: string;
      bank_id?: string;
      session_id?: string;
      agent_id?: string;
      event_type?: string;
      project?: string;
      created_by?: string;
      threshold?: number;
      limit?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    if (body.event_type !== undefined && !EXPERIENCE_EVENT_TYPE_SET.has(body.event_type)) {
      return c.json({ error: `event_type must be one of: ${EXPERIENCE_EVENT_TYPES.join(", ")}` }, 400);
    }

    try {
      const embedding = await embedder.generateEmbedding(body.query);
      const results = await searchExperiences(pool, embedding, {
        bank_id: body.bank_id ?? "openbrain",
        session_id: body.session_id,
        agent_id: body.agent_id,
        event_type: body.event_type as ExperienceEventType | undefined,
        project: body.project,
        created_by: body.created_by,
        threshold: body.threshold ?? parseFloat(process.env.OPENBRAIN_SEARCH_THRESHOLD ?? "0.3"),
        limit: Math.max(1, Math.min(100, body.limit ?? 10)),
      });
      return c.json({ count: results.length, results: results.map(serializeExperience) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Experience search failed:", message);
      return c.json({ error: "Failed to search experiences", detail: message }, 502);
    }
  });

  app.get("/experiences/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }
    try {
      const result = await getExperience(pool, id);
      if (!result) {
        return c.json({ error: `Experience not found: ${id}` }, 404);
      }
      return c.json(serializeExperience(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Experience fetch failed:", message);
      return c.json({ error: "Failed to fetch experience", detail: message }, 502);
    }
  });


  // ─── Consolidation Jobs ─────────────────────────────────────────────

  app.post("/consolidation-jobs", async (c) => {
    const body = await c.req.json<{
      job_type?: string;
      bank_id?: string;
      thought_ids?: string[];
      document_ids?: string[];
      source_uris?: string[];
      project?: string;
      created_by?: string;
    }>();

    if (!body.job_type || !CONSOLIDATION_JOB_TYPE_SET.has(body.job_type)) {
      return c.json({ error: `job_type must be one of: ${CONSOLIDATION_JOB_TYPES.join(", ")}` }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }

    const jobType = body.job_type as (typeof CONSOLIDATION_JOB_TYPES)[number];
    const input: Record<string, unknown> = {};
    if (body.project !== undefined) input.project = body.project;
    if (body.created_by !== undefined) input.created_by = body.created_by;

    if (jobType === "observe_thoughts") {
      if (!Array.isArray(body.thought_ids) || body.thought_ids.length < 2) {
        return c.json({ error: "thought_ids must be an array of at least 2 UUIDs" }, 400);
      }
      for (const id of body.thought_ids) {
        if (!UUID_RE.test(id)) {
          return c.json({ error: `invalid UUID: ${id}` }, 400);
        }
      }
      input.thought_ids = body.thought_ids;
    }

    if (jobType === "observe_documents") {
      const documentIds = body.document_ids ?? [];
      const sourceUris = body.source_uris ?? [];
      if (!Array.isArray(documentIds) || !Array.isArray(sourceUris) || documentIds.length + sourceUris.length === 0) {
        return c.json({ error: "document_ids or source_uris must include at least one explicit source" }, 400);
      }
      for (const id of documentIds) {
        if (!UUID_RE.test(id)) {
          return c.json({ error: `invalid UUID: ${id}` }, 400);
        }
      }
      input.document_ids = documentIds;
      input.source_uris = sourceUris;
    }

    try {
      const job = await enqueueConsolidationJob(pool, {
        job_type: jobType,
        bank_id: body.bank_id ?? "openbrain",
        input,
      });
      return c.json(serializeConsolidationJob(job));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Consolidation job enqueue failed:", message);
      return c.json({ error: "Failed to enqueue consolidation job", detail: message }, 502);
    }
  });

  app.get("/consolidation-jobs/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }
    try {
      const job = await getConsolidationJob(pool, id);
      if (!job) {
        return c.json({ error: `Consolidation job not found: ${id}` }, 404);
      }
      return c.json(serializeConsolidationJob(job));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Consolidation job fetch failed:", message);
      return c.json({ error: "Failed to fetch consolidation job", detail: message }, 502);
    }
  });

  app.post("/consolidation-jobs/:id/run", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }
    try {
      const result = await runConsolidationJob(pool, id, {
        embedder,
        synthesis: { endpoint: SYNTHESIS_ENDPOINT, model: SYNTHESIS_MODEL },
      });
      return c.json({
        job: serializeConsolidationJob(result.job),
        observation: result.observation ? serializeConsolidatedObservation(result.observation) : null,
      }, result.job.status === "error" ? 422 : 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not queued") || message.includes("does not exist")) {
        return c.json({ error: message }, 409);
      }
      console.error("[api] Consolidation job run failed:", message);
      return c.json({ error: "Failed to run consolidation job", detail: message }, 502);
    }
  });

  // ─── Observations ───────────────────────────────────────────────────

  async function consolidateObservation(
    body: { thought_ids: string[]; project?: string; created_by?: string },
    c: any
  ) {
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

      const result = await insertConsolidatedObservation(pool, {
        content: synthesis,
        embedding,
        proof_count: sources.length,
        source_memory_ids: sources.map((s) => s.id),
        source_quotes: Object.fromEntries(sources.map((s) => [s.id, s.content])),
        tags: metadata.topics ?? [],
        history: [],
        trend: null,
        trend_computed_at: null,
        project: body.project,
        created_by: body.created_by,
      });
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
  }

  app.post("/consolidated-observations", async (c) => {
    const body = await c.req.json<{
      content?: string;
      bank_id?: string;
      proof_count?: number;
      source_memory_ids?: string[];
      source_quotes?: Record<string, string>;
      tags?: unknown[];
      history?: unknown[];
      trend?: (typeof CONSOLIDATED_OBSERVATION_TRENDS)[number] | null;
      trend_computed_at?: string | null;
      project?: string;
      created_by?: string;
      archived?: boolean;
      thought_ids?: string[];
    }>();

    if (Array.isArray(body.thought_ids)) {
      return consolidateObservation(
        { thought_ids: body.thought_ids, project: body.project, created_by: body.created_by },
        c
      );
    }

    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.trend !== undefined && body.trend !== null && !CONSOLIDATED_OBSERVATION_TREND_SET.has(body.trend)) {
      return c.json({ error: `trend must be one of: ${CONSOLIDATED_OBSERVATION_TRENDS.join(", ")}` }, 400);
    }
    if (body.trend_computed_at !== undefined && body.trend_computed_at !== null && !isValidTimestamp(body.trend_computed_at)) {
      return c.json({ error: "trend_computed_at must be a valid ISO timestamp" }, 400);
    }
    if (body.source_memory_ids !== undefined && !Array.isArray(body.source_memory_ids)) {
      return c.json({ error: "source_memory_ids must be an array of UUIDs" }, 400);
    }
    for (const id of body.source_memory_ids ?? []) {
      if (!UUID_RE.test(id)) {
        return c.json({ error: `invalid UUID: ${id}` }, 400);
      }
    }

    try {
      const embedding = await embedder.generateEmbedding(body.content);
      const result = await insertConsolidatedObservation(pool, {
        content: body.content,
        embedding,
        bank_id: body.bank_id,
        proof_count: body.proof_count ?? Math.max(body.source_memory_ids?.length ?? 0, 1),
        source_memory_ids: body.source_memory_ids ?? [],
        source_quotes: body.source_quotes ?? {},
        tags: body.tags ?? [],
        history: body.history ?? [],
        trend: body.trend ?? null,
        trend_computed_at: body.trend_computed_at,
        project: body.project,
        created_by: body.created_by,
        archived: body.archived ?? false,
      });

      return c.json(serializeConsolidatedObservation(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Observation create failed:", message);
      return c.json(
        { error: "Failed to create observation", detail: message },
        502
      );
    }
  });

  app.post("/consolidated-observations/consolidate", async (c) => {
    const body = await c.req.json<{
      thought_ids: string[];
      project?: string;
      created_by?: string;
    }>();
    return consolidateObservation(body, c);
  });

  app.post("/consolidated-observations/search", async (c) => {
    const body = await c.req.json<{
      query: string;
      bank_id?: string;
      project?: string;
      created_by?: string;
      include_archived?: boolean;
      limit?: number;
      threshold?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }

    const limit = Math.min(Math.max(body.limit ?? 10, 1), 100);

    try {
      const embedding = await embedder.generateEmbedding(body.query);
      const results = await searchConsolidatedObservations(pool, embedding, {
        bank_id: body.bank_id,
        project: body.project,
        created_by: body.created_by,
        include_archived: body.include_archived,
        limit,
        threshold: body.threshold,
      });
      return c.json({
        query: body.query,
        count: results.length,
        results: results.map((result) => serializeConsolidatedObservation(result)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Observation search failed:", message);
      return c.json(
        { error: "Failed to search observations", detail: message },
        502
      );
    }
  });

  app.get("/consolidated-observations/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    try {
      const result = await getConsolidatedObservation(pool, id);
      if (!result) {
        return c.json({ error: `Observation not found: ${id}` }, 404);
      }
      return c.json(serializeConsolidatedObservation(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Observation fetch failed:", message);
      return c.json(
        { error: "Failed to fetch observation", detail: message },
        502
      );
    }
  });

  app.put("/consolidated-observations/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    const body = await c.req.json<{
      content?: string;
      proof_count?: number;
      source_memory_ids?: string[];
      source_quotes?: Record<string, string>;
      tags?: unknown[];
      history?: unknown[];
      trend?: (typeof CONSOLIDATED_OBSERVATION_TRENDS)[number] | null;
      trend_computed_at?: string | null;
      project?: string | null;
      archived?: boolean;
      edit_reason?: string;
    }>();

    if (body.content !== undefined && body.content.trim().length === 0) {
      return c.json({ error: "content must not be empty" }, 400);
    }
    if (body.trend !== undefined && body.trend !== null && !CONSOLIDATED_OBSERVATION_TREND_SET.has(body.trend)) {
      return c.json({ error: `trend must be one of: ${CONSOLIDATED_OBSERVATION_TRENDS.join(", ")}` }, 400);
    }
    if (body.trend_computed_at !== undefined && body.trend_computed_at !== null && !isValidTimestamp(body.trend_computed_at)) {
      return c.json({ error: "trend_computed_at must be a valid ISO timestamp" }, 400);
    }
    if (body.source_memory_ids !== undefined && !Array.isArray(body.source_memory_ids)) {
      return c.json({ error: "source_memory_ids must be an array of UUIDs" }, 400);
    }
    for (const sourceId of body.source_memory_ids ?? []) {
      if (!UUID_RE.test(sourceId)) {
        return c.json({ error: `invalid UUID: ${sourceId}` }, 400);
      }
    }

    try {
      const embedding = body.content ? await embedder.generateEmbedding(body.content) : undefined;
      const result = await updateConsolidatedObservation(pool, id, {
        content: body.content,
        embedding,
        proof_count: body.proof_count,
        source_memory_ids: body.source_memory_ids,
        source_quotes: body.source_quotes,
        tags: body.tags,
        history: body.history,
        trend: body.trend,
        trend_computed_at: body.trend_computed_at,
        project: body.project,
        archived: body.archived,
        edit_reason: body.edit_reason,
      });
      return c.json(serializeConsolidatedObservation(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Observation not found")) {
        return c.json({ error: message }, 404);
      }
      console.error("[api] Observation update failed:", message);
      return c.json(
        { error: "Failed to update observation", detail: message },
        502
      );
    }
  });

  // ─── Source Documents ─────────────────────────────────────────────

  app.post("/documents", async (c) => {
    const body = await c.req.json<{
      title: string;
      source_type: string;
      source_uri?: string;
      content: string;
      metadata?: Record<string, unknown>;
      project?: string;
      created_by?: string;
      bank_id?: string;
      document_kind?: DocumentKind;
      session_id?: string;
      task_id?: string;
      intent?: DocumentIntent;
      event_started_at?: string;
      event_ended_at?: string;
    }>();

    if (!body.title || body.title.trim().length === 0) {
      return c.json({ error: "title is required" }, 400);
    }
    if (!body.source_type || body.source_type.trim().length === 0) {
      return c.json({ error: "source_type is required" }, 400);
    }
    if (!body.content || body.content.trim().length === 0) {
      return c.json({ error: "content is required" }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.session_id !== undefined && body.session_id.trim().length === 0) {
      return c.json({ error: "session_id must not be empty" }, 400);
    }
    if (body.task_id !== undefined && body.task_id.trim().length === 0) {
      return c.json({ error: "task_id must not be empty" }, 400);
    }
    if (body.document_kind !== undefined && !DOCUMENT_KIND_SET.has(body.document_kind)) {
      return c.json({ error: `document_kind must be one of: ${DOCUMENT_KINDS.join(", ")}` }, 400);
    }
    if (body.intent !== undefined && !DOCUMENT_INTENT_SET.has(body.intent)) {
      return c.json({ error: `intent must be one of: ${DOCUMENT_INTENTS.join(", ")}` }, 400);
    }
    if (body.event_started_at !== undefined && !isValidTimestamp(body.event_started_at)) {
      return c.json({ error: "event_started_at must be a valid ISO timestamp" }, 400);
    }
    if (body.event_ended_at !== undefined && !isValidTimestamp(body.event_ended_at)) {
      return c.json({ error: "event_ended_at must be a valid ISO timestamp" }, 400);
    }

    try {
      const result = await insertDocument(pool, {
        title: body.title,
        source_type: body.source_type,
        source_uri: body.source_uri,
        content: body.content,
        metadata: body.metadata ?? {},
        project: body.project,
        created_by: body.created_by,
        bank_id: body.bank_id,
        document_kind: body.document_kind,
        session_id: body.session_id,
        task_id: body.task_id,
        intent: body.intent,
        event_started_at: body.event_started_at,
        event_ended_at: body.event_ended_at,
      });

      return c.json(serializeDocument(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document create failed:", message);
      return c.json(
        { error: "Failed to create document", detail: message },
        502
      );
    }
  });



  app.get("/documents/by-source-uri", async (c) => {
    const sourceUri = c.req.query("source_uri");
    if (!sourceUri || sourceUri.trim().length === 0) {
      return c.json({ error: "source_uri is required" }, 400);
    }

    const document = await getDocumentBySourceUri(pool, sourceUri);
    if (!document) {
      return c.json({ error: "Document not found" }, 404);
    }

    return c.json(serializeDocument(document));
  });

  app.get("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    try {
      const result = await getDocument(pool, id);
      if (!result) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }

      return c.json(serializeDocument(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document fetch failed:", message);
      return c.json(
        { error: "Failed to fetch document", detail: message },
        502
      );
    }
  });

  app.patch("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    const body = await c.req.json<{
      title?: string;
      source_uri?: string | null;
      content?: string;
      metadata?: Record<string, unknown>;
      status?: "active" | "archived" | "deleted";
      edit_reason?: string;
      updated_by?: string;
    }>();

    if (body.title !== undefined && body.title.trim().length === 0) {
      return c.json({ error: "title must not be empty" }, 400);
    }
    if (body.content !== undefined && body.content.trim().length === 0) {
      return c.json({ error: "content must not be empty" }, 400);
    }
    if (body.status !== undefined && !["active", "archived", "deleted"].includes(body.status)) {
      return c.json({ error: "status must be active, archived, or deleted" }, 400);
    }

    try {
      const result = await updateDocument(pool, id, {
        title: body.title,
        source_uri: body.source_uri,
        content: body.content,
        metadata: body.metadata,
        status: body.status,
        edit_reason: body.edit_reason,
        updated_by: body.updated_by,
      });

      return c.json(serializeDocument(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      console.error("[api] Document update failed:", message);
      return c.json(
        { error: "Failed to update document", detail: message },
        502
      );
    }
  });





  app.post("/documents/search", async (c) => {
    const body = await c.req.json<{
      query: string;
      limit?: number;
      threshold?: number;
      project?: string;
      source_type?: string;
      mode?: "vector" | "hybrid";
      vector_weight?: number;
      fts_weight?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    const mode = body.mode ?? "vector";
    if (!["vector", "hybrid"].includes(mode)) {
      return c.json({ error: "mode must be vector or hybrid" }, 400);
    }

    const limit = Math.min(Math.max(body.limit ?? 10, 1), 100);
    const threshold = body.threshold ?? 0.3;

    try {
      const embedding = await embedder.generateEmbedding(body.query);
      const results = await searchDocumentChunks(pool, embedding, {
        query: body.query,
        mode,
        limit,
        threshold,
        project: body.project,
        source_type: body.source_type,
        vector_weight: body.vector_weight,
        fts_weight: body.fts_weight,
      });

      return c.json({
        query: body.query,
        mode,
        count: results.length,
        results: results.map((chunk) => ({
          id: chunk.id,
          document_id: chunk.document_id,
          document_title: chunk.document_title,
          document_source_type: chunk.document_source_type,
          document_source_uri: chunk.document_source_uri,
          project: chunk.project,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          metadata: chunk.metadata,
          token_count: chunk.token_count,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
          similarity: chunk.similarity,
          fts_rank: chunk.fts_rank,
          score: chunk.score,
          created_at: chunk.created_at.toISOString(),
          updated_at: chunk.updated_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document search failed:", message);
      return c.json(
        { error: "Failed to search documents", detail: message },
        502
      );
    }
  });

  app.put("/documents/:id/chunks", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    const body = await c.req.json<{
      chunks: Array<{
        content: string;
        metadata?: Record<string, unknown>;
        token_count?: number;
        char_start?: number;
        char_end?: number;
      }>;
    }>();

    if (!Array.isArray(body.chunks)) {
      return c.json({ error: "chunks array is required" }, 400);
    }

    try {
      const document = await getDocument(pool, id);
      if (!document) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }

      for (const chunk of body.chunks) {
        if (!chunk.content || chunk.content.trim().length === 0) {
          return c.json({ error: "each chunk must have non-empty content" }, 400);
        }
      }

      const chunkInputs = await Promise.all(
        body.chunks.map(async (chunk, index) => ({
          chunk_index: index,
          content: chunk.content,
          embedding: await embedder.generateEmbedding(chunk.content),
          metadata: chunk.metadata ?? {},
          token_count: chunk.token_count,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
        }))
      );
      const results = await replaceDocumentChunks(pool, id, chunkInputs);

      return c.json({
        document_id: id,
        count: results.length,
        chunks: results.map((chunk) => ({
          id: chunk.id,
          document_id: chunk.document_id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          metadata: chunk.metadata,
          token_count: chunk.token_count,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
          created_at: chunk.created_at.toISOString(),
          updated_at: chunk.updated_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document chunk replace failed:", message);
      return c.json(
        { error: "Failed to replace document chunks", detail: message },
        502
      );
    }
  });

  app.get("/documents/:id/chunks", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      return c.json({ error: "id must be a valid UUID" }, 400);
    }

    try {
      const document = await getDocument(pool, id);
      if (!document) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }
      const results = await listDocumentChunks(pool, id);

      return c.json({
        document_id: id,
        count: results.length,
        chunks: results.map((chunk) => ({
          id: chunk.id,
          document_id: chunk.document_id,
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          metadata: chunk.metadata,
          token_count: chunk.token_count,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
          created_at: chunk.created_at.toISOString(),
          updated_at: chunk.updated_at.toISOString(),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document chunk list failed:", message);
      return c.json(
        { error: "Failed to list document chunks", detail: message },
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
