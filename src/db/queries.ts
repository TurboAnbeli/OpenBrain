/**
 * Database queries for thoughts: insert, search, list, stats.
 * All queries use parameterized SQL (no interpolation).
 *
 * ─── ryel-local: column-level encryption ────────────────────────────
 * `thoughts.content` (plaintext) was replaced by `thoughts.content_enc`
 * (bytea, pgcrypto AES via PGP message format). Every read decrypts via
 * pgp_sym_decrypt(content_enc, $cipher_key); every write encrypts via
 * pgp_sym_encrypt($plaintext, $cipher_key). The cipher key is loaded
 * once at boot from CIPHER_KEY_PATH (see connection.ts:getCipherKey).
 */

import type pg from "pg";
import { getCipherKey } from "./connection.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ThoughtMetadata {
  type?: string;
  topics?: string[];
  people?: string[];
  action_items?: string[];
  dates?: string[];
  source?: string;
  consolidates?: string[];
}

export interface ThoughtRow {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  project?: string | null;
  created_by?: string | null;
  archived?: boolean;
  supersedes?: string | null;
  proof_count: number;
  created_at: Date;
}

export interface SearchResult extends ThoughtRow {
  similarity: number;
}

// ─── Source Documents ───────────────────────────────────────────────

export type DocumentStatus = "active" | "archived" | "deleted";
export type DocumentKind =
  | "article"
  | "handoff"
  | "decision"
  | "reflection"
  | "research"
  | "postmortem"
  | "reference"
  | "project_note"
  | "journal"
  | "clipping";
export type DocumentIntent = "durable_knowledge" | "operational_log" | "transitional_archive";
export type DocumentTimestampInput = string | Date;

export interface DocumentMetadata {
  [key: string]: unknown;
}

export interface DocumentInput {
  title: string;
  source_type: string;
  source_uri?: string;
  content: string;
  metadata?: DocumentMetadata;
  project?: string;
  created_by?: string;
  bank_id?: string;
  document_kind?: DocumentKind;
  session_id?: string;
  task_id?: string;
  intent?: DocumentIntent;
  event_started_at?: DocumentTimestampInput;
  event_ended_at?: DocumentTimestampInput;
}

export interface DocumentRow {
  id: string;
  title: string;
  source_type: string;
  source_uri?: string | null;
  content: string;
  metadata: DocumentMetadata;
  project?: string | null;
  created_by?: string | null;
  bank_id?: string | null;
  document_kind?: DocumentKind | null;
  session_id?: string | null;
  task_id?: string | null;
  intent?: DocumentIntent | null;
  event_started_at?: Date | null;
  event_ended_at?: Date | null;
  status: DocumentStatus;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentSummaryRow {
  id: string;
  title: string;
  source_type: string;
  source_uri?: string | null;
  content_preview: string;
  content_char_count: number;
  metadata: DocumentMetadata;
  project?: string | null;
  created_by?: string | null;
  bank_id?: string | null;
  document_kind?: DocumentKind | null;
  session_id?: string | null;
  task_id?: string | null;
  intent?: DocumentIntent | null;
  event_started_at?: Date | null;
  event_ended_at?: Date | null;
  status: DocumentStatus;
  chunk_count: number;
  revision_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentListOptions {
  project?: string;
  source_type?: string;
  status?: DocumentStatus;
  created_by?: string;
  bank_id?: string;
  document_kind?: DocumentKind;
  intent?: DocumentIntent;
  q?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface DocumentRevisionRow {
  id: string;
  document_id: string;
  revision_number: number;
  title: string;
  source_uri?: string | null;
  content: string;
  metadata: DocumentMetadata;
  status: DocumentStatus;
  edit_reason?: string | null;
  created_by?: string | null;
  created_at: Date;
}

export interface DocumentUpdateInput {
  title?: string;
  source_uri?: string | null;
  content?: string;
  metadata?: DocumentMetadata;
  status?: DocumentStatus;
  edit_reason?: string;
  updated_by?: string;
}

export interface DocumentChunkInput {
  chunk_index: number;
  content: string;
  embedding: number[];
  metadata?: DocumentMetadata;
  token_count?: number;
  char_start?: number;
  char_end?: number;
}

export interface EmbedderVersionStat {
  embedder_version: string;
  count: number;
}

export interface DocumentChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: DocumentMetadata;
  token_count?: number | null;
  char_start?: number | null;
  char_end?: number | null;
  created_at: Date;
  updated_at: Date;
}

export type DocumentChunkSearchMode = "vector" | "hybrid";

export interface DocumentChunkSearchOptions {
  query?: string;
  mode?: DocumentChunkSearchMode;
  limit?: number;
  threshold?: number;
  project?: string;
  source_type?: string;
  vector_weight?: number;
  fts_weight?: number;
}

export interface DocumentChunkSearchResult extends DocumentChunkRow {
  document_title: string;
  document_source_type: string;
  document_source_uri?: string | null;
  project?: string | null;
  similarity: number;
  fts_rank: number;
  score: number;
}

export interface DocumentChunkEntityOverlapResult extends DocumentChunkSearchResult {
  overlap_count: number;
}

export interface DocumentChunkEntityOverlapOptions {
  limit?: number;
  project?: string;
}

// ─── Consolidated Observations ─────────────────────────────────────────────────────

export type ConsolidatedObservationTrend = "strengthening" | "stable" | "weakening" | "stale";
export type ConsolidatedObservationTimestampInput = string | Date;

export interface ConsolidatedObservationInput {
  content: string;
  embedding: number[];
  bank_id?: string;
  proof_count?: number;
  source_memory_ids?: string[];
  source_quotes?: Record<string, string>;
  tags?: unknown[];
  history?: unknown[];
  trend?: ConsolidatedObservationTrend | null;
  trend_computed_at?: ConsolidatedObservationTimestampInput | null;
  project?: string;
  created_by?: string;
  archived?: boolean;
}

export interface ConsolidatedObservationRow {
  id: string;
  bank_id?: string | null;
  content: string;
  proof_count: number;
  source_memory_ids: string[];
  source_quotes?: Record<string, string>;
  tags: unknown[];
  history: unknown[];
  trend?: ConsolidatedObservationTrend | null;
  trend_computed_at?: Date | null;
  project?: string | null;
  created_by?: string | null;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ConsolidatedObservationSearchOptions {
  bank_id?: string;
  project?: string;
  created_by?: string;
  include_archived?: boolean;
  limit?: number;
  threshold?: number;
}

export interface ConsolidatedObservationSearchResult extends ConsolidatedObservationRow {
  similarity: number;
}

export interface ConsolidatedObservationUpdateInput {
  content?: string;
  embedding?: number[];
  proof_count?: number;
  source_memory_ids?: string[];
  source_quotes?: Record<string, string>;
  tags?: unknown[];
  history?: unknown[];
  trend?: ConsolidatedObservationTrend | null;
  trend_computed_at?: ConsolidatedObservationTimestampInput | null;
  project?: string | null;
  archived?: boolean;
  edit_reason?: string;
}


// ─── Mental Models ────────────────────────────────────────────────────

export interface MentalModelInput {
  name: string;
  query: string;
  content: string;
  embedding: number[];
  bank_id?: string;
  structured?: Record<string, unknown>;
  tags?: unknown[];
  trigger_tags?: unknown[];
  priority?: number;
  refresh_meta?: Record<string, unknown>;
  history?: unknown[];
  active?: boolean;
  project?: string;
  created_by?: string;
}

export interface MentalModelRow {
  id: string;
  bank_id: string;
  name: string;
  query: string;
  content: string;
  structured: Record<string, unknown>;
  tags: unknown[];
  trigger_tags: unknown[];
  priority: number;
  refresh_meta: Record<string, unknown>;
  history: unknown[];
  active: boolean;
  project?: string | null;
  created_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MentalModelListOptions {
  bank_id?: string;
  project?: string;
  created_by?: string;
  trigger_tag?: string;
  include_inactive?: boolean;
  limit?: number;
}

export interface MentalModelSearchOptions extends MentalModelListOptions {
  threshold?: number;
}

export interface MentalModelSearchResult extends MentalModelRow {
  similarity: number;
}

export interface MentalModelUpdateInput {
  name?: string;
  query?: string;
  content?: string;
  embedding?: number[];
  structured?: Record<string, unknown>;
  tags?: unknown[];
  trigger_tags?: unknown[];
  priority?: number;
  refresh_meta?: Record<string, unknown>;
  history?: unknown[];
  active?: boolean;
  project?: string | null;
  created_by?: string | null;
}

// ─── Experiences ─────────────────────────────────────────────────────

export type ExperienceEventType =
  | "tool_call"
  | "user_message"
  | "assistant_message"
  | "decide"
  | "external_inbox";

export type ExperienceTimestampInput = string | Date;

export interface ExperienceInput {
  content: string;
  embedding: number[];
  event_type: ExperienceEventType;
  bank_id?: string;
  session_id?: string;
  agent_id?: string;
  occurred_at?: ExperienceTimestampInput;
  refs?: Record<string, unknown>;
  project?: string;
  created_by?: string;
}

export interface ExperienceRow {
  id: string;
  bank_id: string;
  session_id?: string | null;
  agent_id?: string | null;
  occurred_at: Date;
  event_type: ExperienceEventType;
  content: string;
  refs: Record<string, unknown>;
  project?: string | null;
  created_by?: string | null;
  created_at: Date;
}

export interface ExperienceListOptions {
  bank_id?: string;
  session_id?: string;
  agent_id?: string;
  event_type?: ExperienceEventType;
  project?: string;
  created_by?: string;
  limit?: number;
}

export interface ExperienceSearchOptions extends ExperienceListOptions {
  threshold?: number;
}

export interface ExperienceSearchResult extends ExperienceRow {
  similarity: number;
}

// ─── Memory Links ────────────────────────────────────────────────────

export type MemoryLinkSourceType =
  | "thought"
  | "document"
  | "chunk"
  | "consolidated_observation"
  | "experience"
  | "mental_model";

export type MemoryLinkRelationship =
  | "temporal_after"
  | "temporal_before"
  | "causal_cause"
  | "causal_effect"
  | "semantic_similar"
  | "entity_co"
  | "supersedes"
  | "evidence_for";

export interface MemoryLinkInput {
  bank_id?: string;
  source_type: MemoryLinkSourceType;
  source_id: string;
  target_type: MemoryLinkSourceType;
  target_id: string;
  relationship: MemoryLinkRelationship;
  weight?: number;
  inferred?: boolean;
}

export interface MemoryLinkRow {
  id: string;
  bank_id: string;
  source_type: MemoryLinkSourceType;
  source_id: string;
  target_type: MemoryLinkSourceType;
  target_id: string;
  relationship: MemoryLinkRelationship;
  weight: number;
  inferred: boolean;
  created_at: Date;
}

export interface MemoryLinkListOptions {
  bank_id?: string;
  source_type?: MemoryLinkSourceType;
  source_id?: string;
  target_type?: MemoryLinkSourceType;
  target_id?: string;
  relationship?: MemoryLinkRelationship;
  inferred?: boolean;
  limit?: number;
}

export interface MemoryLinkInferOptions {
  bank_id?: string;
  session_id?: string;
}

export interface MemoryLinkSeed {
  source_type: MemoryLinkSourceType;
  source_id: string;
}

export type MemoryLinkExpansionDirection = "incoming" | "outgoing";
export type MemoryLinkExpansionDirectionFilter = MemoryLinkExpansionDirection | "both";

export interface MemoryLinkExpandOptions {
  bank_id?: string;
  seeds: MemoryLinkSeed[];
  direction?: MemoryLinkExpansionDirectionFilter;
  relationship?: MemoryLinkRelationship;
  include_archived?: boolean;
  limit?: number;
}

export interface MemoryLinkExpansionRow extends MemoryLinkRow {
  seed_type: MemoryLinkSourceType;
  seed_id: string;
  direction: MemoryLinkExpansionDirection;
  linked_type: MemoryLinkSourceType;
  linked_id: string;
  linked_content?: string | null;
  linked_title?: string | null;
  linked_metadata?: Record<string, unknown> | null;
  linked_project?: string | null;
  linked_created_at?: Date | null;
}

export type TemporalRecallSourceType = "thought" | "document" | "experience";

export interface TemporalRecallOptions {
  bank_id?: string;
  project?: string;
  created_by?: string;
  time_start?: string | Date;
  time_end?: string | Date;
  include_archived?: boolean;
  limit?: number;
}

export interface TemporalRecallRow {
  source_type: TemporalRecallSourceType;
  id: string;
  content: string;
  title?: string | null;
  metadata: Record<string, unknown>;
  project?: string | null;
  event_at?: Date | null;
  event_started_at?: Date | null;
  event_ended_at?: Date | null;
  created_at: Date;
  temporal_score: number;
}

// ─── Consolidation Jobs ─────────────────────────────────────────────

export type ConsolidationJobType =
  | "observe_thoughts"
  | "observe_documents"
  | "observe"
  | "supersede"
  | "refresh_model"
  | "reindex"
  | "retain_extract";

export type ConsolidationJobStatus = "queued" | "running" | "success" | "error";

export interface ConsolidationJobInputPayload {
  thought_ids?: string[];
  document_ids?: string[];
  source_uris?: string[];
  project?: string;
  created_by?: string;
  [key: string]: unknown;
}

export interface ConsolidationJobEnqueueInput {
  job_type: ConsolidationJobType;
  bank_id?: string;
  input: ConsolidationJobInputPayload;
}

export interface ConsolidationJobRow {
  id: string;
  bank_id: string;
  job_type: ConsolidationJobType;
  status: ConsolidationJobStatus;
  input: ConsolidationJobInputPayload | null;
  output: Record<string, unknown> | null;
  error?: string | null;
  started_at?: Date | null;
  finished_at?: Date | null;
  attempts: number;
  created_at: Date;
}

export interface MemoryBankDirectiveContext {
  id: string;
  bank_id: string;
  name: string;
  rule_text: string;
  applies_to: string[];
  severity: string;
  active: boolean;
  priority: number;
  revision: number;
  created_at?: Date | null;
  updated_at?: Date | null;
}

export interface MemoryBankContext {
  id: string;
  name: string;
  mission?: string | null;
  disposition: Record<string, unknown>;
  project?: string | null;
  directives: MemoryBankDirectiveContext[];
}

export interface ThoughtStats {
  total_thoughts: number;
  types: Record<string, number>;
  top_topics: [string, number][];
  top_people: [string, number][];
  date_range: { earliest: string | null; latest: string | null };
}

export interface ListFilters {
  type?: string;
  topic?: string;
  person?: string;
  days?: number;
  project?: string;
  created_by?: string;
  include_archived?: boolean;
  limit?: number;
}

// ─── Insert ──────────────────────────────────────────────────────────

export async function insertThought(
  pool: pg.Pool,
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata,
  project?: string,
  supersedes?: string,
  created_by?: string
): Promise<ThoughtRow> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const key = getCipherKey();

  const { rows } = await pool.query<ThoughtRow>(
    `INSERT INTO thoughts (content_enc, embedding, metadata, project, supersedes, created_by, fts)
     VALUES (pgp_sym_encrypt($1, $7), $2::vector, $3::jsonb, $4, $5, $6, to_tsvector('english', $1))
     RETURNING id,
               pgp_sym_decrypt(content_enc, $7)::text AS content,
               metadata, project, created_by, archived, supersedes, proof_count, created_at`,
    [
      content,
      embeddingStr,
      JSON.stringify(metadata),
      project ?? null,
      supersedes ?? null,
      created_by ?? null,
      key,
    ]
  );

  return rows[0]!;
}

// ─── Semantic Search ─────────────────────────────────────────────────

export async function searchThoughts(
  pool: pg.Pool,
  queryEmbedding: number[],
  limit: number = 10,
  threshold: number = 0.5,
  filter: Record<string, unknown> = {},
  project?: string,
  include_archived?: boolean,
  created_by?: string
): Promise<SearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const key = getCipherKey();

  const { rows } = await pool.query<SearchResult>(
    // match_thoughts() signature was extended to take cipher_key as the
    // second positional parameter (see migration 003). It returns content
    // already decrypted, so callers see the same shape as before.
    `SELECT id, content, metadata, similarity, proof_count, created_at
     FROM match_thoughts($1::vector, $8, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      embeddingStr,
      threshold,
      limit,
      JSON.stringify(filter),
      project ?? null,
      include_archived ?? false,
      created_by ?? null,
      key,
    ]
  );

  return rows;
}

// ─── Filtered List ───────────────────────────────────────────────────

export async function listThoughts(
  pool: pg.Pool,
  filters: ListFilters,
  limit: number = 50
): Promise<ThoughtRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (filters.type) {
    idx++;
    conditions.push(`metadata->>'type' = $${idx}`);
    params.push(filters.type);
  }

  if (filters.topic) {
    idx++;
    conditions.push(`metadata->'topics' ? $${idx}`);
    params.push(filters.topic);
  }

  if (filters.person) {
    idx++;
    conditions.push(`metadata->'people' ? $${idx}`);
    params.push(filters.person);
  }

  if (filters.days) {
    idx++;
    const since = new Date();
    since.setDate(since.getDate() - filters.days);
    conditions.push(`created_at >= $${idx}`);
    params.push(since.toISOString());
  }

  if (filters.project) {
    idx++;
    conditions.push(`project = $${idx}`);
    params.push(filters.project);
  }

  if (filters.created_by) {
    idx++;
    conditions.push(`created_by = $${idx}`);
    params.push(filters.created_by);
  }

  if (!filters.include_archived) {
    conditions.push(`(archived = false OR archived IS NULL)`);
  }

  idx++;
  params.push(limit);

  // Cipher key is the last bound parameter — pgp_sym_decrypt reads it
  // by position. listThoughts builds parameters dynamically so we append
  // and reference it with $${idx + 1}.
  idx++;
  params.push(getCipherKey());

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";

  const { rows } = await pool.query<ThoughtRow>(
    `SELECT id,
            pgp_sym_decrypt(content_enc, $${idx})::text AS content,
            metadata, created_by, created_at
     FROM thoughts
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${idx - 1}`,
    params
  );

  return rows;
}

// ─── Statistics ──────────────────────────────────────────────────────

export async function getThoughtStats(
  pool: pg.Pool,
  project?: string,
  created_by?: string
): Promise<ThoughtStats> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (project) {
    idx++;
    conditions.push(`project = $${idx}`);
    params.push(project);
  }
  if (created_by) {
    idx++;
    conditions.push(`created_by = $${idx}`);
    params.push(created_by);
  }

  const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  // Build the AND clause for joined queries (use t. prefix)
  const joinConditions = [];
  let jIdx = 0;
  if (project) {
    jIdx++;
    joinConditions.push(`t.project = $${jIdx}`);
  }
  if (created_by) {
    jIdx++;
    joinConditions.push(`t.created_by = $${jIdx}`);
  }
  const joinAndClause = joinConditions.length > 0 ? "AND " + joinConditions.join(" AND ") : "";

  // Total count
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM thoughts ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  // Type distribution
  const typeResult = await pool.query<{ thought_type: string; count: string }>(
    `SELECT metadata->>'type' AS thought_type, COUNT(*)::text AS count
     FROM thoughts t
     WHERE TRUE ${joinAndClause}
     GROUP BY metadata->>'type'
     ORDER BY COUNT(*) DESC`,
    params
  );
  const types: Record<string, number> = {};
  for (const row of typeResult.rows) {
    types[row.thought_type ?? "unknown"] = parseInt(row.count, 10);
  }

  // Top topics
  const topicResult = await pool.query<{ topic: string; count: string }>(
    `SELECT topic, COUNT(*)::text AS count
     FROM thoughts t, jsonb_array_elements_text(t.metadata->'topics') AS topic
     WHERE TRUE ${joinAndClause}
     GROUP BY topic
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
    params
  );
  const topTopics: [string, number][] = topicResult.rows.map((r) => [
    r.topic,
    parseInt(r.count, 10),
  ]);

  // Top people
  const peopleResult = await pool.query<{ person: string; count: string }>(
    `SELECT person, COUNT(*)::text AS count
     FROM thoughts t, jsonb_array_elements_text(t.metadata->'people') AS person
     WHERE TRUE ${joinAndClause}
     GROUP BY person
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
    params
  );
  const topPeople: [string, number][] = peopleResult.rows.map((r) => [
    r.person,
    parseInt(r.count, 10),
  ]);

  // Date range
  const rangeResult = await pool.query<{ earliest: Date | null; latest: Date | null }>(
    `SELECT MIN(created_at) AS earliest, MAX(created_at) AS latest FROM thoughts ${whereClause}`,
    params
  );
  const range = rangeResult.rows[0];

  return {
    total_thoughts: total,
    types,
    top_topics: topTopics,
    top_people: topPeople,
    date_range: {
      earliest: range?.earliest?.toISOString() ?? null,
      latest: range?.latest?.toISOString() ?? null,
    },
  };
}

// ─── Update ──────────────────────────────────────────────────────────

export async function updateThought(
  pool: pg.Pool,
  id: string,
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata
): Promise<ThoughtRow> {
  const embeddingStr = `[${embedding.join(",")}]`;
  const key = getCipherKey();

  const { rows, rowCount } = await pool.query<ThoughtRow>(
    `UPDATE thoughts
     SET content_enc = pgp_sym_encrypt($2, $5),
         embedding = $3::vector,
         metadata = $4::jsonb,
         fts = to_tsvector('english', $2)
     WHERE id = $1
     RETURNING id,
               pgp_sym_decrypt(content_enc, $5)::text AS content,
               metadata, project, archived, supersedes, created_at`,
    [id, content, embeddingStr, JSON.stringify(metadata), key]
  );

  if (!rowCount || rowCount === 0) {
    throw new Error(`Thought not found: ${id}`);
  }

  return rows[0]!;
}

// ─── Delete ──────────────────────────────────────────────────────────

export async function deleteThought(
  pool: pg.Pool,
  id: string
): Promise<{ deleted: boolean; id: string }> {
  // Clear supersedes references pointing to this thought first
  await pool.query(
    `UPDATE thoughts SET supersedes = NULL WHERE supersedes = $1`,
    [id]
  );

  const { rowCount } = await pool.query(
    `DELETE FROM thoughts WHERE id = $1`,
    [id]
  );

  return { deleted: (rowCount ?? 0) > 0, id };
}

// ─── BM25 Full-Text Search ───────────────────────────────────────────

export async function bm25SearchThoughts(
  pool: pg.Pool,
  queryText: string,
  limit: number = 10,
  filter: Record<string, unknown> = {},
  project?: string,
  include_archived?: boolean,
  created_by?: string
): Promise<SearchResult[]> {
  const key = getCipherKey();

  const { rows } = await pool.query<{
    id: string;
    content: string;
    metadata: ThoughtMetadata;
    bm25_rank: number;
    proof_count: number;
    created_at: Date;
  }>(
    `SELECT id, content, metadata, bm25_rank, proof_count, created_at
     FROM bm25_search_thoughts($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      queryText,
      key,
      limit,
      JSON.stringify(filter),
      project ?? null,
      include_archived ?? false,
      created_by ?? null,
    ]
  );

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    similarity: r.bm25_rank,
    proof_count: r.proof_count,
    created_at: r.created_at,
  }));
}

// ─── FTS Backfill ────────────────────────────────────────────────────

export async function backfillFts(pool: pg.Pool): Promise<number> {
  const key = getCipherKey();
  const { rowCount } = await pool.query(
    `UPDATE thoughts
     SET fts = to_tsvector('english', pgp_sym_decrypt(content_enc, $1))
     WHERE fts IS NULL`,
    [key]
  );
  return rowCount ?? 0;
}

// ─── Deduplication ───────────────────────────────────────────────────

export async function findNearDuplicate(
  pool: pg.Pool,
  embedding: number[],
  project?: string,
  created_by?: string,
  threshold: number = 0.95
): Promise<{ id: string; similarity: number } | null> {
  const embeddingStr = `[${embedding.join(",")}]`;

  const { rows } = await pool.query<{ id: string; similarity: number }>(
    `SELECT id, similarity
     FROM find_near_duplicate($1::vector, $2, $3, $4)`,
    [embeddingStr, threshold, project ?? null, created_by ?? null]
  );

  return rows[0] ?? null;
}

export async function bumpProofCount(
  pool: pg.Pool,
  id: string
): Promise<ThoughtRow> {
  const key = getCipherKey();

  const { rows, rowCount } = await pool.query<ThoughtRow>(
    `UPDATE thoughts
     SET proof_count = proof_count + 1
     WHERE id = $1
     RETURNING id,
               pgp_sym_decrypt(content_enc, $2)::text AS content,
               metadata, project, created_by, archived, supersedes, proof_count, created_at`,
    [id, key]
  );

  if (!rowCount || rowCount === 0) {
    throw new Error(`Thought not found: ${id}`);
  }

  return rows[0]!;
}

// ─── Consolidation Helpers ───────────────────────────────────────────

export async function getThoughtsByIds(
  pool: pg.Pool,
  ids: string[]
): Promise<ThoughtRow[]> {
  if (ids.length === 0) return [];
  const key = getCipherKey();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  const { rows } = await pool.query<ThoughtRow>(
    `SELECT id,
            pgp_sym_decrypt(content_enc, $1)::text AS content,
            metadata, project, created_by, archived, supersedes, proof_count, created_at
     FROM thoughts
     WHERE id IN (${placeholders}) AND archived = false`,
    [key, ...ids]
  );
  return rows;
}

export async function archiveThoughts(
  pool: pg.Pool,
  ids: string[]
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const { rowCount } = await pool.query(
    `UPDATE thoughts SET archived = true WHERE id IN (${placeholders})`,
    ids
  );
  return rowCount ?? 0;
}

// ─── Batch Insert ────────────────────────────────────────────────────

export interface BatchThoughtInput {
  content: string;
  embedding: number[];
  metadata: ThoughtMetadata;
  project?: string;
  created_by?: string;
}

export async function batchInsertThoughts(
  pool: pg.Pool,
  thoughts: BatchThoughtInput[]
): Promise<ThoughtRow[]> {
  const client = await pool.connect();
  const results: ThoughtRow[] = [];
  const key = getCipherKey();

  try {
    await client.query("BEGIN");

    for (const thought of thoughts) {
      const embeddingStr = `[${thought.embedding.join(",")}]`;

      const { rows } = await client.query<ThoughtRow>(
        `INSERT INTO thoughts (content_enc, embedding, metadata, project, created_by, fts)
         VALUES (pgp_sym_encrypt($1, $6), $2::vector, $3::jsonb, $4, $5, to_tsvector('english', $1))
         RETURNING id,
                   pgp_sym_decrypt(content_enc, $6)::text AS content,
                   metadata, project, created_by, archived, supersedes, proof_count, created_at`,
        [
          thought.content,
          embeddingStr,
          JSON.stringify(thought.metadata),
          thought.project ?? null,
          thought.created_by ?? null,
          key,
        ]
      );

      results.push(rows[0]!);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return results;
}

// ─── Entity Graph Queries ──────────────────────────────────────────────

export interface EntityRow {
  id: string;
  name: string;
  type: string;
  aliases?: string[];
}

export async function upsertEntity(
  pool: pg.Pool,
  name: string,
  type: string,
  aliases?: string[]
): Promise<EntityRow> {
  const { rows } = await pool.query<EntityRow>(
    `INSERT INTO entities (name, type, aliases)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (name, type) DO UPDATE SET
       aliases = EXCLUDED.aliases
     RETURNING id, name, type, aliases`,
    [name, type, JSON.stringify(aliases ?? [])]
  );
  return rows[0]!;
}

export async function linkThoughtEntity(
  pool: pg.Pool,
  thoughtId: string,
  entityId: string,
  relationship: string = "mentions",
  weight: number = 1.0
): Promise<void> {
  await pool.query(
    `INSERT INTO thought_entities (thought_id, entity_id, relationship, weight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thought_id, entity_id) DO NOTHING`,
    [thoughtId, entityId, relationship, weight]
  );
}

/** Upsert entities and link them to a thought in one transaction. */
export async function extractAndLinkEntities(
  pool: pg.Pool,
  thoughtId: string,
  entities: Array<{ name: string; type: string; aliases?: string[] }>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const e of entities) {
      const row = await client.query<EntityRow>(
        `INSERT INTO entities (name, type, aliases)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (name, type) DO UPDATE SET
           aliases = EXCLUDED.aliases
         RETURNING id, name, type, aliases`,
        [e.name, e.type, JSON.stringify(e.aliases ?? [])]
      );
      const entityId = row.rows[0]!.id;
      await client.query(
        `INSERT INTO thought_entities (thought_id, entity_id, relationship, weight)
         VALUES ($1, $2, 'mentions', 1.0)
         ON CONFLICT (thought_id, entity_id) DO NOTHING`,
        [thoughtId, entityId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function extractAndLinkChunkEntities(
  pool: pg.Pool,
  chunkId: string,
  entities: Array<{ name: string; type: string; aliases?: string[] }>
): Promise<void> {
  if (entities.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const e of entities) {
      const row = await client.query<EntityRow>(
        `INSERT INTO entities (name, type, aliases)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (name, type) DO UPDATE SET
           aliases = EXCLUDED.aliases
         RETURNING id, name, type, aliases`,
        [e.name, e.type, JSON.stringify(e.aliases ?? [])]
      );
      const entityId = row.rows[0]!.id;
      await client.query(
        `INSERT INTO chunk_entities (chunk_id, entity_id, weight)
         VALUES ($1, $2, 1.0)
         ON CONFLICT (chunk_id, entity_id) DO NOTHING`,
        [chunkId, entityId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface EntitySearchResult extends ThoughtRow {
  overlap_count: number;
}

export async function searchThoughtsByEntity(
  pool: pg.Pool,
  entityNames: string[],
  limit: number = 10,
  project?: string,
  include_archived?: boolean,
  created_by?: string
): Promise<EntitySearchResult[]> {
  const key = getCipherKey();
  const { rows } = await pool.query<EntitySearchResult>(
    `SELECT id, content, metadata, overlap_count, proof_count, created_at
     FROM search_thoughts_by_entity($1, $2, $3, $4, $5, $6, $7)`,
    [
      entityNames,
      key,
      limit,
      project ?? null,
      include_archived ?? false,
      created_by ?? null,
      true, // exclude_superseded
    ]
  );
  return rows;
}


// ─── Document Queries ────────────────────────────────────────────────

export async function insertDocument(
  pool: pg.Pool,
  document: DocumentInput
): Promise<DocumentRow> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRow>(
    `INSERT INTO documents (
       title,
       source_type,
       source_uri,
       content_enc,
       metadata,
       project,
       created_by,
       bank_id,
       document_kind,
       session_id,
       task_id,
       intent,
       event_started_at,
       event_ended_at,
       fts
     )
     VALUES (
       $1,
       $2,
       $3,
       pgp_sym_encrypt($4, $15),
       $5::jsonb,
       $6,
       $7,
       COALESCE($8, 'openbrain'),
       COALESCE($9, 'article'),
       $10,
       $11,
       $12,
       $13,
       $14,
       to_tsvector('english', $4)
     )
     RETURNING id, title, source_type, source_uri,
               pgp_sym_decrypt(content_enc, $15)::text AS content,
               metadata, project, created_by, bank_id, document_kind,
               session_id, task_id, intent, event_started_at, event_ended_at,
               status, created_at, updated_at`,
    [
      document.title,
      document.source_type,
      document.source_uri ?? null,
      document.content,
      JSON.stringify(document.metadata ?? {}),
      document.project ?? null,
      document.created_by ?? null,
      document.bank_id ?? null,
      document.document_kind ?? null,
      document.session_id ?? null,
      document.task_id ?? null,
      document.intent ?? null,
      document.event_started_at ?? null,
      document.event_ended_at ?? null,
      key,
    ]
  );
  return rows[0]!;
}

export async function getDocumentBySourceUri(
  pool: pg.Pool,
  sourceUri: string
): Promise<DocumentRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRow>(
    `SELECT id, title, source_type, source_uri,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata, project, status, created_by, bank_id, document_kind,
            session_id, task_id, intent, event_started_at, event_ended_at,
            created_at, updated_at
     FROM documents
     WHERE source_uri = $1 AND status = 'active'
     LIMIT 1`,
    [sourceUri, key]
  );
  return rows[0] ?? null;
}

export async function getDocument(
  pool: pg.Pool,
  id: string
): Promise<DocumentRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRow>(
    `SELECT id, title, source_type, source_uri,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata, project, created_by, bank_id, document_kind,
            session_id, task_id, intent, event_started_at, event_ended_at,
            status, created_at, updated_at
     FROM documents
     WHERE id = $1 AND status != 'deleted'`,
    [id, key]
  );
  return rows[0] ?? null;
}

export async function listDocuments(
  pool: pg.Pool,
  options: DocumentListOptions = {}
): Promise<DocumentSummaryRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (options.project) {
    idx++;
    conditions.push(`d.project = $${idx}`);
    params.push(options.project);
  }
  if (options.source_type) {
    idx++;
    conditions.push(`d.source_type = $${idx}`);
    params.push(options.source_type);
  }
  if (options.status) {
    idx++;
    conditions.push(`d.status = $${idx}`);
    params.push(options.status);
  } else if (!options.include_deleted) {
    conditions.push("d.status != 'deleted'");
  }
  if (options.created_by) {
    idx++;
    conditions.push(`d.created_by = $${idx}`);
    params.push(options.created_by);
  }
  if (options.bank_id) {
    idx++;
    conditions.push(`d.bank_id = $${idx}`);
    params.push(options.bank_id);
  }
  if (options.document_kind) {
    idx++;
    conditions.push(`d.document_kind = $${idx}`);
    params.push(options.document_kind);
  }
  if (options.intent) {
    idx++;
    conditions.push(`d.intent = $${idx}`);
    params.push(options.intent);
  }
  if (options.q?.trim()) {
    const q = options.q.trim();
    idx++;
    const ftsIdx = idx;
    params.push(q);
    idx++;
    const likeIdx = idx;
    params.push(`%${q}%`);
    conditions.push(`(d.fts @@ plainto_tsquery('english', $${ftsIdx}) OR d.title ILIKE $${likeIdx} OR d.source_uri ILIKE $${likeIdx})`);
  }

  idx++;
  const keyIdx = idx;
  params.push(getCipherKey());
  idx++;
  const limitIdx = idx;
  params.push(Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100));
  idx++;
  const offsetIdx = idx;
  params.push(Math.max(Math.trunc(options.offset ?? 0), 0));

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";
  const { rows } = await pool.query<DocumentSummaryRow>(
    `SELECT d.id,
            d.title,
            d.source_type,
            d.source_uri,
            left(pgp_sym_decrypt(d.content_enc, $${keyIdx})::text, 240) AS content_preview,
            char_length(pgp_sym_decrypt(d.content_enc, $${keyIdx})::text)::int AS content_char_count,
            d.metadata,
            d.project,
            d.created_by,
            d.bank_id,
            d.document_kind,
            d.session_id,
            d.task_id,
            d.intent,
            d.event_started_at,
            d.event_ended_at,
            d.status,
            COUNT(DISTINCT c.id)::int AS chunk_count,
            COUNT(DISTINCT r.id)::int AS revision_count,
            d.created_at,
            d.updated_at
     FROM documents d
     LEFT JOIN document_chunks c ON c.document_id = d.id
     LEFT JOIN document_revisions r ON r.document_id = d.id
     WHERE ${whereClause}
     GROUP BY d.id
     ORDER BY d.updated_at DESC
     LIMIT $${limitIdx}
     OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}

export async function listDocumentRevisions(
  pool: pg.Pool,
  documentId: string
): Promise<DocumentRevisionRow[]> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRevisionRow>(
    `SELECT id,
            document_id,
            revision_number,
            title,
            source_uri,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata,
            status,
            edit_reason,
            created_by,
            created_at
     FROM document_revisions
     WHERE document_id = $1
     ORDER BY revision_number DESC`,
    [documentId, key]
  );
  return rows;
}

export async function getDocumentRevision(
  pool: pg.Pool,
  documentId: string,
  revisionNumber: number
): Promise<DocumentRevisionRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRevisionRow>(
    `SELECT id,
            document_id,
            revision_number,
            title,
            source_uri,
            pgp_sym_decrypt(content_enc, $3)::text AS content,
            metadata,
            status,
            edit_reason,
            created_by,
            created_at
     FROM document_revisions
     WHERE document_id = $1 AND revision_number = $2
     LIMIT 1`,
    [documentId, revisionNumber, key]
  );
  return rows[0] ?? null;
}

export async function deleteDocument(
  pool: pg.Pool,
  id: string
): Promise<{ deleted: boolean; id: string }> {
  const { rowCount } = await pool.query(
    `UPDATE documents
     SET status = 'deleted', updated_at = now()
     WHERE id = $1 AND status != 'deleted'`,
    [id]
  );
  return { deleted: (rowCount ?? 0) > 0, id };
}

async function updateDocumentInTransaction(
  client: pg.PoolClient,
  key: string,
  id: string,
  patch: DocumentUpdateInput
): Promise<DocumentRow> {
  const existingResult = await client.query<DocumentRow>(
    `SELECT id, title, source_type, source_uri,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata, project, created_by, bank_id, document_kind,
            session_id, task_id, intent, event_started_at, event_ended_at,
            status, created_at, updated_at
     FROM documents
     WHERE id = $1 AND status != 'deleted'
     FOR UPDATE`,
    [id, key]
  );

  if (!existingResult.rowCount || existingResult.rowCount === 0) {
    throw new Error(`Document not found: ${id}`);
  }

  const existing = existingResult.rows[0]!;
  const nextRevisionResult = await client.query<{ next_revision: number }>(
    `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision
     FROM document_revisions
     WHERE document_id = $1`,
    [id]
  );
  const nextRevision = nextRevisionResult.rows[0]?.next_revision ?? 1;

  await client.query(
    `INSERT INTO document_revisions
       (document_id, revision_number, title, source_uri, content_enc, metadata, status, edit_reason, created_by)
     VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5, $10), $6::jsonb, $7, $8, $9)`,
    [
      id,
      nextRevision,
      existing.title,
      existing.source_uri ?? null,
      existing.content,
      JSON.stringify(existing.metadata ?? {}),
      existing.status,
      patch.edit_reason ?? null,
      patch.updated_by ?? null,
      key,
    ]
  );

  const newTitle = patch.title ?? existing.title;
  const newSourceUri = patch.source_uri !== undefined ? patch.source_uri : existing.source_uri ?? null;
  const newContent = patch.content ?? existing.content;
  const newMetadata = patch.metadata ?? existing.metadata ?? {};
  const newStatus = patch.status ?? existing.status;

  const { rows, rowCount } = await client.query<DocumentRow>(
    `UPDATE documents
     SET title = $2,
         source_uri = $3,
         content_enc = pgp_sym_encrypt($4, $7),
         metadata = $5::jsonb,
         status = $6,
         fts = to_tsvector('english', $4),
         updated_at = now()
     WHERE id = $1
     RETURNING id, title, source_type, source_uri,
               pgp_sym_decrypt(content_enc, $7)::text AS content,
               metadata, project, created_by, bank_id, document_kind,
               session_id, task_id, intent, event_started_at, event_ended_at,
               status, created_at, updated_at`,
    [
      id,
      newTitle,
      newSourceUri,
      newContent,
      JSON.stringify(newMetadata),
      newStatus,
      key,
    ]
  );

  if (!rowCount || rowCount === 0) {
    throw new Error(`Document not found: ${id}`);
  }

  return rows[0]!;
}

async function replaceDocumentChunksInTransaction(
  client: pg.PoolClient,
  key: string,
  documentId: string,
  chunks: DocumentChunkInput[]
): Promise<DocumentChunkRow[]> {
  const results: DocumentChunkRow[] = [];
  await client.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

  for (const chunk of chunks) {
    const embeddingStr = `[${chunk.embedding.join(",")}]`;
    const { rows } = await client.query<DocumentChunkRow>(
      `INSERT INTO document_chunks
         (document_id, chunk_index, content_enc, embedding, metadata, token_count, char_start, char_end, fts)
       VALUES ($1, $2, pgp_sym_encrypt($3, $9), $4::vector, $5::jsonb, $6, $7, $8, to_tsvector('english', $3))
       RETURNING id, document_id, chunk_index,
                 pgp_sym_decrypt(content_enc, $9)::text AS content,
                 metadata, token_count, char_start, char_end, created_at, updated_at`,
      [
        documentId,
        chunk.chunk_index,
        chunk.content,
        embeddingStr,
        JSON.stringify(chunk.metadata ?? {}),
        chunk.token_count ?? null,
        chunk.char_start ?? null,
        chunk.char_end ?? null,
        key,
      ]
    );
    results.push(rows[0]!);
  }

  return results;
}

export async function updateDocument(
  pool: pg.Pool,
  id: string,
  patch: DocumentUpdateInput
): Promise<DocumentRow> {
  const client = await pool.connect();
  const key = getCipherKey();

  try {
    await client.query("BEGIN");
    const document = await updateDocumentInTransaction(client, key, id, patch);
    await client.query("COMMIT");
    return document;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDocumentWithChunks(
  pool: pg.Pool,
  id: string,
  patch: DocumentUpdateInput,
  chunks: DocumentChunkInput[]
): Promise<{ document: DocumentRow; chunks: DocumentChunkRow[] }> {
  const client = await pool.connect();
  const key = getCipherKey();

  try {
    await client.query("BEGIN");
    const document = await updateDocumentInTransaction(client, key, id, patch);
    const replacedChunks = await replaceDocumentChunksInTransaction(client, key, id, chunks);
    await client.query("COMMIT");
    return { document, chunks: replacedChunks };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceDocumentChunks(
  pool: pg.Pool,
  documentId: string,
  chunks: DocumentChunkInput[]
): Promise<DocumentChunkRow[]> {
  const client = await pool.connect();
  const key = getCipherKey();

  try {
    await client.query("BEGIN");
    const results = await replaceDocumentChunksInTransaction(client, key, documentId, chunks);
    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface ReindexDocumentOptions {
  targetVersion: string;
  staleOnly?: boolean;
  limit?: number;
}

export async function listDocumentsForReindex(
  pool: pg.Pool,
  options: ReindexDocumentOptions
): Promise<DocumentRow[]> {
  const key = getCipherKey();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const staleOnly = options.staleOnly === true;
  const { rows } = await pool.query<DocumentRow>(
    `SELECT d.id, d.title, d.source_type, d.source_uri,
            pgp_sym_decrypt(d.content_enc, $2)::text AS content,
            d.metadata, d.project, d.created_by, d.bank_id, d.document_kind,
            d.session_id, d.task_id, d.intent, d.event_started_at, d.event_ended_at,
            d.status, d.created_at, d.updated_at
       FROM documents d
      WHERE d.status = 'active'
        AND (
          $3::boolean = false
          OR NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)
          OR EXISTS (
            SELECT 1
              FROM document_chunks c
             WHERE c.document_id = d.id
               AND COALESCE(NULLIF(c.metadata->>'embedder_version', ''), 'unknown') <> $4
          )
        )
      ORDER BY d.updated_at DESC
      LIMIT $1`,
    [limit, key, staleOnly, options.targetVersion]
  );
  return rows;
}

export async function getDocumentChunkEmbedderVersionStats(pool: pg.Pool): Promise<EmbedderVersionStat[]> {
  const { rows } = await pool.query<{ embedder_version: string; count: string }>(
    `SELECT COALESCE(NULLIF(metadata->>'embedder_version', ''), 'unknown') AS embedder_version,
            count(*)::text AS count
       FROM document_chunks
      GROUP BY 1
      ORDER BY count(*) DESC, embedder_version ASC`
  );
  return rows.map((row) => ({ embedder_version: row.embedder_version, count: Number(row.count) }));
}

export async function listDocumentChunks(
  pool: pg.Pool,
  documentId: string
): Promise<DocumentChunkRow[]> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentChunkRow>(
    `SELECT id, document_id, chunk_index,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata, token_count, char_start, char_end, created_at, updated_at
     FROM document_chunks
     WHERE document_id = $1
     ORDER BY chunk_index ASC`,
    [documentId, key]
  );
  return rows;
}

export async function searchDocumentChunks(
  pool: pg.Pool,
  queryEmbedding: number[],
  options: DocumentChunkSearchOptions = {}
): Promise<DocumentChunkSearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const key = getCipherKey();
  const limit = options.limit ?? 10;
  const threshold = options.threshold ?? 0.3;
  const project = options.project ?? null;
  const sourceType = options.source_type ?? null;
  const mode = options.mode ?? "vector";
  const query = options.query ?? "";
  const vectorWeight = options.vector_weight ?? 0.75;
  const ftsWeight = options.fts_weight ?? 0.25;

  if (mode === "hybrid") {
    const { rows } = await pool.query<DocumentChunkSearchResult>(
      `WITH scored AS (
         SELECT c.id, c.document_id, d.title AS document_title,
                d.source_type AS document_source_type,
                d.source_uri AS document_source_uri,
                d.project,
                c.chunk_index,
                pgp_sym_decrypt(c.content_enc, $2)::text AS content,
                c.metadata, c.token_count, c.char_start, c.char_end,
                1 - (c.embedding <=> $1::vector) AS similarity,
                ts_rank_cd(c.fts, plainto_tsquery('english', $7)) AS fts_rank,
                c.created_at, c.updated_at
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'active'
           AND c.embedding IS NOT NULL
           AND 1 - (c.embedding <=> $1::vector) >= $4
           AND ($5::text IS NULL OR d.project = $5)
           AND ($6::text IS NULL OR d.source_type = $6)
       )
       SELECT *, (($8::float8 * similarity) + ($9::float8 * LEAST(fts_rank, 1.0))) AS score
       FROM scored
       ORDER BY score DESC, similarity DESC
       LIMIT $3`,
      [embeddingStr, key, limit, threshold, project, sourceType, query, vectorWeight, ftsWeight]
    );
    return rows;
  }

  const { rows } = await pool.query<DocumentChunkSearchResult>(
    `SELECT c.id, c.document_id, d.title AS document_title,
            d.source_type AS document_source_type,
            d.source_uri AS document_source_uri,
            d.project,
            c.chunk_index,
            pgp_sym_decrypt(c.content_enc, $2)::text AS content,
            c.metadata, c.token_count, c.char_start, c.char_end,
            1 - (c.embedding <=> $1::vector) AS similarity,
            0::float8 AS fts_rank,
            1 - (c.embedding <=> $1::vector) AS score,
            c.created_at, c.updated_at
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE d.status = 'active'
       AND c.embedding IS NOT NULL
       AND 1 - (c.embedding <=> $1::vector) >= $4
       AND ($5::text IS NULL OR d.project = $5)
       AND ($6::text IS NULL OR d.source_type = $6)
     ORDER BY c.embedding <=> $1::vector ASC
     LIMIT $3`,
    [embeddingStr, key, limit, threshold, project, sourceType]
  );
  return rows;
}

/**
 * Phase 3 graph lane: surface chunks that mention the same entities as the
 * query, ranked by how many distinct query entities the chunk covers. Score
 * is normalized entity coverage in [0, 1] so it can compete with semantic /
 * BM25 lanes via the existing rankRecallResults blending.
 *
 * Entity names are matched case-insensitively after the caller has
 * lower-cased them; this lets the input contain mixed-case forms from
 * extractQueryEntities() without a normalize round-trip in TypeScript.
 */
export async function searchDocumentChunksByEntity(
  pool: pg.Pool,
  entityNames: string[],
  options: DocumentChunkEntityOverlapOptions = {}
): Promise<DocumentChunkEntityOverlapResult[]> {
  if (entityNames.length === 0) return [];
  const limit = options.limit ?? 10;
  const project = options.project ?? null;
  const key = getCipherKey();
  const normalized = [...new Set(entityNames.map((n) => n.toLowerCase().trim()).filter((n) => n.length >= 2))];
  if (normalized.length === 0) return [];

  const { rows } = await pool.query<DocumentChunkEntityOverlapResult>(
    `SELECT c.id, c.document_id, d.title AS document_title,
            d.source_type AS document_source_type,
            d.source_uri AS document_source_uri,
            d.project,
            c.chunk_index,
            pgp_sym_decrypt(c.content_enc, $2)::text AS content,
            c.metadata, c.token_count, c.char_start, c.char_end,
            c.created_at, c.updated_at,
            count(DISTINCT e.id)::int AS overlap_count,
            -- Cap the graph-lane similarity at 0.5 so it never beats a strong
            -- semantic match. The same chunk found by semantic+graph keeps its
            -- semantic score via Max-merge in upsertRecallResult; a graph-only
            -- chunk still surfaces at low rank.
            LEAST(0.5, count(DISTINCT e.id)::float8 / GREATEST($4::int, 1)) AS similarity,
            0::float8 AS fts_rank,
            LEAST(0.5, count(DISTINCT e.id)::float8 / GREATEST($4::int, 1)) AS score
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN chunk_entities ce ON ce.chunk_id = c.id
     JOIN entities e ON e.id = ce.entity_id
     WHERE d.status = 'active'
       AND LOWER(e.name) = ANY($1::text[])
       AND ($3::text IS NULL OR d.project = $3)
     GROUP BY c.id, d.title, d.source_type, d.source_uri, d.project
     HAVING count(DISTINCT e.id) >= 1
     ORDER BY count(DISTINCT e.id) DESC, c.created_at DESC
     LIMIT $5`,
    [normalized, key, project, normalized.length, limit]
  );
  return rows;
}

function serializeConsolidatedObservationTimestamp(
  value: ConsolidatedObservationTimestampInput | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export async function insertConsolidatedObservation(
  pool: pg.Pool,
  observation: ConsolidatedObservationInput
): Promise<ConsolidatedObservationRow> {
  const key = getCipherKey();
  const embeddingStr = `[${observation.embedding.join(",")}]`;
  const sourceMemoryIds = observation.source_memory_ids ?? [];
  const proofCount = observation.proof_count ?? Math.max(sourceMemoryIds.length, 1);
  const { rows } = await pool.query<ConsolidatedObservationRow>(
    `INSERT INTO consolidated_observations (
       bank_id,
       content_enc,
       embedding,
       proof_count,
       source_memory_ids,
       source_quotes,
       tags,
       history,
       trend,
       trend_computed_at,
       project,
       created_by,
       archived,
       fts
     )
     VALUES (
       COALESCE($1, 'openbrain'),
       pgp_sym_encrypt($2, $12),
       $3::vector,
       $4,
       $5::uuid[],
       $6::jsonb,
       $7::jsonb,
       $8::jsonb,
       $9,
       $10,
       $11,
       $13,
       COALESCE($14, false),
       to_tsvector('english', $2)
     )
     RETURNING id,
               bank_id,
               pgp_sym_decrypt(content_enc, $12)::text AS content,
               proof_count,
               source_memory_ids,
               source_quotes,
               tags,
               history,
               trend,
               trend_computed_at,
               project,
               created_by,
               archived,
               created_at,
               updated_at`,
    [
      observation.bank_id ?? null,
      observation.content,
      embeddingStr,
      proofCount,
      sourceMemoryIds,
      JSON.stringify(observation.source_quotes ?? {}),
      JSON.stringify(observation.tags ?? []),
      JSON.stringify(observation.history ?? []),
      observation.trend ?? null,
      serializeConsolidatedObservationTimestamp(observation.trend_computed_at),
      observation.project ?? null,
      key,
      observation.created_by ?? null,
      observation.archived ?? false,
    ]
  );
  return rows[0]!;
}

export async function getConsolidatedObservation(
  pool: pg.Pool,
  id: string
): Promise<ConsolidatedObservationRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<ConsolidatedObservationRow>(
    `SELECT id,
            bank_id,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            proof_count,
            source_memory_ids,
            source_quotes,
            tags,
            history,
            trend,
            trend_computed_at,
            project,
            created_by,
            archived,
            created_at,
            updated_at
     FROM consolidated_observations
     WHERE id = $1`,
    [id, key]
  );
  return rows[0] ?? null;
}

export async function searchConsolidatedObservations(
  pool: pg.Pool,
  queryEmbedding: number[],
  options: ConsolidatedObservationSearchOptions = {}
): Promise<ConsolidatedObservationSearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const key = getCipherKey();
  const limit = options.limit ?? 10;
  const threshold = options.threshold ?? 0.3;
  const archivedClause = options.include_archived ? "TRUE" : "archived = false";

  const { rows } = await pool.query<ConsolidatedObservationSearchResult>(
    `SELECT id,
            bank_id,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            proof_count,
            source_memory_ids,
            source_quotes,
            tags,
            history,
            trend,
            trend_computed_at,
            project,
            created_by,
            archived,
            1 - (embedding <=> $1::vector) AS similarity,
            created_at,
            updated_at
     FROM consolidated_observations
     WHERE ${archivedClause}
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $4
       AND ($5::text IS NULL OR bank_id = $5)
       AND ($6::text IS NULL OR project = $6)
       AND ($7::text IS NULL OR created_by = $7)
     ORDER BY embedding <=> $1::vector ASC
     LIMIT $3`,
    [
      embeddingStr,
      key,
      limit,
      threshold,
      options.bank_id ?? null,
      options.project ?? null,
      options.created_by ?? null,
    ]
  );
  return rows;
}

export async function updateConsolidatedObservation(
  pool: pg.Pool,
  id: string,
  patch: ConsolidatedObservationUpdateInput
): Promise<ConsolidatedObservationRow> {
  const client = await pool.connect();
  const key = getCipherKey();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query<ConsolidatedObservationRow>(
      `SELECT id,
              bank_id,
              pgp_sym_decrypt(content_enc, $2)::text AS content,
              proof_count,
              source_memory_ids,
              source_quotes,
              tags,
              history,
              trend,
              trend_computed_at,
              project,
              created_by,
              archived,
              created_at,
              updated_at
       FROM consolidated_observations
       WHERE id = $1
       FOR UPDATE`,
      [id, key]
    );

    if (!existingResult.rowCount || existingResult.rowCount === 0) {
      throw new Error(`Observation not found: ${id}`);
    }

    const existing = existingResult.rows[0]!;
    const nextContent = patch.content ?? existing.content;
    const nextEmbedding = patch.embedding ? `[${patch.embedding.join(",")}]` : null;
    const nextSourceMemoryIds = patch.source_memory_ids ?? existing.source_memory_ids ?? [];
    const nextProofCount = patch.proof_count ?? existing.proof_count ?? Math.max(nextSourceMemoryIds.length, 1);
    const nextSourceQuotes = patch.source_quotes ?? existing.source_quotes ?? {};
    const nextTags = patch.tags ?? existing.tags ?? [];
    const historyBase = Array.isArray(patch.history) ? patch.history : (existing.history ?? []);
    const nextHistory = [
      ...historyBase,
      {
        previous_content: existing.content,
        previous_proof_count: existing.proof_count,
        previous_source_memory_ids: existing.source_memory_ids ?? [],
        previous_source_quotes: existing.source_quotes ?? {},
        previous_tags: existing.tags ?? [],
        previous_trend: existing.trend ?? null,
        previous_trend_computed_at: existing.trend_computed_at?.toISOString() ?? null,
        previous_project: existing.project ?? null,
        previous_archived: existing.archived,
        previous_updated_at: existing.updated_at.toISOString(),
        edit_reason: patch.edit_reason ?? null,
      },
    ];

    const { rows, rowCount } = await client.query<ConsolidatedObservationRow>(
      `UPDATE consolidated_observations
       SET content_enc = pgp_sym_encrypt($2, $13),
           embedding = COALESCE($3::vector, embedding),
           proof_count = $4,
           source_memory_ids = $5::uuid[],
           source_quotes = $6::jsonb,
           tags = $7::jsonb,
           history = $8::jsonb,
           trend = $9,
           trend_computed_at = $10,
           project = $11,
           archived = $12,
           fts = to_tsvector('english', $2)
       WHERE id = $1
       RETURNING id,
                 bank_id,
                 pgp_sym_decrypt(content_enc, $13)::text AS content,
                 proof_count,
                 source_memory_ids,
                 source_quotes,
                 tags,
                 history,
                 trend,
                 trend_computed_at,
                 project,
                 created_by,
                 archived,
                 created_at,
                 updated_at`,
      [
        id,
        nextContent,
        nextEmbedding,
        nextProofCount,
        nextSourceMemoryIds,
        JSON.stringify(nextSourceQuotes),
        JSON.stringify(nextTags),
        JSON.stringify(nextHistory),
        patch.trend ?? existing.trend ?? null,
        serializeConsolidatedObservationTimestamp(
          patch.trend_computed_at !== undefined
            ? patch.trend_computed_at
            : existing.trend_computed_at ?? null
        ),
        patch.project !== undefined ? patch.project : existing.project ?? null,
        patch.archived ?? existing.archived,
        key,
      ]
    );

    if (!rowCount || rowCount === 0) {
      throw new Error(`Observation not found: ${id}`);
    }

    await client.query("COMMIT");
    return rows[0]!;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


// ─── Mental Model Queries ──────────────────────────────────────────────

function boundedMentalModelLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? 50)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 50)));
}

function buildMentalModelFilters(
  options: MentalModelListOptions,
  params: unknown[],
  startClause = "WHERE"
): string {
  const clauses: string[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  clauses.push(`bank_id = ${add(options.bank_id ?? "openbrain")}`);
  if (options.project !== undefined) clauses.push(`project = ${add(options.project)}`);
  if (options.created_by !== undefined) clauses.push(`created_by = ${add(options.created_by)}`);
  if (options.trigger_tag !== undefined) clauses.push(`trigger_tags ? ${add(options.trigger_tag)}`);
  if (!options.include_inactive) clauses.push("active = true");

  return `${startClause} ${clauses.join(" AND ")}`;
}

export async function insertMentalModel(
  pool: pg.Pool,
  model: MentalModelInput
): Promise<MentalModelRow> {
  const key = getCipherKey();
  const embeddingStr = `[${model.embedding.join(",")}]`;
  const { rows } = await pool.query<MentalModelRow>(
    `INSERT INTO mental_models (
       bank_id,
       name,
       query,
       content_enc,
       embedding,
       fts,
       structured,
       tags,
       trigger_tags,
       priority,
       refresh_meta,
       history,
       active,
       project,
       created_by
     )
     VALUES (
       COALESCE($1, 'openbrain'),
       $2,
       $3,
       pgp_sym_encrypt($4, $15),
       $5::vector,
       to_tsvector('english', $2 || ' ' || $3 || ' ' || $4),
       $6::jsonb,
       $7::jsonb,
       $8::jsonb,
       COALESCE($9, 0),
       $10::jsonb,
       $11::jsonb,
       COALESCE($12, true),
       $13,
       $14
     )
     RETURNING id,
               bank_id,
               name,
               query,
               pgp_sym_decrypt(content_enc, $15)::text AS content,
               structured,
               tags,
               trigger_tags,
               priority,
               refresh_meta,
               history,
               active,
               project,
               created_by,
               created_at,
               updated_at`,
    [
      model.bank_id ?? null,
      model.name,
      model.query,
      model.content,
      embeddingStr,
      JSON.stringify(model.structured ?? {}),
      JSON.stringify(model.tags ?? []),
      JSON.stringify(model.trigger_tags ?? []),
      model.priority ?? 0,
      JSON.stringify(model.refresh_meta ?? {}),
      JSON.stringify(model.history ?? []),
      model.active ?? true,
      model.project ?? null,
      model.created_by ?? null,
      key,
    ]
  );
  return rows[0]!;
}

export async function getMentalModel(
  pool: pg.Pool,
  id: string
): Promise<MentalModelRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<MentalModelRow>(
    `SELECT id,
            bank_id,
            name,
            query,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            structured,
            tags,
            trigger_tags,
            priority,
            refresh_meta,
            history,
            active,
            project,
            created_by,
            created_at,
            updated_at
     FROM mental_models
     WHERE id = $1`,
    [id, key]
  );
  return rows[0] ?? null;
}

export async function listMentalModels(
  pool: pg.Pool,
  options: MentalModelListOptions = {}
): Promise<MentalModelRow[]> {
  const key = getCipherKey();
  const params: unknown[] = [key];
  const where = buildMentalModelFilters(options, params);
  params.push(boundedMentalModelLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;
  const { rows } = await pool.query<MentalModelRow>(
    `SELECT id,
            bank_id,
            name,
            query,
            pgp_sym_decrypt(content_enc, $1)::text AS content,
            structured,
            tags,
            trigger_tags,
            priority,
            refresh_meta,
            history,
            active,
            project,
            created_by,
            created_at,
            updated_at
     FROM mental_models
     ${where}
     ORDER BY priority DESC, updated_at DESC, id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

export async function searchMentalModels(
  pool: pg.Pool,
  queryEmbedding: number[],
  options: MentalModelSearchOptions = {}
): Promise<MentalModelSearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const key = getCipherKey();
  const params: unknown[] = [embeddingStr, key];
  const where = buildMentalModelFilters(options, params);
  params.push(options.threshold ?? 0.3);
  const thresholdPlaceholder = `$${params.length}`;
  params.push(boundedMentalModelLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query<MentalModelSearchResult>(
    `SELECT id,
            bank_id,
            name,
            query,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            structured,
            tags,
            trigger_tags,
            priority,
            refresh_meta,
            history,
            active,
            project,
            created_by,
            1 - (embedding <=> $1::vector) AS similarity,
            created_at,
            updated_at
     FROM mental_models
     ${where}
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= ${thresholdPlaceholder}
     ORDER BY embedding <=> $1::vector ASC, priority DESC, updated_at DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

export async function updateMentalModel(
  pool: pg.Pool,
  id: string,
  patch: MentalModelUpdateInput
): Promise<MentalModelRow> {
  const key = getCipherKey();
  const embeddingStr = patch.embedding ? `[${patch.embedding.join(",")}]` : null;
  const { rows, rowCount } = await pool.query<MentalModelRow>(
    `UPDATE mental_models
     SET name = COALESCE($2, name),
         query = COALESCE($3, query),
         content_enc = pgp_sym_encrypt(COALESCE($4, pgp_sym_decrypt(content_enc, $15)::text), $15),
         embedding = COALESCE($5::vector, embedding),
         structured = COALESCE($6::jsonb, structured),
         tags = COALESCE($7::jsonb, tags),
         trigger_tags = COALESCE($8::jsonb, trigger_tags),
         priority = COALESCE($9, priority),
         refresh_meta = COALESCE($10::jsonb, refresh_meta),
         history = COALESCE($11::jsonb, history),
         active = COALESCE($12::boolean, active),
         project = COALESCE($13::text, project),
         created_by = COALESCE($14::text, created_by),
         fts = to_tsvector(
           'english',
           COALESCE($2, name) || ' ' || COALESCE($3, query) || ' ' || COALESCE($4, pgp_sym_decrypt(content_enc, $15)::text)
         ),
         updated_at = now()
     WHERE id = $1
     RETURNING id, bank_id, name, query,
               pgp_sym_decrypt(content_enc, $15)::text AS content,
               structured,
               tags,
               trigger_tags,
               priority,
               refresh_meta,
               history,
               active,
               project,
               created_by,
               created_at,
               updated_at`,
    [
      id,
      patch.name ?? null,
      patch.query ?? null,
      patch.content ?? null,
      embeddingStr,
      patch.structured !== undefined ? JSON.stringify(patch.structured) : null,
      patch.tags !== undefined ? JSON.stringify(patch.tags) : null,
      patch.trigger_tags !== undefined ? JSON.stringify(patch.trigger_tags) : null,
      patch.priority ?? null,
      patch.refresh_meta !== undefined ? JSON.stringify(patch.refresh_meta) : null,
      patch.history !== undefined ? JSON.stringify(patch.history) : null,
      patch.active ?? null,
      patch.project ?? null,
      patch.created_by ?? null,
      key,
    ]
  );

  if (!rowCount || rowCount === 0) {
    throw new Error(`Mental model not found: ${id}`);
  }

  return rows[0]!;
}


// ─── Experience Queries ──────────────────────────────────────────────

function boundedExperienceLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? 50)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 50)));
}

function buildExperienceFilters(
  options: ExperienceListOptions,
  params: unknown[],
  startClause = "WHERE"
): string {
  const clauses: string[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  clauses.push(`bank_id = ${add(options.bank_id ?? "openbrain")}`);
  if (options.session_id !== undefined) clauses.push(`session_id = ${add(options.session_id)}`);
  if (options.agent_id !== undefined) clauses.push(`agent_id = ${add(options.agent_id)}`);
  if (options.event_type !== undefined) clauses.push(`event_type = ${add(options.event_type)}`);
  if (options.project !== undefined) clauses.push(`project = ${add(options.project)}`);
  if (options.created_by !== undefined) clauses.push(`created_by = ${add(options.created_by)}`);

  return `${startClause} ${clauses.join(" AND ")}`;
}

export async function insertExperience(
  pool: pg.Pool,
  experience: ExperienceInput
): Promise<ExperienceRow> {
  const key = getCipherKey();
  const embeddingStr = `[${experience.embedding.join(",")}]`;
  const { rows } = await pool.query<ExperienceRow>(
    `INSERT INTO experiences (
       bank_id,
       session_id,
       agent_id,
       occurred_at,
       event_type,
       content_enc,
       embedding,
       fts,
       refs,
       project,
       created_by
     )
     VALUES (
       COALESCE($1, 'openbrain'),
       $2,
       $3,
       COALESCE($4::timestamptz, now()),
       $5,
       pgp_sym_encrypt($6, $11),
       $7::vector,
       to_tsvector('english', $6),
       $8::jsonb,
       $9,
       $10
     )
     RETURNING id,
               bank_id,
               session_id,
               agent_id,
               occurred_at,
               event_type,
               pgp_sym_decrypt(content_enc, $11)::text AS content,
               refs,
               project,
               created_by,
               created_at`,
    [
      experience.bank_id ?? null,
      experience.session_id ?? null,
      experience.agent_id ?? null,
      experience.occurred_at ?? null,
      experience.event_type,
      experience.content,
      embeddingStr,
      JSON.stringify(experience.refs ?? {}),
      experience.project ?? null,
      experience.created_by ?? null,
      key,
    ]
  );
  return rows[0]!;
}

export async function getExperience(
  pool: pg.Pool,
  id: string
): Promise<ExperienceRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<ExperienceRow>(
    `SELECT id,
            bank_id,
            session_id,
            agent_id,
            occurred_at,
            event_type,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            refs,
            project,
            created_by,
            created_at
     FROM experiences
     WHERE id = $1`,
    [id, key]
  );
  return rows[0] ?? null;
}

export async function listExperiences(
  pool: pg.Pool,
  options: ExperienceListOptions = {}
): Promise<ExperienceRow[]> {
  const key = getCipherKey();
  const params: unknown[] = [key];
  const where = buildExperienceFilters(options, params);
  params.push(boundedExperienceLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query<ExperienceRow>(
    `SELECT id,
            bank_id,
            session_id,
            agent_id,
            occurred_at,
            event_type,
            pgp_sym_decrypt(content_enc, $1)::text AS content,
            refs,
            project,
            created_by,
            created_at
     FROM experiences
     ${where}
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

export async function searchExperiences(
  pool: pg.Pool,
  embedding: number[],
  options: ExperienceSearchOptions = {}
): Promise<ExperienceSearchResult[]> {
  const key = getCipherKey();
  const embeddingStr = `[${embedding.join(",")}]`;
  const params: unknown[] = [embeddingStr, key];
  const filterOptions: ExperienceListOptions = {
    bank_id: options.bank_id,
    session_id: options.session_id,
    agent_id: options.agent_id,
    event_type: options.event_type,
    project: options.project,
    created_by: options.created_by,
  };
  const where = buildExperienceFilters(filterOptions, params, "AND");
  params.push(options.threshold ?? 0.3);
  const thresholdPlaceholder = `$${params.length}`;
  params.push(boundedExperienceLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query<ExperienceSearchResult>(
    `SELECT id,
            bank_id,
            session_id,
            agent_id,
            occurred_at,
            event_type,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            refs,
            project,
            created_by,
            created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM experiences
     WHERE embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= ${thresholdPlaceholder}
       ${where}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}


// ─── Recall Routing Telemetry ────────────────────────────────────────

export type RecallRoutingTelemetrySourceRouter = "heuristic";
export type RecallRoutingTelemetryRoute = "document_only" | "thought_only" | "balanced_mixed";
export type RecallRoutingTelemetrySourceBalance = "score" | "balanced";

export interface RecallRoutingTelemetryInput {
  bank_id?: string;
  source_router: RecallRoutingTelemetrySourceRouter;
  route: RecallRoutingTelemetryRoute;
  source_balance: RecallRoutingTelemetrySourceBalance;
  source_types: string[];
  confidence: number;
  reasons: string[];
  project?: string;
  created_by?: string;
  occurred_at?: ExperienceTimestampInput;
}

export interface RecallRoutingTelemetryRow {
  id: string;
  bank_id: string;
  occurred_at: Date;
  source_router: RecallRoutingTelemetrySourceRouter;
  route: RecallRoutingTelemetryRoute;
  source_balance: RecallRoutingTelemetrySourceBalance;
  source_types: string[];
  confidence: number | null;
  reasons: string[];
  project: string | null;
  created_by: string | null;
}

export async function insertRecallRoutingTelemetry(
  pool: pg.Pool,
  telemetry: RecallRoutingTelemetryInput
): Promise<RecallRoutingTelemetryRow> {
  const { rows } = await pool.query<RecallRoutingTelemetryRow>(
    `INSERT INTO recall_routing_telemetry (
       bank_id,
       occurred_at,
       source_router,
       route,
       source_balance,
       source_types,
       confidence,
       reasons,
       project,
       created_by
     )
     VALUES (
       COALESCE($1, 'openbrain'),
       COALESCE($2::timestamptz, now()),
       $3,
       $4,
       $5,
       $6::jsonb,
       $7,
       $8::jsonb,
       $9,
       $10
     )
     RETURNING id, bank_id, occurred_at, source_router, route, source_balance,
               source_types, confidence, reasons, project, created_by`,
    [
      telemetry.bank_id ?? null,
      telemetry.occurred_at ?? null,
      telemetry.source_router,
      telemetry.route,
      telemetry.source_balance,
      JSON.stringify(telemetry.source_types),
      telemetry.confidence,
      JSON.stringify(telemetry.reasons),
      telemetry.project ?? null,
      telemetry.created_by ?? null,
    ]
  );
  return rows[0]!;
}


// ─── Memory Link Queries ──────────────────────────────────────────────

function boundedMemoryLinkLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? 50)) return 50;
  return Math.max(1, Math.min(500, Math.trunc(limit ?? 50)));
}

function memoryLinkReturnColumns(): string {
  return `id, bank_id, source_type, source_id, target_type, target_id, relationship,
          weight, inferred, created_at`;
}

function buildMemoryLinkFilters(options: MemoryLinkListOptions, params: unknown[]): string {
  const clauses: string[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  clauses.push(`bank_id = ${add(options.bank_id ?? "openbrain")}`);
  if (options.source_type !== undefined) clauses.push(`source_type = ${add(options.source_type)}`);
  if (options.source_id !== undefined) clauses.push(`source_id = ${add(options.source_id)}`);
  if (options.target_type !== undefined) clauses.push(`target_type = ${add(options.target_type)}`);
  if (options.target_id !== undefined) clauses.push(`target_id = ${add(options.target_id)}`);
  if (options.relationship !== undefined) clauses.push(`relationship = ${add(options.relationship)}`);
  if (options.inferred !== undefined) clauses.push(`inferred = ${add(options.inferred)}`);

  return `WHERE ${clauses.join(" AND ")}`;
}


// ─── Temporal Recall ─────────────────────────────────────────────────

export async function recallTemporalMemories(
  pool: pg.Pool,
  options: TemporalRecallOptions = {}
): Promise<TemporalRecallRow[]> {
  if (options.time_start === undefined && options.time_end === undefined) {
    return [];
  }

  const key = getCipherKey();
  const bankId = options.bank_id ?? "openbrain";
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));

  const { rows } = await pool.query<TemporalRecallRow>(
    `WITH temporal_candidates AS (
       SELECT 'experience'::text AS source_type,
              e.id,
              pgp_sym_decrypt(e.content_enc, $2)::text AS content,
              NULL::text AS title,
              (
                jsonb_build_object(
                  'event_type', e.event_type,
                  'session_id', e.session_id,
                  'agent_id', e.agent_id,
                  'occurred_at', e.occurred_at
                ) || COALESCE(e.refs, '{}'::jsonb)
              ) AS metadata,
              e.project,
              e.created_by,
              e.occurred_at AS event_at,
              e.occurred_at AS event_started_at,
              e.occurred_at AS event_ended_at,
              e.created_at,
              1.0::float8 AS temporal_score
       FROM experiences e
       WHERE e.bank_id = $1
         AND ($3::timestamptz IS NULL OR e.occurred_at >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR e.occurred_at <= $4::timestamptz)

       UNION ALL

       SELECT 'thought'::text AS source_type,
              t.id,
              pgp_sym_decrypt(t.content_enc, $2)::text AS content,
              NULL::text AS title,
              COALESCE(t.metadata, '{}'::jsonb) AS metadata,
              t.project,
              t.created_by,
              t.temporal_event_at AS event_at,
              COALESCE(t.event_started_at, t.temporal_event_at) AS event_started_at,
              COALESCE(t.event_ended_at, t.temporal_event_at) AS event_ended_at,
              t.created_at,
              1.0::float8 AS temporal_score
       FROM thoughts t
       WHERE t.bank_id = $1
         AND ($7::boolean OR NOT t.archived)
         AND (t.temporal_event_at IS NOT NULL OR t.event_started_at IS NOT NULL OR t.event_ended_at IS NOT NULL)
         AND ($3::timestamptz IS NULL OR COALESCE(t.event_ended_at, t.temporal_event_at, t.event_started_at) >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR COALESCE(t.event_started_at, t.temporal_event_at, t.event_ended_at) <= $4::timestamptz)

       UNION ALL

       SELECT 'document'::text AS source_type,
              d.id,
              pgp_sym_decrypt(d.content_enc, $2)::text AS content,
              d.title,
              COALESCE(d.metadata, '{}'::jsonb) AS metadata,
              d.project,
              d.created_by,
              NULL::timestamptz AS event_at,
              d.event_started_at,
              d.event_ended_at,
              d.created_at,
              1.0::float8 AS temporal_score
       FROM documents d
       WHERE d.bank_id = $1
         AND ($7::boolean OR d.status = 'active')
         AND (d.event_started_at IS NOT NULL OR d.event_ended_at IS NOT NULL)
         AND ($3::timestamptz IS NULL OR COALESCE(d.event_ended_at, d.event_started_at) >= $3::timestamptz)
         AND ($4::timestamptz IS NULL OR COALESCE(d.event_started_at, d.event_ended_at) <= $4::timestamptz)
     )
     SELECT source_type, id, content, title, metadata, project,
            event_at, event_started_at, event_ended_at, created_at, temporal_score
     FROM temporal_candidates
     WHERE ($5::text IS NULL OR project = $5)
       AND ($6::text IS NULL OR created_by = $6)
     ORDER BY temporal_score DESC,
              COALESCE(event_at, event_started_at, event_ended_at, created_at) DESC
     LIMIT $8`,
    [
      bankId,
      key,
      options.time_start ?? null,
      options.time_end ?? null,
      options.project ?? null,
      options.created_by ?? null,
      options.include_archived ?? false,
      limit,
    ]
  );

  return rows;
}

export async function insertMemoryLink(
  pool: pg.Pool,
  link: MemoryLinkInput
): Promise<MemoryLinkRow> {
  const { rows } = await pool.query<MemoryLinkRow>(
    `INSERT INTO memory_links (
       bank_id, source_type, source_id, target_type, target_id, relationship, weight, inferred
     )
     VALUES (COALESCE($1, 'openbrain'), $2, $3, $4, $5, $6, COALESCE($7, 1.0), COALESCE($8, true))
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET
       bank_id = EXCLUDED.bank_id,
       weight = EXCLUDED.weight,
       inferred = EXCLUDED.inferred
     RETURNING id, source_type, source_id, target_type, target_id, relationship,
               bank_id, weight, inferred, created_at`,
    [
      link.bank_id ?? null,
      link.source_type,
      link.source_id,
      link.target_type,
      link.target_id,
      link.relationship,
      link.weight ?? null,
      link.inferred ?? null,
    ]
  );
  return rows[0]!;
}

export async function getMemoryLink(
  pool: pg.Pool,
  id: string
): Promise<MemoryLinkRow | null> {
  const { rows } = await pool.query<MemoryLinkRow>(
    `SELECT ${memoryLinkReturnColumns()}
     FROM memory_links
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listMemoryLinks(
  pool: pg.Pool,
  options: MemoryLinkListOptions = {}
): Promise<MemoryLinkRow[]> {
  const params: unknown[] = [];
  const where = buildMemoryLinkFilters(options, params);
  params.push(boundedMemoryLinkLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query<MemoryLinkRow>(
    `SELECT ${memoryLinkReturnColumns()}
     FROM memory_links
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

export async function expandMemoryLinks(
  pool: pg.Pool,
  options: MemoryLinkExpandOptions
): Promise<MemoryLinkExpansionRow[]> {
  if (!options.seeds || options.seeds.length === 0) return [];

  const direction = options.direction ?? "both";
  const joinPredicates: string[] = [];
  if (direction === "both" || direction === "outgoing") {
    joinPredicates.push("(ml.source_type = s.source_type AND ml.source_id = s.source_id)");
  }
  if (direction === "both" || direction === "incoming") {
    joinPredicates.push("(ml.target_type = s.source_type AND ml.target_id = s.source_id)");
  }
  if (joinPredicates.length === 0) return [];

  const key = getCipherKey();
  const params: unknown[] = [options.bank_id ?? "openbrain", JSON.stringify(options.seeds), key];
  let relationshipFilter = "";
  if (options.relationship !== undefined) {
    params.push(options.relationship);
    relationshipFilter = `AND ml.relationship = $${params.length}`;
  }
  params.push(options.include_archived ?? false);
  const includeArchivedPlaceholder = `$${params.length}`;
  params.push(boundedMemoryLinkLimit(options.limit));
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await pool.query<MemoryLinkExpansionRow>(
    `WITH seeds AS (
       SELECT source_type, source_id
       FROM jsonb_to_recordset($2::jsonb) AS s(source_type text, source_id uuid)
     ),
     candidate_links AS (
       SELECT ml.id,
              ml.bank_id,
              ml.source_type,
              ml.source_id,
              ml.target_type,
              ml.target_id,
              ml.relationship,
              ml.weight,
              ml.inferred,
              ml.created_at,
              s.source_type AS seed_type,
              s.source_id AS seed_id,
              CASE
                WHEN ml.source_type = s.source_type AND ml.source_id = s.source_id THEN 'outgoing'
                ELSE 'incoming'
              END AS direction,
              CASE
                WHEN ml.source_type = s.source_type AND ml.source_id = s.source_id THEN ml.target_type
                ELSE ml.source_type
              END AS linked_type,
              CASE
                WHEN ml.source_type = s.source_type AND ml.source_id = s.source_id THEN ml.target_id
                ELSE ml.source_id
              END AS linked_id
       FROM memory_links ml
       JOIN seeds s ON (${joinPredicates.join(" OR ")})
       WHERE ml.bank_id = $1
         ${relationshipFilter}
     )
     SELECT cl.id,
            cl.bank_id,
            cl.source_type,
            cl.source_id,
            cl.target_type,
            cl.target_id,
            cl.relationship,
            cl.weight,
            cl.inferred,
            cl.created_at,
            cl.seed_type,
            cl.seed_id,
            cl.direction,
            cl.linked_type,
            cl.linked_id,
            COALESCE(
              CASE WHEN cl.linked_type = 'thought' THEN pgp_sym_decrypt(t.content_enc, $3)::text END,
              CASE WHEN cl.linked_type = 'document' THEN pgp_sym_decrypt(d.content_enc, $3)::text END,
              CASE WHEN cl.linked_type = 'chunk' THEN pgp_sym_decrypt(dc.content_enc, $3)::text END,
              CASE WHEN cl.linked_type = 'consolidated_observation' THEN pgp_sym_decrypt(co.content_enc, $3)::text END,
              CASE WHEN cl.linked_type = 'experience' THEN pgp_sym_decrypt(e.content_enc, $3)::text END,
              CASE WHEN cl.linked_type = 'mental_model' THEN pgp_sym_decrypt(mm.content_enc, $3)::text END
            ) AS linked_content,
            CASE
              WHEN cl.linked_type = 'document' THEN d.title
              WHEN cl.linked_type = 'mental_model' THEN mm.name
              ELSE NULL
            END AS linked_title,
            CASE
              WHEN cl.linked_type = 'thought' THEN t.metadata
              WHEN cl.linked_type = 'document' THEN d.metadata
              WHEN cl.linked_type = 'chunk' THEN dc.metadata
              WHEN cl.linked_type = 'consolidated_observation' THEN jsonb_build_object(
                'proof_count', co.proof_count,
                'source_memory_ids', co.source_memory_ids,
                'tags', co.tags,
                'trend', co.trend
              )
              WHEN cl.linked_type = 'experience' THEN e.refs
              WHEN cl.linked_type = 'mental_model' THEN mm.structured
              ELSE NULL
            END AS linked_metadata,
            CASE
              WHEN cl.linked_type = 'thought' THEN t.project
              WHEN cl.linked_type = 'document' THEN d.project
              WHEN cl.linked_type = 'consolidated_observation' THEN co.project
              WHEN cl.linked_type = 'experience' THEN e.project
              WHEN cl.linked_type = 'mental_model' THEN mm.project
              ELSE NULL
            END AS linked_project,
            CASE
              WHEN cl.linked_type = 'thought' THEN t.created_at
              WHEN cl.linked_type = 'document' THEN d.created_at
              WHEN cl.linked_type = 'chunk' THEN dc.created_at
              WHEN cl.linked_type = 'consolidated_observation' THEN co.created_at
              WHEN cl.linked_type = 'experience' THEN e.created_at
              WHEN cl.linked_type = 'mental_model' THEN mm.created_at
              ELSE NULL
            END AS linked_created_at
     FROM candidate_links cl
     LEFT JOIN thoughts t ON cl.linked_type = 'thought' AND t.id = cl.linked_id
     LEFT JOIN documents d ON cl.linked_type = 'document' AND d.id = cl.linked_id
     LEFT JOIN document_chunks dc ON cl.linked_type = 'chunk' AND dc.id = cl.linked_id
     LEFT JOIN consolidated_observations co ON cl.linked_type = 'consolidated_observation' AND co.id = cl.linked_id
     LEFT JOIN experiences e ON cl.linked_type = 'experience' AND e.id = cl.linked_id
     LEFT JOIN mental_models mm ON cl.linked_type = 'mental_model' AND mm.id = cl.linked_id
     WHERE (${includeArchivedPlaceholder}::boolean
       OR (
         (cl.linked_type <> 'thought' OR COALESCE(t.archived, false) = false)
         AND (cl.linked_type <> 'document' OR COALESCE(d.status, 'active') = 'active')
         AND (cl.linked_type <> 'consolidated_observation' OR COALESCE(co.archived, false) = false)
         AND (cl.linked_type <> 'mental_model' OR COALESCE(mm.active, true) = true)
       ))
     ORDER BY cl.created_at DESC, cl.id DESC
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

export async function inferExperienceTemporalLinks(
  pool: pg.Pool,
  options: MemoryLinkInferOptions = {}
): Promise<MemoryLinkRow[]> {
  const params: unknown[] = [options.bank_id ?? "openbrain"];
  let sessionFilter = "";
  if (options.session_id !== undefined) {
    params.push(options.session_id);
    sessionFilter = `AND session_id = $${params.length}`;
  }

  const { rows } = await pool.query<MemoryLinkRow>(
    `WITH ordered_experiences AS (
       SELECT id,
              bank_id,
              session_id,
              LAG(id) OVER (
                PARTITION BY bank_id, session_id
                ORDER BY occurred_at ASC, created_at ASC, id ASC
              ) AS previous_id
       FROM experiences
       WHERE bank_id = $1
         AND session_id IS NOT NULL
         ${sessionFilter}
     )
     INSERT INTO memory_links (
       bank_id, source_type, source_id, target_type, target_id, relationship, weight, inferred
     )
     SELECT bank_id,
            'experience',
            id,
            'experience',
            previous_id,
            'temporal_after',
            1.0,
            true
     FROM ordered_experiences
     WHERE previous_id IS NOT NULL
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET
       bank_id = EXCLUDED.bank_id,
       weight = EXCLUDED.weight,
       inferred = true
     RETURNING id, bank_id, source_type, source_id, target_type, target_id, relationship,
               weight, inferred, created_at`,
    params
  );
  return rows;
}

export async function inferSupersedesMemoryLinks(
  pool: pg.Pool,
  options: MemoryLinkInferOptions = {}
): Promise<MemoryLinkRow[]> {
  const { rows } = await pool.query<MemoryLinkRow>(
    `INSERT INTO memory_links (
       bank_id, source_type, source_id, target_type, target_id, relationship, weight, inferred
     )
     SELECT bank_id,
            'thought',
            id,
            'thought',
            supersedes,
            'supersedes',
            1.0,
            true
     FROM thoughts
     WHERE bank_id = $1
       AND supersedes IS NOT NULL
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET
       bank_id = EXCLUDED.bank_id,
       weight = EXCLUDED.weight,
       inferred = true
     RETURNING id, bank_id, source_type, source_id, target_type, target_id, relationship,
               weight, inferred, created_at`,
    [options.bank_id ?? "openbrain"]
  );
  return rows;
}

export async function inferExperienceReferenceLinks(
  pool: pg.Pool,
  options: MemoryLinkInferOptions = {}
): Promise<MemoryLinkRow[]> {
  const params: unknown[] = [options.bank_id ?? "openbrain"];
  let sessionFilter = "";
  if (options.session_id !== undefined) {
    params.push(options.session_id);
    sessionFilter = `AND e.session_id = $${params.length}`;
  }

  const { rows } = await pool.query<MemoryLinkRow>(
    `WITH referenced_observations AS (
       SELECT e.bank_id,
              e.id AS source_id,
              ref_id::uuid AS target_id
       FROM experiences e
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(e.refs->'consolidated_observations') = 'array'
           THEN e.refs->'consolidated_observations'
           ELSE '[]'::jsonb
         END
       ) AS refs(ref_id)
       WHERE e.bank_id = $1
         ${sessionFilter}
         AND ref_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     )
     INSERT INTO memory_links (
       bank_id, source_type, source_id, target_type, target_id, relationship, weight, inferred
     )
     SELECT bank_id,
            'experience',
            source_id,
            'consolidated_observation',
            target_id,
            'evidence_for',
            1.0,
            true
     FROM referenced_observations
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET
       bank_id = EXCLUDED.bank_id,
       weight = EXCLUDED.weight,
       inferred = true
     RETURNING id, bank_id, source_type, source_id, target_type, target_id, relationship,
               weight, inferred, created_at`,
    params
  );
  return rows;
}


// ─── Memory Bank Context ─────────────────────────────────────────────

interface MemoryBankContextRow {
  id: string;
  name: string;
  mission: string | null;
  disposition: Record<string, unknown> | null;
  project: string | null;
  directive_id: string | null;
  directive_name: string | null;
  directive_rule_text: string | null;
  directive_applies_to: string[] | null;
  directive_severity: string | null;
  directive_priority: number | null;
  directive_revision: number | null;
  directive_created_at: Date | null;
  directive_updated_at: Date | null;
}

export async function getMemoryBankContext(
  pool: pg.Pool,
  bankId = "openbrain",
  appliesTo = "reflect"
): Promise<MemoryBankContext | null> {
  const { rows } = await pool.query<MemoryBankContextRow>(
    `SELECT mb.id,
            mb.name,
            mb.mission,
            mb.disposition,
            mb.project,
            d.id AS directive_id,
            d.name AS directive_name,
            d.rule_text AS directive_rule_text,
            d.applies_to AS directive_applies_to,
            d.severity AS directive_severity,
            d.priority AS directive_priority,
            d.revision AS directive_revision,
            d.created_at AS directive_created_at,
            d.updated_at AS directive_updated_at
     FROM memory_banks mb
     LEFT JOIN directives d
       ON d.bank_id = mb.id
      AND d.active = true
      AND d.applies_to ? $2
     WHERE mb.id = $1
     ORDER BY d.priority DESC NULLS LAST, d.name ASC NULLS LAST`,
    [bankId, appliesTo]
  );

  if (rows.length === 0) return null;
  const first = rows[0]!;
  return {
    id: first.id,
    name: first.name,
    mission: first.mission,
    disposition: first.disposition ?? {},
    project: first.project,
    directives: rows
      .filter((row) => row.directive_id !== null)
      .map((row) => ({
        id: row.directive_id!,
        bank_id: first.id,
        name: row.directive_name!,
        rule_text: row.directive_rule_text!,
        applies_to: row.directive_applies_to ?? [],
        severity: row.directive_severity!,
        active: true,
        priority: row.directive_priority ?? 0,
        revision: row.directive_revision ?? 1,
        created_at: row.directive_created_at,
        updated_at: row.directive_updated_at,
      })),
  };
}


// ─── Consolidation Jobs ─────────────────────────────────────────────

export async function enqueueConsolidationJob(
  pool: pg.Pool,
  job: ConsolidationJobEnqueueInput
): Promise<ConsolidationJobRow> {
  const { rows } = await pool.query<ConsolidationJobRow>(
    `INSERT INTO consolidation_jobs (bank_id, job_type, input, status)
     VALUES (COALESCE($1, 'openbrain'), $2, $3::jsonb, 'queued')
     RETURNING id, bank_id, job_type, status, input, output, error,
               started_at, finished_at, attempts, created_at`,
    [job.bank_id ?? null, job.job_type, JSON.stringify(job.input ?? {})]
  );
  return rows[0]!;
}

export async function getConsolidationJob(
  pool: pg.Pool,
  id: string
): Promise<ConsolidationJobRow | null> {
  const { rows } = await pool.query<ConsolidationJobRow>(
    `SELECT id, bank_id, job_type, status, input, output, error,
            started_at, finished_at, attempts, created_at
     FROM consolidation_jobs
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function startConsolidationJob(
  pool: pg.Pool,
  id: string
): Promise<ConsolidationJobRow | null> {
  const { rows } = await pool.query<ConsolidationJobRow>(
    `UPDATE consolidation_jobs
     SET status = 'running',
         attempts = attempts + 1,
         started_at = now(),
         finished_at = NULL,
         error = NULL
     WHERE id = $1 AND status IN ('queued', 'error')
     RETURNING id, bank_id, job_type, status, input, output, error,
               started_at, finished_at, attempts, created_at`,
    [id]
  );
  return rows[0] ?? null;
}

export async function completeConsolidationJob(
  pool: pg.Pool,
  id: string,
  output: Record<string, unknown>
): Promise<ConsolidationJobRow> {
  const { rows } = await pool.query<ConsolidationJobRow>(
    `UPDATE consolidation_jobs
     SET status = 'success',
         output = $2::jsonb,
         error = NULL,
         finished_at = now()
     WHERE id = $1
     RETURNING id, bank_id, job_type, status, input, output, error,
               started_at, finished_at, attempts, created_at`,
    [id, JSON.stringify(output)]
  );
  if (rows.length === 0) {
    throw new Error(`Consolidation job not found: ${id}`);
  }
  return rows[0]!;
}

export async function failConsolidationJob(
  pool: pg.Pool,
  id: string,
  error: string,
  output: Record<string, unknown> = {}
): Promise<ConsolidationJobRow> {
  const { rows } = await pool.query<ConsolidationJobRow>(
    `UPDATE consolidation_jobs
     SET status = 'error',
         error = $2,
         output = $3::jsonb,
         finished_at = now()
     WHERE id = $1
     RETURNING id, bank_id, job_type, status, input, output, error,
               started_at, finished_at, attempts, created_at`,
    [id, error, JSON.stringify(output)]
  );
  if (rows.length === 0) {
    throw new Error(`Consolidation job not found: ${id}`);
  }
  return rows[0]!;
}
// ─── Consolidation Worker: Job Claiming ──────────────────────────────

export interface ConsolidationCandidateGroup {
  bank_id: string;
  project: string | null;
  thought_ids: string[];
}

/**
 * Atomically claim the next queued consolidation job using
 * SELECT … FOR UPDATE SKIP LOCKED so multiple workers never
 * claim the same job.  Sets status = 'running' and increments
 * attempts in one step.
 */
export async function claimNextQueuedJob(
  pool: pg.Pool
): Promise<ConsolidationJobRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<ConsolidationJobRow>(
      `SELECT id, bank_id, job_type, status, input, output, error,
              started_at, finished_at, attempts, created_at
       FROM consolidation_jobs
       WHERE status = 'queued'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      []
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const job = rows[0]!;
    const { rows: updated } = await client.query<ConsolidationJobRow>(
      `UPDATE consolidation_jobs
       SET status = 'running',
           attempts = attempts + 1,
           started_at = now(),
           finished_at = NULL,
           error = NULL
       WHERE id = $1
       RETURNING id, bank_id, job_type, status, input, output, error,
                 started_at, finished_at, attempts, created_at`,
      [job.id]
    );
    await client.query("COMMIT");
    return updated[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Find clusters of unconsolidated thoughts that are eligible for
 * consolidation.  A thought is "unconsolidated" when it is:
 *   - NOT archived
 *   - NOT already referenced in any consolidated_observations.source_memory_ids
 *   - proof_count >= 1
 *
 * Returns groups of 2-5 thought IDs, bucketed by project.
 * Since thoughts don't have a bank_id column, we default bank_id
 * to 'openbrain' (the canonical memory bank).
 */
export async function findConsolidationCandidates(
  pool: pg.Pool
): Promise<ConsolidationCandidateGroup[]> {
  const { rows } = await pool.query(
    `WITH unconsolidated AS (
       SELECT
         COALESCE(t.project, '') AS project,
         t.id
       FROM thoughts t
       WHERE t.archived = false
         AND t.proof_count >= 1
         AND NOT EXISTS (
           SELECT 1 FROM consolidated_observations co
           WHERE co.source_memory_ids @> ARRAY[t.id]::uuid[]
             AND co.archived = false
         )
         AND NOT EXISTS (
           SELECT 1 FROM thoughts newer
           WHERE newer.supersedes = t.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM memory_links ml
           WHERE ml.target_type = 'thought'
             AND ml.target_id = t.id
             AND ml.source_type = 'thought'
             AND ml.relationship = 'supersedes'
         )
     ),
     grouped AS (
       SELECT
         project,
         array_agg(id ORDER BY id) AS ids
       FROM unconsolidated
       GROUP BY project
       HAVING count(*) >= 2
     )
     SELECT project, ids[1:5] AS thought_ids
     FROM grouped
     ORDER BY project`
  );
  return rows.map((row: Record<string, unknown>) => ({
    bank_id: "openbrain",
    project: row.project === "" ? null : (row.project as string),
    thought_ids: row.thought_ids as string[],
  }));
}