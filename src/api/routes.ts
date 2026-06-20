/**
 * REST API routes using Hono.
 * Provides /health, /memories, /memories/search, /memories/list, /memories/batch,
 * /memories/:id (PUT, DELETE), /stats endpoints.
 */

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type pg from "pg";

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
  listDocuments,
  getDocument,
  getDocumentBySourceUri,
  updateDocument,
  updateDocumentWithChunks,
  listDocumentRevisions,
  getDocumentRevision,
  deleteDocument,
  replaceDocumentChunks,
  extractAndLinkChunkEntities,
  listDocumentChunks,
  searchDocumentChunks,
  searchDocumentChunksByEntity,
  getDocumentChunkEmbedderVersionStats,
  listDocumentsForReindex,
  insertConsolidatedObservation,
  getConsolidatedObservation,
  searchConsolidatedObservations,
  updateConsolidatedObservation,
  insertMentalModel,
  getMentalModel,
  listMentalModels,
  searchMentalModels,
  updateMentalModel,
  enqueueConsolidationJob,
  getConsolidationJob,
  insertExperience,
  getExperience,
  listExperiences,
  searchExperiences,
  insertRecallRoutingTelemetry,
  insertMemoryLink,
  getMemoryLink,
  listMemoryLinks,
  expandMemoryLinks,
  recallTemporalMemories,
  inferExperienceTemporalLinks,
  inferSupersedesMemoryLinks,
  inferExperienceReferenceLinks,
  getMemoryBankContext,
  insertMemoryBankDirective,
  getMemoryBankDirective,
  listMemoryBankDirectives,
  updateMemoryBankDirective,
  deactivateMemoryBankDirective,
  type ListFilters,
  type BatchThoughtInput,
  type SearchResult,
  type DocumentKind,
  type DocumentIntent,
  type DocumentRow,
  type DocumentSummaryRow,
  type DocumentRevisionRow,
  type DocumentStatus,
  type DocumentChunkInput,
  type DocumentChunkRow,
  type DocumentChunkSearchResult,
  type DocumentChunkEntityOverlapResult,
  type EmbedderVersionStat,
  type ConsolidatedObservationRow,
  type ConsolidatedObservationSearchResult,
  type MentalModelRow,
  type MentalModelSearchResult,
  type ConsolidationJobRow,
  type ExperienceEventType,
  type ExperienceRow,
  type ExperienceSearchResult,
  type MemoryLinkSourceType,
  type MemoryLinkRelationship,
  type MemoryLinkRow,
  type MemoryLinkExpansionDirectionFilter,
  type MemoryLinkExpansionRow,
  type TemporalRecallRow,
  type MemoryBankDirectiveContext,
  type MemoryBankDirectiveInput,
  type MemoryBankDirectiveUpdateInput,
} from "../db/queries.js";
import { getEmbedder, resetEmbedder, getEmbedderProviders } from "../embedder/index.js";
import type { Embedder } from "../embedder/types.js";
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
import { reflectAnswer, type ReflectCascadeContext } from "./reflect.js";
import {
  shouldUseEntityRanking,
  extractQueryEntityNames,
  entityWeightedRRF,
  toEntityRankedEntityResults,
  toEntityRankedSearchResults,
} from "./entity_ranking.js";
import { extractEntities } from "./entity_extraction.js";
import { guardExperienceRetainDirectives } from "./experience_guard.js";
import { chunkMarkdown } from "../import/markdown.js";

// Search pipeline configuration — centralized in config/search.ts
import {
  HYDE_MODEL, HYDE_ENDPOINT, HYDE_ENABLED, HYDE_CONF_THRESHOLD,
  RERANK_MODEL, RERANK_ENDPOINT, RERANK_ENABLED, RERANK_TOPN,
  CROSS_ENCODER_ENABLED, DEDUP_ENABLED, DEDUP_THRESHOLD,
  SYNTHESIS_MODEL, SYNTHESIS_ENDPOINT,
} from "../config/search.js";

import { upgradeWebSocket } from "@hono/node-server";
import { registerWsClient, broadcastWsEvent, wsEvent, wsDebugLog } from "./ws-broadcaster.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate that `id` is a valid UUID; if not, return 400 from the Hono context. */
function requireUuid(c: { json: (body: unknown, status: number) => Response }, id: string | undefined): Response | null {
  if (!id || !UUID_RE.test(id)) {
    return c.json({ error: "id must be a valid UUID" }, 400);
  }
  return null;
}
const ADMIN_UUID_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ADMIN_PROTECTED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/embedder\/switch$/ },
  { method: "POST", pattern: /^\/documents$/ },
  { method: "POST", pattern: /^\/documents\/reindex-stale$/ },
  { method: "POST", pattern: /^\/documents\/reindex-all$/ },
  { method: "POST", pattern: /^\/documents\/upload$/ },
  { method: "POST", pattern: /^\/documents\/import-url$/ },
  { method: "GET", pattern: /^\/documents\/export-all$/ },
  { method: "GET", pattern: new RegExp(`^/documents/${ADMIN_UUID_SEGMENT}/export$`, "i") },
  { method: "PATCH", pattern: new RegExp(`^/documents/${ADMIN_UUID_SEGMENT}$`, "i") },
  { method: "DELETE", pattern: new RegExp(`^/documents/${ADMIN_UUID_SEGMENT}$`, "i") },
  { method: "POST", pattern: /^\/memory-bank-directives$/ },
  { method: "PATCH", pattern: new RegExp(`^/memory-bank-directives/${ADMIN_UUID_SEGMENT}$`, "i") },
  { method: "DELETE", pattern: new RegExp(`^/memory-bank-directives/${ADMIN_UUID_SEGMENT}$`, "i") },
  { method: "POST", pattern: new RegExp(`^/documents/${ADMIN_UUID_SEGMENT}/reindex$`, "i") },
  { method: "PUT", pattern: new RegExp(`^/documents/${ADMIN_UUID_SEGMENT}/chunks$`, "i") },
];

function configuredAdminApiKey(): string | undefined {
  for (const candidate of [process.env.OPENBRAIN_ADMIN_API_KEY, process.env.OPENBRAIN_ADMIN_TOKEN]) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function extractAdminApiKeys(headers: Headers): string[] {
  const candidates: string[] = [];
  const direct = headers.get("x-openbrain-admin-key")?.trim();
  if (direct) candidates.push(direct);

  const authorization = headers.get("authorization")?.trim();
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) candidates.push(bearer);
  return candidates;
}

function pathVariants(path: string): string[] {
  try {
    const decoded = decodeURIComponent(path);
    return decoded === path ? [path] : [path, decoded];
  } catch {
    return [path];
  }
}

function isAdminProtectedRequest(method: string, path: string): boolean {
  const upperMethod = method.toUpperCase();
  return pathVariants(path).some((candidate) =>
    ADMIN_PROTECTED_ROUTES.some((route) => route.method === upperMethod && route.pattern.test(candidate))
  );
}

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
const DOCUMENT_STATUSES: DocumentStatus[] = ["active", "archived", "deleted"];
const DOCUMENT_STATUS_SET = new Set<string>(DOCUMENT_STATUSES);
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


function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/<[^>]+>/g, "").trim();
  return title ? decodeHtmlEntities(title) : undefined;
}

function htmlToMarkdownLikeText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1]?.length))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeFetchedDocumentContent(raw: string, contentType: string | null): { content: string; title?: string } {
  if (contentType?.toLowerCase().includes("text/html") || /<html[\s>]/i.test(raw)) {
    return { content: htmlToMarkdownLikeText(raw), title: extractHtmlTitle(raw) };
  }
  return { content: raw };
}

async function buildDocumentChunkInputs(embedder: Embedder, content: string): Promise<DocumentChunkInput[]> {
  const markdownChunks = chunkMarkdown(content);
  return Promise.all(
    markdownChunks.map(async (chunk, index) => ({
      chunk_index: index,
      content: chunk.content,
      embedding: await embedder.generateEmbedding(chunk.content),
      metadata: { ...(chunk.metadata ?? {}), embedder_version: embedder.getVersion() },
      token_count: chunk.token_count,
      char_start: chunk.char_start,
      char_end: chunk.char_end,
    }))
  );
}

function incompatibleChunkVersions(stats: EmbedderVersionStat[], targetVersion: string): EmbedderVersionStat[] {
  return stats.filter((stat) => stat.count > 0 && stat.embedder_version !== targetVersion);
}

async function linkDocumentChunkEntities(pool: pg.Pool, chunks: DocumentChunkRow[]): Promise<void> {
  for (const chunk of chunks) {
    const entities = extractEntities(chunk.content, chunk.metadata as { people?: string[]; topics?: string[] } | undefined);
    if (entities.length > 0) {
      await extractAndLinkChunkEntities(pool, chunk.id, entities);
    }
  }
}

function serializeDocumentUpdateResponse(document: DocumentRow, reindexed: boolean, chunkCount?: number) {
  return {
    ...serializeDocument(document),
    reindexed,
    ...(chunkCount === undefined ? {} : { chunk_count: chunkCount }),
  };
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

function serializeDocumentSummary(document: DocumentSummaryRow) {
  return {
    id: document.id,
    title: document.title,
    source_type: document.source_type,
    source_uri: document.source_uri ?? null,
    content_preview: document.content_preview,
    content_char_count: document.content_char_count,
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
    chunk_count: document.chunk_count,
    revision_count: document.revision_count,
    created_at: document.created_at.toISOString(),
    updated_at: document.updated_at.toISOString(),
  };
}

function serializeDocumentRevision(revision: DocumentRevisionRow) {
  return {
    id: revision.id,
    document_id: revision.document_id,
    revision_number: revision.revision_number,
    title: revision.title,
    source_uri: revision.source_uri ?? null,
    content: revision.content,
    metadata: revision.metadata,
    status: revision.status,
    edit_reason: revision.edit_reason ?? null,
    created_by: revision.created_by ?? null,
    created_at: revision.created_at.toISOString(),
  };
}

function splitLinesForDiff(content: string): string[] {
  if (content.length === 0) return [];
  return content.split(/\r?\n/);
}

function lineLcsLength(a: string[], b: string[]): number {
  const previous = new Array<number>(b.length + 1).fill(0);
  const current = new Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    for (let j = 0; j < b.length; j++) {
      const right = b[j] ?? "";
      const diagonal = previous[j] ?? 0;
      current[j + 1] = left === right ? diagonal + 1 : Math.max(previous[j + 1] ?? 0, current[j] ?? 0);
    }
    for (let j = 0; j < current.length; j++) {
      previous[j] = current[j] ?? 0;
      current[j] = 0;
    }
  }
  return previous[b.length] ?? 0;
}

function documentRevisionDiff(document: DocumentRow, revision: DocumentRevisionRow) {
  const revisionLines = splitLinesForDiff(revision.content);
  const currentLines = splitLinesForDiff(document.content);
  const common = lineLcsLength(revisionLines, currentLines);
  const addedLines = currentLines.length - common;
  const removedLines = revisionLines.length - common;
  const metadataChanged = JSON.stringify(document.metadata ?? {}) !== JSON.stringify(revision.metadata ?? {});

  return {
    document_id: document.id,
    revision_number: revision.revision_number,
    changed: document.content !== revision.content || document.title !== revision.title || (document.source_uri ?? null) !== (revision.source_uri ?? null) || metadataChanged || document.status !== revision.status,
    old_content_chars: revision.content.length,
    current_content_chars: document.content.length,
    char_delta: document.content.length - revision.content.length,
    old_line_count: revisionLines.length,
    current_line_count: currentLines.length,
    added_lines: addedLines,
    removed_lines: removedLines,
    unchanged_lines: common,
    title_changed: document.title !== revision.title,
    source_uri_changed: (document.source_uri ?? null) !== (revision.source_uri ?? null),
    metadata_changed: metadataChanged,
    status_changed: document.status !== revision.status,
  };
}

function parseBoundedInt(value: string | undefined, name: string, min: number, max: number, defaultValue: number): { ok: true; value: number } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: defaultValue };
  if (!/^\d+$/.test(value)) return { ok: false, error: `${name} must be an integer between ${min} and ${max}` };
  const parsed = Number.parseInt(value, 10);
  if (parsed < min || parsed > max) return { ok: false, error: `${name} must be an integer between ${min} and ${max}` };
  return { ok: true, value: parsed };
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


function serializeMentalModel(model: MentalModelRow & { similarity?: number }) {
  return {
    id: model.id,
    bank_id: model.bank_id,
    name: model.name,
    query: model.query,
    content: model.content,
    structured: model.structured ?? {},
    tags: model.tags ?? [],
    trigger_tags: model.trigger_tags ?? [],
    priority: model.priority,
    refresh_meta: model.refresh_meta ?? {},
    history: model.history ?? [],
    active: model.active,
    project: model.project ?? null,
    created_by: model.created_by ?? null,
    created_at: model.created_at.toISOString(),
    updated_at: model.updated_at.toISOString(),
    ...(typeof model.similarity === "number" ? { similarity: model.similarity } : {}),
  };
}

function mentalModelEmbeddingText(name: string, query: string, content: string): string {
  return `${name}\n${query}\n${content}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isArrayValue(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function serializeMemoryBankDirective(directive: MemoryBankDirectiveContext) {
  return {
    id: directive.id,
    bank_id: directive.bank_id,
    name: directive.name,
    rule_text: directive.rule_text,
    applies_to: directive.applies_to ?? [],
    severity: directive.severity,
    active: directive.active,
    priority: directive.priority,
    revision: directive.revision,
    created_at: serializeOptionalTimestamp(directive.created_at),
    updated_at: serializeOptionalTimestamp(directive.updated_at),
  };
}

function validateDirectiveCreateBody(body: Record<string, unknown>): { ok: true; value: MemoryBankDirectiveInput } | { ok: false; error: string } {
  const name = body.name;
  const ruleText = body.rule_text;
  if (typeof name !== "string" || name.trim().length === 0) return { ok: false, error: "name is required" };
  if (typeof ruleText !== "string" || ruleText.trim().length === 0) return { ok: false, error: "rule_text is required" };
  if (body.bank_id !== undefined && (typeof body.bank_id !== "string" || body.bank_id.trim().length === 0)) return { ok: false, error: "bank_id must not be empty" };
  if (body.applies_to !== undefined && !isNonEmptyStringArray(body.applies_to)) return { ok: false, error: "applies_to must be a non-empty string array" };
  if (body.severity !== undefined && (typeof body.severity !== "string" || body.severity.trim().length === 0)) return { ok: false, error: "severity must not be empty" };
  if (body.active !== undefined && typeof body.active !== "boolean") return { ok: false, error: "active must be a boolean" };
  if (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isInteger(body.priority))) return { ok: false, error: "priority must be an integer" };
  if (body.revision !== undefined && (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1)) return { ok: false, error: "revision must be a positive integer" };

  return {
    ok: true,
    value: {
      bank_id: typeof body.bank_id === "string" ? body.bank_id : undefined,
      name,
      rule_text: ruleText,
      applies_to: body.applies_to as string[] | undefined,
      severity: typeof body.severity === "string" ? body.severity : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      revision: typeof body.revision === "number" ? body.revision : undefined,
    },
  };
}

function validateDirectiveUpdateBody(body: Record<string, unknown>): { ok: true; value: MemoryBankDirectiveUpdateInput } | { ok: false; error: string } {
  if (Object.keys(body).length === 0) return { ok: false, error: "directive patch must include at least one field" };
  if (body.bank_id !== undefined && (typeof body.bank_id !== "string" || body.bank_id.trim().length === 0)) return { ok: false, error: "bank_id must not be empty" };
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length === 0)) return { ok: false, error: "name must not be empty" };
  if (body.rule_text !== undefined && (typeof body.rule_text !== "string" || body.rule_text.trim().length === 0)) return { ok: false, error: "rule_text must not be empty" };
  if (body.applies_to !== undefined && !isNonEmptyStringArray(body.applies_to)) return { ok: false, error: "applies_to must be a non-empty string array" };
  if (body.severity !== undefined && (typeof body.severity !== "string" || body.severity.trim().length === 0)) return { ok: false, error: "severity must not be empty" };
  if (body.active !== undefined && typeof body.active !== "boolean") return { ok: false, error: "active must be a boolean" };
  if (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isInteger(body.priority))) return { ok: false, error: "priority must be an integer" };

  return {
    ok: true,
    value: {
      bank_id: typeof body.bank_id === "string" ? body.bank_id : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
      rule_text: typeof body.rule_text === "string" ? body.rule_text : undefined,
      applies_to: body.applies_to as string[] | undefined,
      severity: typeof body.severity === "string" ? body.severity : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      priority: typeof body.priority === "number" ? body.priority : undefined,
    },
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

type RecallPrimarySourceType = "thought" | "document_chunk" | "consolidated_observation" | "experience" | "mental_model";
type RecallSourceType = RecallPrimarySourceType | MemoryLinkSourceType;
type RecallSourceBalance = "score" | "balanced";
type RecallSourceRouter = "off" | "heuristic";
type RecallSourceRouterRoute = "document_only" | "thought_only" | "balanced_mixed";

interface RecallSourceRouterDecision {
  route: RecallSourceRouterRoute;
  source_types: RecallPrimarySourceType[] | null;
  source_balance: RecallSourceBalance;
  confidence: number;
  reasons: string[];
}

const RECALL_PRIMARY_SOURCE_TYPES: RecallPrimarySourceType[] = [
  "thought",
  "document_chunk",
  "consolidated_observation",
  "experience",
  "mental_model",
];
const RECALL_PRIMARY_SOURCE_TYPE_SET = new Set<string>(RECALL_PRIMARY_SOURCE_TYPES);
const RECALL_SOURCE_BALANCE_MODES: RecallSourceBalance[] = ["score", "balanced"];
const RECALL_SOURCE_BALANCE_SET = new Set<string>(RECALL_SOURCE_BALANCE_MODES);
const RECALL_SOURCE_ROUTERS: RecallSourceRouter[] = ["off", "heuristic"];
const RECALL_SOURCE_ROUTER_SET = new Set<string>(RECALL_SOURCE_ROUTERS);

type RecallTemporalLaneStatus = "stub" | "active";

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

function balanceRecallResults(results: RecallApiResult[]): RecallApiResult[] {
  const sorted = sortRecallResults([...results]);
  const buckets = new Map<RecallSourceType, RecallApiResult[]>();
  for (const result of sorted) {
    const bucket = buckets.get(result.source_type) ?? [];
    bucket.push(result);
    buckets.set(result.source_type, bucket);
  }

  const sourceOrder = [...buckets.entries()]
    .sort(([, a], [, b]) => {
      const aTop = a[0];
      const bTop = b[0];
      if (!aTop || !bTop) return 0;
      if (bTop.score !== aTop.score) return bTop.score - aTop.score;
      const aTime = aTop.created_at ? Date.parse(aTop.created_at) : 0;
      const bTime = bTop.created_at ? Date.parse(bTop.created_at) : 0;
      return bTime - aTime;
    })
    .map(([sourceType]) => sourceType);

  const balanced: RecallApiResult[] = [];
  let appended = true;
  while (appended) {
    appended = false;
    for (const sourceType of sourceOrder) {
      const next = buckets.get(sourceType)?.shift();
      if (next) {
        balanced.push(next);
        appended = true;
      }
    }
  }
  return balanced;
}

function rankRecallResults(results: RecallApiResult[], sourceBalance: RecallSourceBalance): RecallApiResult[] {
  if (sourceBalance === "balanced") {
    return balanceRecallResults(results);
  }
  return sortRecallResults(results);
}

function filterRecallResultsBySourceTypes(
  results: RecallApiResult[],
  sourceTypes: Set<RecallPrimarySourceType> | null
): RecallApiResult[] {
  if (!sourceTypes) return results;
  return results.filter((result) => sourceTypes.has(result.source_type as RecallPrimarySourceType));
}

function normalizedQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[’']/g, " ")
    .split(/[^a-z0-9.]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function matchesAnyPattern(query: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(query));
}

const RECALL_THOUGHT_QUERY_PATTERNS = [
  /\bwhat\s+did\s+(i|we)\b/,
  /\bremember\b/,
  /\bmemories?\b/,
  /\bthoughts?\b/,
  /\bi\s+(said|told|asked|mentioned)\b/,
  /\bwe\s+(decided|chose|agreed)\b/,
  /\bdecid(?:e|ed|ing|es)\b/,
  /\bmy\s+(preference|profile|memory)\b/,
];

const RECALL_DOCUMENT_REQUEST_PATTERN =
  /\b(?:find|show|open|search|list|which|what)\b.*\b(?:doc|docs|document|documents|file|files|source|sources|wiki|page|pages|markdown|note|notes|handoff|reference|references|artifact|artifacts|report|transcript)\b|\b(?:doc|docs|document|documents|file|files|source|sources|wiki|page|pages|markdown|note|notes|handoff|reference|references|artifact|artifacts|report|transcript)\b.*\b(?:titled|called|named)\b/;

const RECALL_FIRST_PERSON_PATTERN = /\b(?:i|me|my|mine|we|our|ours)\b/;
const RECALL_SUMMARY_ACTION_PATTERN = /^(?:summarize|explain|compare|show|find|recall)\b/;

const RECALL_MIXED_QUERY_PATTERNS = [
  /\bwhat\s+do\s+we\s+know\b/,
  /\bwhat\s+is\s+the\s+state\b/,
  /\bwhere\s+are\s+we\b/,
  /\bknowledge\s+stores?\b/,
];

function isTitleLikeDocumentQuery(query: string, normalized: string): boolean {
  const rawTokens = normalizedQueryTokens(query);
  if (query.includes("?") || rawTokens.length < 2 || rawTokens.length > 18) return false;
  if (matchesAnyPattern(normalized, RECALL_THOUGHT_QUERY_PATTERNS)) return false;
  if (matchesAnyPattern(normalized, RECALL_MIXED_QUERY_PATTERNS)) return false;
  if (/^(what|how|why|where|when|who|which|can|could|should|did|do|does|is|are)\b/.test(normalized)) return false;
  if (RECALL_FIRST_PERSON_PATTERN.test(normalized)) return false;
  if (RECALL_SUMMARY_ACTION_PATTERN.test(normalized)) return false;

  const titleishTokens = query.match(/[A-Za-z0-9]+/g) ?? [];
  const meaningfulTitleishTokens = titleishTokens.filter((token) => token.length > 1);
  const titleCaseTokenCount = meaningfulTitleishTokens.filter((token) => /^[A-Z]/.test(token)).length;
  const titleCaseRatio = titleCaseTokenCount / Math.max(meaningfulTitleishTokens.length, 1);
  const hasTitlePunctuation = /[—–:()]/.test(query);

  if (hasTitlePunctuation && titleCaseTokenCount >= 2) return true;
  if (meaningfulTitleishTokens.length === 2 && titleCaseTokenCount === 2) return true;
  return meaningfulTitleishTokens.length >= 3 && titleCaseTokenCount >= 2 && titleCaseRatio >= 0.5;
}

function routeRecallSourcesHeuristically(query: string): RecallSourceRouterDecision {
  const rawQuery = query.trim().replace(/\s+/g, " ");
  const normalized = rawQuery.toLowerCase();
  const reasons: string[] = [];

  if (matchesAnyPattern(normalized, RECALL_THOUGHT_QUERY_PATTERNS)) {
    reasons.push("thought_memory_cue");
    return {
      route: "thought_only",
      source_types: ["thought"],
      source_balance: "score",
      confidence: 0.85,
      reasons,
    };
  }

  if (RECALL_DOCUMENT_REQUEST_PATTERN.test(normalized)) {
    reasons.push("document_source_cue");
    return {
      route: "document_only",
      source_types: ["document_chunk"],
      source_balance: "score",
      confidence: 0.82,
      reasons,
    };
  }

  if (isTitleLikeDocumentQuery(rawQuery, normalized)) {
    reasons.push("title_like_query");
    return {
      route: "document_only",
      source_types: ["document_chunk"],
      source_balance: "score",
      confidence: 0.74,
      reasons,
    };
  }

  reasons.push(matchesAnyPattern(normalized, RECALL_MIXED_QUERY_PATTERNS) ? "mixed_query_cue" : "fallback_mixed_visibility");
  return {
    route: "balanced_mixed",
    source_types: null,
    source_balance: "balanced",
    confidence: 0.55,
    reasons,
  };
}

function recallSourceTypeSet(sourceTypes: RecallPrimarySourceType[] | null): Set<RecallPrimarySourceType> | null {
  return sourceTypes ? new Set<RecallPrimarySourceType>(sourceTypes) : null;
}

function recordRecallRouteTelemetry(
  pool: pg.Pool,
  bankId: string,
  decision: RecallSourceRouterDecision | null,
  requestedSourceTypes: Set<RecallPrimarySourceType> | null,
  sourceBalance: RecallSourceBalance,
  sourceRouter: RecallSourceRouter,
  body: { project?: string; created_by?: string }
): Promise<void> | void {
  if (!decision || sourceRouter === "off") return;
  const sourceTypes = requestedSourceTypes
    ? [...requestedSourceTypes]
    : decision.source_types ?? [];
  return insertRecallRoutingTelemetry(pool, {
    bank_id: bankId,
    source_router: sourceRouter,
    route: decision.route,
    source_balance: sourceBalance,
    source_types: sourceTypes,
    confidence: decision.confidence,
    reasons: decision.reasons,
    project: body.project,
    created_by: body.created_by,
  }).then(
    () => undefined,
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Recall route telemetry failed (non-fatal):", message);
    }
  );
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


function recallFromMentalModel(row: MentalModelSearchResult): RecallApiResult {
  const score = scoreValue(row.similarity);
  return {
    source_type: "mental_model",
    id: row.id,
    content: row.content,
    title: row.name,
    metadata: {
      ...asRecord(row.structured),
      query: row.query,
      tags: row.tags ?? [],
      trigger_tags: row.trigger_tags ?? [],
      priority: row.priority,
      refresh_meta: row.refresh_meta ?? {},
      active: row.active,
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

function recallFromTemporal(row: TemporalRecallRow): RecallApiResult {
  const score = scoreValue(row.temporal_score);
  return {
    source_type: row.source_type,
    id: row.id,
    content: row.content,
    title: row.title ?? null,
    metadata: {
      ...asRecord(row.metadata),
      event_at: serializeOptionalTimestamp(row.event_at ?? null),
      event_started_at: serializeOptionalTimestamp(row.event_started_at ?? null),
      event_ended_at: serializeOptionalTimestamp(row.event_ended_at ?? null),
    },
    project: row.project ?? null,
    created_at: serializeOptionalTimestamp(row.created_at),
    score,
    semantic_score: 0,
    bm25_score: 0,
    temporal_score: score,
    link_score: 0,
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
  app.use("*", async (c, next) => {
    const adminKey = configuredAdminApiKey();
    const path = new URL(c.req.url).pathname;
    if (!adminKey || !isAdminProtectedRequest(c.req.method, path)) {
      return next();
    }

    const providedKeys = extractAdminApiKeys(c.req.raw.headers);
    if (providedKeys.some((providedKey) => timingSafeStringEqual(providedKey, adminKey))) {
      return next();
    }

    c.header("WWW-Authenticate", 'Bearer realm="OpenBrain Admin"');
    return c.json({ error: "admin authentication required" }, 401);
  });

  // Global error handler — return structured JSON for all errors
  app.onError((err, c) => {
    console.error("[api] Unhandled error:", err.message);
    return c.json(
      { error: err.message, service: "open-brain-api" },
      500
    );
  });

  // ─── Health Check ────────────────────────────────────────────────

  app.get("/embedder/info", async (c) => {
    const embedder = getEmbedder();
    const provider = (process.env.EMBEDDER_PROVIDER ?? "ollama").toLowerCase();
    const version = embedder.getVersion();
    const chunkEmbedderVersions = await getDocumentChunkEmbedderVersionStats(pool);
    const incompatibleVersions = incompatibleChunkVersions(chunkEmbedderVersions, version);
    try {
      const probe = await embedder.generateEmbedding("probe");
      return c.json({
        provider,
        version,
        dimensions: probe.length,
        available_providers: getEmbedderProviders(),
        chunk_embedder_versions: chunkEmbedderVersions,
        reindex_required: incompatibleVersions.length > 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({
        provider,
        version,
        dimensions: null,
        available_providers: getEmbedderProviders(),
        chunk_embedder_versions: chunkEmbedderVersions,
        reindex_required: incompatibleVersions.length > 0,
        error: message,
      }, 503);
    }
  });

  app.post("/embedder/switch", async (c) => {
    const body = await c.req.json<{ provider: string; force?: boolean }>();
    if (!body.provider || typeof body.provider !== "string") {
      return c.json({ error: "provider is required" }, 400);
    }
    const available = getEmbedderProviders();
    if (!available.includes(body.provider.toLowerCase())) {
      return c.json({ error: `Unknown provider: ${body.provider}. Available: ${available.join(", ")}` }, 400);
    }

    const oldProvider = (process.env.EMBEDDER_PROVIDER ?? "ollama").toLowerCase();
    process.env.EMBEDDER_PROVIDER = body.provider.toLowerCase();
    resetEmbedder();

    try {
      const embedder = getEmbedder();
      const probe = await embedder.generateEmbedding("switch probe");
      const version = embedder.getVersion();
      const chunkEmbedderVersions = await getDocumentChunkEmbedderVersionStats(pool);
      const incompatibleVersions = incompatibleChunkVersions(chunkEmbedderVersions, version);
      const reindexRequired = incompatibleVersions.length > 0;

      if (reindexRequired && body.force !== true) {
        process.env.EMBEDDER_PROVIDER = oldProvider;
        resetEmbedder();
        return c.json({
          error: "Stored vectors are not compatible with the requested embedder; reindex or pass force=true",
          previous_provider: oldProvider,
          requested_provider: body.provider.toLowerCase(),
          version,
          dimensions: probe.length,
          chunk_embedder_versions: chunkEmbedderVersions,
          incompatible_versions: incompatibleVersions,
          reindex_required: true,
          rolled_back_to: oldProvider,
        }, 409);
      }

      return c.json({
        previous_provider: oldProvider,
        current_provider: body.provider.toLowerCase(),
        version,
        dimensions: probe.length,
        chunk_embedder_versions: chunkEmbedderVersions,
        reindex_required: reindexRequired,
        forced: body.force === true,
      });
    } catch (err) {
      // Roll back on failure
      process.env.EMBEDDER_PROVIDER = oldProvider;
      resetEmbedder();
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Failed to initialize new embedder", detail: message, rolled_back_to: oldProvider }, 502);
    }
  });

  app.get("/health", (c) =>
    c.json({ status: "healthy", service: "open-brain-api" })
  );
  // ─── WebSocket real-time updates ────────────────────────────────
  app.get("/ws", upgradeWebSocket((_c) => {
    return {
      onOpen(_evt, ws) {
        const unregister = registerWsClient(ws);
        wsDebugLog("[ws] Client connected");
        (ws.raw as unknown as { on?: (event: string, cb: () => void) => void })?.on?.("close", () => {
          unregister();
          wsDebugLog("[ws] Client disconnected");
        });
      },
      onMessage(_evt, ws) {
        // Clients can send ping messages to keep the connection alive
        try {
          const data = typeof _evt.data === "string" ? _evt.data : new TextDecoder().decode(_evt.data as ArrayBuffer);
          if (data === "ping") {
            ws.send("pong");
          }
        } catch {
          // ignore malformed messages
        }
      },
      onClose(_evt, _ws) {
        wsDebugLog("[ws] Client closed");
      },
      onError(_evt, _ws) {
        console.error("[ws] Client error");
      },
    };
  }));


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
            toEntityRankedEntityResults(entityResultsRaw),
            [toEntityRankedSearchResults(denseFused), toEntityRankedSearchResults(bm25Results)],
            fusedLimit
          )
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
      include_mental_models?: boolean;
      source_types?: unknown;
      source_balance?: string;
      source_router?: string;
      expand_from_seeds?: Array<{ source_type?: string; source_id?: string }>;
      link_direction?: string;
      link_relationship?: string;
      time_start?: string;
      time_end?: string;
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
    if (body.include_mental_models !== undefined && typeof body.include_mental_models !== "boolean") {
      return c.json({ error: "include_mental_models must be a boolean" }, 400);
    }
    const sourceRouter = body.source_router ?? "off";
    if (!RECALL_SOURCE_ROUTER_SET.has(sourceRouter)) {
      return c.json({ error: `source_router must be one of: ${RECALL_SOURCE_ROUTERS.join(", ")}` }, 400);
    }
    let requestedSourceTypes: Set<RecallPrimarySourceType> | null = null;
    if (body.source_types !== undefined) {
      if (!Array.isArray(body.source_types) || body.source_types.length === 0) {
        return c.json({ error: "source_types must be a non-empty array when provided" }, 400);
      }
      if (body.source_types.length > RECALL_PRIMARY_SOURCE_TYPES.length) {
        return c.json({ error: `source_types must contain no more than ${RECALL_PRIMARY_SOURCE_TYPES.length} entries` }, 400);
      }
      requestedSourceTypes = new Set<RecallPrimarySourceType>();
      for (const sourceType of body.source_types) {
        if (typeof sourceType !== "string" || !RECALL_PRIMARY_SOURCE_TYPE_SET.has(sourceType)) {
          return c.json({ error: `source_types entries must be one of: ${RECALL_PRIMARY_SOURCE_TYPES.join(", ")}` }, 400);
        }
        requestedSourceTypes.add(sourceType as RecallPrimarySourceType);
      }
    }
    const sourceRouterDecision = sourceRouter === "heuristic"
      ? routeRecallSourcesHeuristically(body.query)
      : null;
    if (requestedSourceTypes === null && sourceRouterDecision?.source_types) {
      requestedSourceTypes = recallSourceTypeSet(sourceRouterDecision.source_types);
    }
    const sourceBalance = body.source_balance ?? sourceRouterDecision?.source_balance ?? "score";
    if (!RECALL_SOURCE_BALANCE_SET.has(sourceBalance)) {
      return c.json({ error: `source_balance must be one of: ${RECALL_SOURCE_BALANCE_MODES.join(", ")}` }, 400);
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isFinite(body.limit))) {
      return c.json({ error: "limit must be a finite number" }, 400);
    }
    if (body.threshold !== undefined && (typeof body.threshold !== "number" || !Number.isFinite(body.threshold))) {
      return c.json({ error: "threshold must be a finite number" }, 400);
    }
    if (body.time_start !== undefined && !isValidTimestamp(body.time_start)) {
      return c.json({ error: "time_start must be a valid timestamp" }, 400);
    }
    if (body.time_end !== undefined && !isValidTimestamp(body.time_end)) {
      return c.json({ error: "time_end must be a valid timestamp" }, 400);
    }
    if (
      body.time_start !== undefined &&
      body.time_end !== undefined &&
      Date.parse(body.time_start) > Date.parse(body.time_end)
    ) {
      return c.json({ error: "time_start must be before or equal to time_end" }, 400);
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
    const sourceTypeAllows = (sourceType: RecallPrimarySourceType): boolean =>
      requestedSourceTypes === null || requestedSourceTypes.has(sourceType);
    const includeThoughts = sourceTypeAllows("thought");
    const includeDocuments = sourceTypeAllows("document_chunk") && (body.include_documents ?? true);
    const includeObservations = sourceTypeAllows("consolidated_observation") && (body.include_observations ?? true);
    const includeExperiences = sourceTypeAllows("experience") && (body.include_experiences ?? true);
    const includeMentalModels = sourceTypeAllows("mental_model") && (
      body.include_mental_models ?? (requestedSourceTypes?.has("mental_model") ?? false)
    );
    const temporalEnabled = body.time_start !== undefined || body.time_end !== undefined;
    const filter: Record<string, unknown> = {};
    if (body.type) filter.type = body.type;
    if (body.topic) filter.topics = [body.topic];

    const chunkGraphQueryEntities = includeDocuments ? extractQueryEntityNames(body.query) : [];
    const chunkGraphEnabled = chunkGraphQueryEntities.length > 0;

    try {
      const queryEmbedding = await embedder.generateEmbedding(body.query);
      const [semanticResults, bm25Results, documentResults, chunkGraphResults, observationResults, experienceResults, mentalModelResults, linkResults, temporalResults] = await Promise.all([
        includeThoughts
          ? searchThoughts(
              pool, queryEmbedding, limit, threshold, filter,
              body.project, body.include_archived, body.created_by
            )
          : Promise.resolve([]),
        includeThoughts
          ? bm25SearchThoughts(
              pool, body.query, limit, filter,
              body.project, body.include_archived, body.created_by
            )
          : Promise.resolve([]),
        includeDocuments
          ? searchDocumentChunks(pool, queryEmbedding, {
              query: body.query,
              mode: "hybrid",
              limit,
              threshold,
              project: body.project,
            })
          : Promise.resolve([]),
        chunkGraphEnabled
          ? searchDocumentChunksByEntity(pool, chunkGraphQueryEntities, {
              limit,
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
        includeMentalModels
          ? searchMentalModels(pool, queryEmbedding, {
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
        temporalEnabled
          ? recallTemporalMemories(pool, {
              bank_id: bankId,
              project: body.project,
              created_by: body.created_by,
              time_start: body.time_start,
              time_end: body.time_end,
              include_archived: body.include_archived ?? false,
              limit,
            })
          : Promise.resolve([]),
      ]);

      const recallResults = new Map<string, RecallApiResult>();
      semanticResults.forEach((row) => upsertRecallResult(recallResults, recallFromThought(row, "semantic")));
      bm25Results.forEach((row) => upsertRecallResult(recallResults, recallFromThought(row, "bm25")));
      documentResults.forEach((row) => upsertRecallResult(recallResults, recallFromDocumentChunk(row)));
      chunkGraphResults.forEach((row) => upsertRecallResult(recallResults, recallFromDocumentChunk(row)));
      observationResults.forEach((row) => upsertRecallResult(recallResults, recallFromObservation(row)));
      experienceResults.forEach((row) => upsertRecallResult(recallResults, recallFromExperience(row)));
      mentalModelResults.forEach((row) => upsertRecallResult(recallResults, recallFromMentalModel(row)));
      linkResults.forEach((row) => upsertRecallResult(recallResults, recallFromMemoryLink(row)));
      temporalResults.forEach((row) => upsertRecallResult(recallResults, recallFromTemporal(row)));

      const filteredResults = filterRecallResultsBySourceTypes([...recallResults.values()], requestedSourceTypes);
      const results = rankRecallResults(filteredResults, sourceBalance as RecallSourceBalance).slice(0, limit);

      recordRecallRouteTelemetry(
        pool,
        bankId,
        sourceRouterDecision,
        requestedSourceTypes,
        sourceBalance as RecallSourceBalance,
        sourceRouter as RecallSourceRouter,
        { project: body.project, created_by: body.created_by }
      );

      return c.json({
        query: body.query,
        bank_id: bankId,
        count: results.length,
        lanes: {
          semantic: includeThoughts,
          bm25: includeThoughts,
          documents: includeDocuments,
          observations: includeObservations,
          experiences: includeExperiences,
          mental_models: includeMentalModels,
          source_types: requestedSourceTypes ? [...requestedSourceTypes] : null,
          source_balance: sourceBalance,
          source_router: sourceRouter,
          source_router_decision: sourceRouterDecision,
          link_expansion: seeds.length > 0,
          chunk_graph: chunkGraphEnabled
            ? {
                status: "active",
                query_entities: chunkGraphQueryEntities,
                result_count: chunkGraphResults.length,
                max_overlap: chunkGraphResults.reduce(
                  (m: number, r: DocumentChunkEntityOverlapResult) => Math.max(m, r.overlap_count),
                  0
                ),
              }
            : { status: "stub", query_entities: [], result_count: 0, max_overlap: 0 },
          temporal: (temporalEnabled ? "active" : "stub") as RecallTemporalLaneStatus,
        },
        results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Recall failed:", message);
      return c.json({ error: "Failed to recall memories", detail: message }, 502);
    }
  });

  // ─── Reflect (Hindsight 3-tier cascade) ──────────────────────────

  app.post("/reflect", async (c) => {
    const body = await c.req.json<{
      query?: string;
      bank_id?: string;
      project?: string;
      created_by?: string;
      model_hint?: string;
      top_k?: number;
      threshold?: number;
      include_sources?: boolean;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    if (body.top_k !== undefined && (!Number.isInteger(body.top_k) || body.top_k < 1 || body.top_k > 20)) {
      return c.json({ error: "top_k must be an integer between 1 and 20" }, 400);
    }
    if (body.threshold !== undefined && (typeof body.threshold !== "number" || body.threshold < 0 || body.threshold > 1)) {
      return c.json({ error: "threshold must be a number between 0 and 1" }, 400);
    }

    const bankId = body.bank_id ?? "openbrain";
    const topK = body.top_k ?? 3;
    const threshold = body.threshold ?? 0.3;
    const reflectModel = body.model_hint ?? SYNTHESIS_MODEL;
    const started = Date.now();
    const telemetry: Record<string, unknown> = { model: reflectModel, bank_id: bankId };

    try {
      const pool = getPool();
      const embedder = getEmbedder();
      const embedStart = Date.now();
      const queryEmbedding = await embedder.generateEmbedding(body.query);
      telemetry.embedding_ms = Date.now() - embedStart;

      const searchStart = Date.now();
      const [mentalModelHits, observationHits, rawFactHits, memoryBank] = await Promise.all([
        searchMentalModels(pool, queryEmbedding, {
          bank_id: bankId,
          project: body.project,
          created_by: body.created_by,
          limit: topK,
          threshold,
        }),
        searchConsolidatedObservations(pool, queryEmbedding, {
          bank_id: bankId,
          project: body.project,
          created_by: body.created_by,
          limit: topK,
          threshold,
        }),
        searchThoughts(pool, queryEmbedding, topK, threshold, {}, body.project, false, body.created_by),
        getMemoryBankContext(pool, bankId, "reflect"),
      ]);
      telemetry.search_ms = Date.now() - searchStart;

      // ─── Staleness check: mark mental models whose refresh_meta.next_refresh_after is past ───
      const now = new Date();
      const mentalModels = mentalModelHits.map((row) => {
        const refreshMeta = row.refresh_meta as Record<string, unknown> | null ?? {};
        const nextRefresh = typeof refreshMeta.next_refresh_after === "string"
          ? refreshMeta.next_refresh_after
          : null;
        const stale = nextRefresh !== null && new Date(nextRefresh) < now;
        return {
          id: row.id,
          name: row.name,
          query: row.query,
          content: row.content,
          structured: row.structured,
          tags: row.tags,
          trigger_tags: row.trigger_tags,
          priority: row.priority,
          refresh_meta: row.refresh_meta,
          stale,
          project: row.project ?? null,
          created_by: row.created_by ?? null,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
          similarity: row.similarity,
        };
      });

      const observations = observationHits.map((row) => ({
        id: row.id,
        content: row.content,
        proof_count: row.proof_count,
        tags: row.tags ?? [],
        trend: row.trend ?? null,
        project: row.project ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        similarity: row.similarity,
      }));

      const rawFacts = rawFactHits.map((row) => ({
        id: row.id,
        content: row.content,
        type: row.metadata?.type ?? null,
        topics: row.metadata?.topics ?? [],
        project: row.project ?? null,
        created_at: row.created_at.toISOString(),
        similarity: row.similarity,
      }));

      const cascade: ReflectCascadeContext = {
        mental_models: mentalModelHits.map((row) => ({
          id: row.id,
          label: row.name ?? null,
          content: row.content,
        })),
        consolidated_observations: observationHits.map((row) => ({
          id: row.id,
          label: null,
          content: row.content,
        })),
        raw_facts: rawFactHits.map((row) => ({
          id: row.id,
          label: null,
          content: row.content,
        })),
      };

      const llmStart = Date.now();
      const answer = await reflectAnswer(body.query, cascade, {
        endpoint: SYNTHESIS_ENDPOINT,
        model: reflectModel,
        memoryBank: memoryBank
          ? {
              id: memoryBank.id,
              name: memoryBank.name,
              mission: memoryBank.mission,
              disposition: memoryBank.disposition,
              directives: (memoryBank.directives ?? []).map((d) => ({
                id: d.id,
                name: d.name,
                rule_text: d.rule_text,
                severity: d.severity,
                priority: d.priority,
              })),
            }
          : undefined,
      });
      telemetry.llm_ms = Date.now() - llmStart;

      telemetry.total_ms = Date.now() - started;
      telemetry.mental_model_count = mentalModels.length;
      telemetry.observation_count = observations.length;
      telemetry.raw_fact_count = rawFacts.length;
      telemetry.stale_mental_models = mentalModels.filter((m) => m.stale).map((m) => m.id);

      const includeSources = body.include_sources !== false;
      const evidenceCount = mentalModels.length + observations.length + rawFacts.length;

      const responseBody: Record<string, unknown> = {
        query: body.query,
        bank_id: bankId,
        evidence_count: evidenceCount,
        model_used: reflectModel,
        answer,
        reflect_telemetry: telemetry,
      };

      if (includeSources) {
        responseBody.cascade = cascade;
        responseBody.mental_models = mentalModels;
        responseBody.observations = observations;
        responseBody.raw_facts = rawFacts;
        responseBody.memory_bank = memoryBank
          ? {
              id: memoryBank.id,
              name: memoryBank.name,
              mission: memoryBank.mission,
              disposition: memoryBank.disposition,
              directives: (memoryBank.directives ?? []).map((d) => ({
                id: d.id,
                name: d.name,
                severity: d.severity,
                priority: d.priority,
              })),
            }
          : null;
      }

      return c.json(responseBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Reflect failed:", message);
      return c.json({ error: "Failed to reflect", detail: message }, 502);
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

    const badId = requireUuid(c, id); if (badId) return badId;

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

    const badId = requireUuid(c, id); if (badId) return badId;

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
    const badId = requireUuid(c, id); if (badId) return badId;
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



  // ─── Memory Bank Directives ─────────────────────────────────────────

  app.post("/memory-bank-directives", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const validation = validateDirectiveCreateBody(body);
    if (!validation.ok) return c.json({ error: validation.error }, 400);

    try {
      const result = await insertMemoryBankDirective(pool, validation.value);
      return c.json(serializeMemoryBankDirective(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory bank directive create failed:", message);
      return c.json({ error: "Failed to create directive", detail: message }, 502);
    }
  });

  app.get("/memory-bank-directives", async (c) => {
    const bankId = c.req.query("bank_id") ?? "openbrain";
    if (bankId.trim().length === 0) return c.json({ error: "bank_id must not be empty" }, 400);
    const activeQuery = c.req.query("active");
    const active = parseOptionalBoolean(activeQuery);
    if (activeQuery !== undefined && active === undefined) return c.json({ error: "active must be true or false" }, 400);

    try {
      const results = await listMemoryBankDirectives(pool, {
        bank_id: bankId,
        active,
        applies_to: c.req.query("applies_to"),
        severity: c.req.query("severity"),
        limit: parseBoundedLimit(c.req.query("limit"), 50, 100),
      });
      return c.json({ count: results.length, directives: results.map(serializeMemoryBankDirective) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory bank directive list failed:", message);
      return c.json({ error: "Failed to list directives", detail: message }, 502);
    }
  });

  app.get("/memory-bank-directives/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const result = await getMemoryBankDirective(pool, id);
      if (!result) return c.json({ error: `Directive not found: ${id}` }, 404);
      return c.json(serializeMemoryBankDirective(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory bank directive fetch failed:", message);
      return c.json({ error: "Failed to fetch directive", detail: message }, 502);
    }
  });

  app.patch("/memory-bank-directives/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;
    const body = await c.req.json<Record<string, unknown>>();
    const validation = validateDirectiveUpdateBody(body);
    if (!validation.ok) return c.json({ error: validation.error }, 400);

    try {
      const result = await updateMemoryBankDirective(pool, id, validation.value);
      if (!result) return c.json({ error: `Directive not found: ${id}` }, 404);
      return c.json(serializeMemoryBankDirective(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory bank directive update failed:", message);
      return c.json({ error: "Failed to update directive", detail: message }, 502);
    }
  });

  app.delete("/memory-bank-directives/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const result = await deactivateMemoryBankDirective(pool, id);
      if (!result) return c.json({ error: `Directive not found: ${id}` }, 404);
      return c.json(serializeMemoryBankDirective(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Memory bank directive delete failed:", message);
      return c.json({ error: "Failed to delete directive", detail: message }, 502);
    }
  });


  // ─── Mental Models ────────────────────────────────────────────────────

  app.post("/mental-models/search", async (c) => {
    const body = await c.req.json<{
      query?: string;
      bank_id?: string;
      project?: string;
      created_by?: string;
      trigger_tag?: string;
      include_inactive?: boolean;
      limit?: number;
      threshold?: number;
    }>();

    if (!body.query || body.query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) {
      return c.json({ error: "bank_id must not be empty" }, 400);
    }
    if (body.include_inactive !== undefined && typeof body.include_inactive !== "boolean") {
      return c.json({ error: "include_inactive must be a boolean" }, 400);
    }
    if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isFinite(body.limit))) {
      return c.json({ error: "limit must be a finite number" }, 400);
    }
    if (body.threshold !== undefined && (typeof body.threshold !== "number" || !Number.isFinite(body.threshold))) {
      return c.json({ error: "threshold must be a finite number" }, 400);
    }

    try {
      const embedding = await embedder.generateEmbedding(body.query);
      const results = await searchMentalModels(pool, embedding, {
        bank_id: body.bank_id ?? "openbrain",
        project: body.project,
        created_by: body.created_by,
        trigger_tag: body.trigger_tag,
        include_inactive: body.include_inactive ?? false,
        limit: parseBodyLimit(body.limit, 10, 100),
        threshold: body.threshold ?? parseFloat(process.env.OPENBRAIN_SEARCH_THRESHOLD ?? "0.3"),
      });
      return c.json({ count: results.length, results: results.map(serializeMentalModel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Mental model search failed:", message);
      return c.json({ error: "Failed to search mental models", detail: message }, 502);
    }
  });

  app.post("/mental-models", async (c) => {
    const body = await c.req.json<{
      bank_id?: string;
      name?: string;
      query?: string;
      content?: string;
      structured?: Record<string, unknown>;
      tags?: unknown[];
      trigger_tags?: unknown[];
      priority?: number;
      refresh_meta?: Record<string, unknown>;
      history?: unknown[];
      active?: boolean;
      project?: string;
      created_by?: string;
    }>();

    if (!body.name || body.name.trim().length === 0) return c.json({ error: "name is required" }, 400);
    if (!body.query || body.query.trim().length === 0) return c.json({ error: "query is required" }, 400);
    if (!body.content || body.content.trim().length === 0) return c.json({ error: "content is required" }, 400);
    if (body.bank_id !== undefined && body.bank_id.trim().length === 0) return c.json({ error: "bank_id must not be empty" }, 400);
    if (body.structured !== undefined && !isPlainRecord(body.structured)) return c.json({ error: "structured must be an object" }, 400);
    if (body.refresh_meta !== undefined && !isPlainRecord(body.refresh_meta)) return c.json({ error: "refresh_meta must be an object" }, 400);
    if (body.tags !== undefined && !isArrayValue(body.tags)) return c.json({ error: "tags must be an array" }, 400);
    if (body.trigger_tags !== undefined && !isArrayValue(body.trigger_tags)) return c.json({ error: "trigger_tags must be an array" }, 400);
    if (body.history !== undefined && !isArrayValue(body.history)) return c.json({ error: "history must be an array" }, 400);
    if (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isFinite(body.priority))) return c.json({ error: "priority must be a finite number" }, 400);
    if (body.active !== undefined && typeof body.active !== "boolean") return c.json({ error: "active must be a boolean" }, 400);

    try {
      const embedding = await embedder.generateEmbedding(mentalModelEmbeddingText(body.name, body.query, body.content));
      const result = await insertMentalModel(pool, {
        bank_id: body.bank_id ?? "openbrain",
        name: body.name,
        query: body.query,
        content: body.content,
        embedding,
        structured: body.structured ?? {},
        tags: body.tags ?? [],
        trigger_tags: body.trigger_tags ?? [],
        priority: body.priority ?? 0,
        refresh_meta: body.refresh_meta ?? {},
        history: body.history ?? [],
        active: body.active ?? true,
        project: body.project,
        created_by: body.created_by,
      });
      return c.json(serializeMentalModel(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Mental model create failed:", message);
      return c.json({ error: "Failed to create mental model", detail: message }, 502);
    }
  });

  app.get("/mental-models", async (c) => {
    const includeInactive = parseOptionalBoolean(c.req.query("include_inactive"));
    if (c.req.query("include_inactive") !== undefined && includeInactive === undefined) {
      return c.json({ error: "include_inactive must be true or false" }, 400);
    }
    const bankId = c.req.query("bank_id") ?? "openbrain";
    if (bankId.trim().length === 0) return c.json({ error: "bank_id must not be empty" }, 400);

    try {
      const results = await listMentalModels(pool, {
        bank_id: bankId,
        project: c.req.query("project"),
        created_by: c.req.query("created_by"),
        trigger_tag: c.req.query("trigger_tag"),
        include_inactive: includeInactive ?? false,
        limit: parseBoundedLimit(c.req.query("limit"), 50, 100),
      });
      return c.json({ count: results.length, results: results.map(serializeMentalModel) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Mental model list failed:", message);
      return c.json({ error: "Failed to list mental models", detail: message }, 502);
    }
  });

  app.get("/mental-models/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const result = await getMentalModel(pool, id);
      if (!result) return c.json({ error: `Mental model not found: ${id}` }, 404);
      return c.json(serializeMentalModel(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Mental model fetch failed:", message);
      return c.json({ error: "Failed to fetch mental model", detail: message }, 502);
    }
  });

  app.put("/mental-models/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;
    const body = await c.req.json<{
      name?: string;
      query?: string;
      content?: string;
      structured?: Record<string, unknown>;
      tags?: unknown[];
      trigger_tags?: unknown[];
      priority?: number;
      refresh_meta?: Record<string, unknown>;
      history?: unknown[];
      active?: boolean;
      project?: string | null;
      created_by?: string | null;
    }>();

    if (body.name !== undefined && body.name.trim().length === 0) return c.json({ error: "name must not be empty" }, 400);
    if (body.query !== undefined && body.query.trim().length === 0) return c.json({ error: "query must not be empty" }, 400);
    if (body.content !== undefined && body.content.trim().length === 0) return c.json({ error: "content must not be empty" }, 400);
    if (body.structured !== undefined && !isPlainRecord(body.structured)) return c.json({ error: "structured must be an object" }, 400);
    if (body.refresh_meta !== undefined && !isPlainRecord(body.refresh_meta)) return c.json({ error: "refresh_meta must be an object" }, 400);
    if (body.tags !== undefined && !isArrayValue(body.tags)) return c.json({ error: "tags must be an array" }, 400);
    if (body.trigger_tags !== undefined && !isArrayValue(body.trigger_tags)) return c.json({ error: "trigger_tags must be an array" }, 400);
    if (body.history !== undefined && !isArrayValue(body.history)) return c.json({ error: "history must be an array" }, 400);
    if (body.priority !== undefined && (typeof body.priority !== "number" || !Number.isFinite(body.priority))) return c.json({ error: "priority must be a finite number" }, 400);
    if (body.active !== undefined && typeof body.active !== "boolean") return c.json({ error: "active must be a boolean" }, 400);

    try {
      const existing = await getMentalModel(pool, id);
      if (!existing) return c.json({ error: `Mental model not found: ${id}` }, 404);
      const nextName = body.name ?? existing.name;
      const nextQuery = body.query ?? existing.query;
      const nextContent = body.content ?? existing.content;
      const embedding = (body.name !== undefined || body.query !== undefined || body.content !== undefined)
        ? await embedder.generateEmbedding(mentalModelEmbeddingText(nextName, nextQuery, nextContent))
        : undefined;
      const result = await updateMentalModel(pool, id, {
        name: body.name,
        query: body.query,
        content: body.content,
        embedding,
        structured: body.structured,
        tags: body.tags,
        trigger_tags: body.trigger_tags,
        priority: body.priority,
        refresh_meta: body.refresh_meta,
        history: body.history,
        active: body.active,
        project: body.project,
        created_by: body.created_by,
      });
      return c.json(serializeMentalModel(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) return c.json({ error: message }, 404);
      console.error("[api] Mental model update failed:", message);
      return c.json({ error: "Failed to update mental model", detail: message }, 502);
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
    const badId = requireUuid(c, id); if (badId) return badId;
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
        const badId = requireUuid(c, id); if (badId) return badId;
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
        const badId = requireUuid(c, id); if (badId) return badId;
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
    const badId = requireUuid(c, id); if (badId) return badId;
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
    const badId = requireUuid(c, id); if (badId) return badId;
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
      const badId = requireUuid(c, id); if (badId) return badId;
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
      const badId = requireUuid(c, id); if (badId) return badId;
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
    const badId = requireUuid(c, id); if (badId) return badId;

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
    const badId = requireUuid(c, id); if (badId) return badId;

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

  app.get("/documents", async (c) => {
    const limit = parseBoundedInt(c.req.query("limit"), "limit", 1, 100, 50);
    if (!limit.ok) return c.json({ error: limit.error }, 400);
    const offset = parseBoundedInt(c.req.query("offset"), "offset", 0, 100000, 0);
    if (!offset.ok) return c.json({ error: offset.error }, 400);

    const status = c.req.query("status") as DocumentStatus | undefined;
    if (status !== undefined && !DOCUMENT_STATUS_SET.has(status)) {
      return c.json({ error: `status must be one of: ${DOCUMENT_STATUSES.join(", ")}` }, 400);
    }
    const documentKind = c.req.query("document_kind") as DocumentKind | undefined;
    if (documentKind !== undefined && !DOCUMENT_KIND_SET.has(documentKind)) {
      return c.json({ error: `document_kind must be one of: ${DOCUMENT_KINDS.join(", ")}` }, 400);
    }
    const intent = c.req.query("intent") as DocumentIntent | undefined;
    if (intent !== undefined && !DOCUMENT_INTENT_SET.has(intent)) {
      return c.json({ error: `intent must be one of: ${DOCUMENT_INTENTS.join(", ")}` }, 400);
    }
    const includeDeleted = c.req.query("include_deleted") === "true";

    try {
      const documents = await listDocuments(pool, {
        project: c.req.query("project"),
        source_type: c.req.query("source_type"),
        status,
        created_by: c.req.query("created_by"),
        bank_id: c.req.query("bank_id"),
        document_kind: documentKind,
        intent,
        q: c.req.query("q"),
        include_deleted: includeDeleted,
        limit: limit.value,
        offset: offset.value,
      });
      return c.json({
        count: documents.length,
        limit: limit.value,
        offset: offset.value,
        documents: documents.map(serializeDocumentSummary),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document list failed:", message);
      return c.json({ error: "Failed to list documents", detail: message }, 502);
    }
  });

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

      broadcastWsEvent(wsEvent("document_created", result.id));
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



  async function handleBulkDocumentReindex(c: Context, staleOnly: boolean) {
    const body = (await c.req.json<{ dry_run?: boolean; limit?: number }>().catch(() => ({}))) as { dry_run?: boolean; limit?: number };
    const dryRun = body.dry_run === true;
    const limit = Math.max(1, Math.min(Number.isFinite(body.limit ?? 25) ? Number(body.limit ?? 25) : 25, 100));
    const targetVersion = embedder.getVersion();
    const candidates = await listDocumentsForReindex(pool, { targetVersion, staleOnly, limit });
    const documents = candidates.map((document) => ({ id: document.id, title: document.title, updated_at: serializeOptionalTimestamp(document.updated_at) }));

    if (dryRun) {
      return c.json({
        mode: staleOnly ? "stale" : "all",
        dry_run: true,
        target_embedder_version: targetVersion,
        count: candidates.length,
        documents,
      });
    }

    const reindexed: Array<{ id: string; title: string; chunk_count: number }> = [];
    const failed: Array<{ id: string; title: string; error: string }> = [];

    for (const document of candidates) {
      try {
        const chunkInputs = await buildDocumentChunkInputs(embedder, document.content);
        const result = await updateDocumentWithChunks(
          pool,
          document.id,
          { edit_reason: staleOnly ? "bulk stale reindex" : "bulk full reindex", updated_by: "bulk-reindex" },
          chunkInputs
        );
        await linkDocumentChunkEntities(pool, result.chunks);
        reindexed.push({ id: document.id, title: document.title, chunk_count: result.chunks.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ id: document.id, title: document.title, error: message });
      }
    }

    return c.json({
      mode: staleOnly ? "stale" : "all",
      dry_run: false,
      target_embedder_version: targetVersion,
      count: candidates.length,
      reindexed,
      failed,
    });
  }

  app.post("/documents/reindex-stale", (c) => handleBulkDocumentReindex(c, true));

  app.post("/documents/reindex-all", (c) => handleBulkDocumentReindex(c, false));

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


  // ─── Export Endpoints ─────────────────────────────────────────────

  app.get("/documents/export-all", async (c) => {
    try {
      const documents = await listDocuments(pool, { status: "active", limit: 100, offset: 0 });
      const bundle = {
        version: 1,
        exported_at: new Date().toISOString(),
        documents: documents.map(serializeDocumentSummary),
      };
      c.header("Content-Disposition", 'attachment; filename="openbrain-export.json"');
      c.header("Content-Type", "application/json");
      return c.json(bundle);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Export-all failed:", message);
      return c.json({ error: "Failed to export documents", detail: message }, 502);
    }
  });

  app.get("/documents/:id/export", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const result = await getDocument(pool, id);
      if (!result) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }

      const filename = (result.title || "document").replace(/[^a-zA-Z0-9_-]/g, "_") + ".md";
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(result.content, 200, { "Content-Type": "text/markdown; charset=utf-8" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document export failed:", message);
      return c.json({ error: "Failed to export document", detail: message }, 502);
    }
  });

  app.get("/documents/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

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

  app.get("/documents/:id/revisions", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const document = await getDocument(pool, id);
      if (!document) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }
      const revisions = await listDocumentRevisions(pool, id);
      return c.json({
        document_id: id,
        count: revisions.length,
        revisions: revisions.map(serializeDocumentRevision),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document revision list failed:", message);
      return c.json({ error: "Failed to list document revisions", detail: message }, 502);
    }
  });

  app.get("/documents/:id/revisions/:revision_number/diff", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;
    const revisionNumber = parseBoundedInt(c.req.param("revision_number"), "revision_number", 1, 1000000, 1);
    if (!revisionNumber.ok) return c.json({ error: revisionNumber.error }, 400);

    try {
      const document = await getDocument(pool, id);
      if (!document) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }
      const revision = await getDocumentRevision(pool, id, revisionNumber.value);
      if (!revision) {
        return c.json({ error: `Document revision not found: ${id}#${revisionNumber.value}` }, 404);
      }
      return c.json({
        document_id: id,
        revision_number: revisionNumber.value,
        revision: serializeDocumentRevision(revision),
        current: serializeDocument(document),
        diff: documentRevisionDiff(document, revision),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document revision diff failed:", message);
      return c.json({ error: "Failed to diff document revision", detail: message }, 502);
    }
  });

  app.patch("/documents/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

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

    const patch = {
      title: body.title,
      source_uri: body.source_uri,
      content: body.content,
      metadata: body.metadata,
      status: body.status,
      edit_reason: body.edit_reason,
      updated_by: body.updated_by,
    };

    try {
      if (body.content !== undefined) {
        let chunkInputs: DocumentChunkInput[];
        try {
          chunkInputs = await buildDocumentChunkInputs(embedder, body.content);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[api] Document reindex failed before update:", message);
          return c.json(
            { error: "Failed to reindex document", detail: message, reindexed: false },
            502
          );
        }

        const { document, chunks } = await updateDocumentWithChunks(pool, id, patch, chunkInputs);
        await linkDocumentChunkEntities(pool, chunks);
        broadcastWsEvent(wsEvent("document_updated", document.id, { reindexed: true }));
        broadcastWsEvent(wsEvent("revision_added", document.id));
        return c.json(serializeDocumentUpdateResponse(document, true, chunks.length));
      }

      const result = await updateDocument(pool, id, patch);
      broadcastWsEvent(wsEvent("document_updated", result.id, { reindexed: false }));
      return c.json(serializeDocumentUpdateResponse(result, false));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        return c.json({ error: message }, 404);
      }
      console.error("[api] Document update failed:", message);
      return c.json(
        { error: body.content !== undefined ? "Failed to update and reindex document" : "Failed to update document", detail: message, reindexed: false },
        502
      );
    }
  });





  app.delete("/documents/:id", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const result = await deleteDocument(pool, id);
      if (!result.deleted) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }
      broadcastWsEvent(wsEvent("document_deleted", id));
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document delete failed:", message);
      return c.json({ error: "Failed to delete document", detail: message }, 502);
    }
  });

  app.post("/documents/:id/reindex", async (c) => {
    const id = c.req.param("id");
    const badId = requireUuid(c, id); if (badId) return badId;

    try {
      const document = await getDocument(pool, id);
      if (!document) {
        return c.json({ error: `Document not found: ${id}` }, 404);
      }

      let chunkInputs: DocumentChunkInput[];
      try {
        chunkInputs = await buildDocumentChunkInputs(embedder, document.content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[api] Document reindex failed:", message);
        return c.json(
          { error: "Failed to reindex document", detail: message, reindexed: false },
          502
        );
      }

      const { document: updated, chunks } = await updateDocumentWithChunks(pool, id, {
        content: document.content,
        edit_reason: "manual reindex",
      }, chunkInputs);
      await linkDocumentChunkEntities(pool, chunks);
      broadcastWsEvent(wsEvent("document_reindexed", updated.id));
      return c.json(serializeDocumentUpdateResponse(updated, true, chunks.length));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document reindex failed:", message);
      return c.json(
        { error: "Failed to reindex document", detail: message, reindexed: false },
        502
      );
    }
  });

  app.post("/documents/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || !(file instanceof File)) {
      return c.json({ error: "file is required and must be a file upload" }, 400);
    }
    const project = typeof body["project"] === "string" ? body["project"] : undefined;
    const createdBy = typeof body["created_by"] === "string" ? body["created_by"] : undefined;
    const content = await file.text();
    const title = file.name.replace(/\.[^/.]+$/, "") || "untitled";

    try {
      const document = await insertDocument(pool, {
        title,
        source_type: "markdown",
        source_uri: `file:///uploads/${file.name}`,
        content,
        project: project ?? "default",
        created_by: createdBy ?? "upload",
      });

      let chunkInputs: DocumentChunkInput[];
      try {
        chunkInputs = await buildDocumentChunkInputs(embedder, content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[api] Document upload reindex failed:", message);
        return c.json(
          { error: "Document created but reindex failed", detail: message, reindexed: false, ...serializeDocument(document) },
          201,
        );
      }
      const { document: updated, chunks } = await updateDocumentWithChunks(pool, document.id, { content }, chunkInputs);
      await linkDocumentChunkEntities(pool, chunks);
      broadcastWsEvent(wsEvent("document_created", updated.id));
      return c.json({ ...serializeDocumentUpdateResponse(updated, true, chunks.length) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document upload failed:", message);
      return c.json({ error: "Failed to upload document", detail: message }, 502);
    }
  });

  app.post("/documents/import-url", async (c) => {
    const body = await c.req.json<{ url: string; title?: string; project?: string; created_by?: string }>();
    if (!body.url || typeof body.url !== "string") {
      return c.json({ error: "url is required" }, 400);
    }

    const existing = await getDocumentBySourceUri(pool, body.url);
    if (existing) {
      return c.json({
        error: "URL already imported",
        existing_document: {
          id: existing.id,
          title: existing.title,
          source_uri: existing.source_uri,
          updated_at: serializeOptionalTimestamp(existing.updated_at),
        },
      }, 409);
    }

    let fetchedContent: string;
    let contentType: string | null = null;
    try {
      const response = await fetch(body.url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        return c.json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` }, 502);
      }
      contentType = response.headers.get("content-type");
      const rawContent = await response.text();
      const normalized = normalizeFetchedDocumentContent(rawContent, contentType);
      fetchedContent = normalized.content;
      body.title = body.title ?? normalized.title;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "Failed to fetch URL", detail: message }, 502);
    }

    const title = body.title ?? new URL(body.url).pathname.split("/").filter(Boolean).pop() ?? "imported-document";

    try {
      const document = await insertDocument(pool, {
        title,
        source_type: "url",
        source_uri: body.url,
        content: fetchedContent,
        metadata: { content_type: contentType, imported_from: "url" },
        project: body.project ?? "default",
        created_by: body.created_by ?? "import",
      });

      let chunkInputs: DocumentChunkInput[];
      try {
        chunkInputs = await buildDocumentChunkInputs(embedder, fetchedContent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[api] Document import reindex failed:", message);
        return c.json(
          { error: "Document created but reindex failed", detail: message, reindexed: false, ...serializeDocument(document) },
          201,
        );
      }
      const { document: updated, chunks } = await updateDocumentWithChunks(pool, document.id, { content: fetchedContent }, chunkInputs);
      await linkDocumentChunkEntities(pool, chunks);
      broadcastWsEvent(wsEvent("document_created", updated.id));
      await linkDocumentChunkEntities(pool, chunks);
      return c.json({ ...serializeDocumentUpdateResponse(updated, true, chunks.length) }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[api] Document import failed:", message);
      return c.json({ error: "Failed to import document", detail: message }, 502);
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
    const badId = requireUuid(c, id); if (badId) return badId;

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
      for (const chunk of results) {
        const entities = extractEntities(chunk.content, chunk.metadata as { people?: string[]; topics?: string[] } | undefined);
        if (entities.length > 0) {
          await extractAndLinkChunkEntities(pool, chunk.id, entities);
        }
      }

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
    const badId = requireUuid(c, id); if (badId) return badId;

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
