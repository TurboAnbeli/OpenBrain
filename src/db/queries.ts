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
  status: DocumentStatus;
  created_at: Date;
  updated_at: Date;
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
    `INSERT INTO documents (title, source_type, source_uri, content_enc, metadata, project, created_by, fts)
     VALUES ($1, $2, $3, pgp_sym_encrypt($4, $8), $5::jsonb, $6, $7, to_tsvector('english', $4))
     RETURNING id, title, source_type, source_uri,
               pgp_sym_decrypt(content_enc, $8)::text AS content,
               metadata, project, created_by, status, created_at, updated_at`,
    [
      document.title,
      document.source_type,
      document.source_uri ?? null,
      document.content,
      JSON.stringify(document.metadata ?? {}),
      document.project ?? null,
      document.created_by ?? null,
      key,
    ]
  );
  return rows[0]!;
}

export async function getDocument(
  pool: pg.Pool,
  id: string
): Promise<DocumentRow | null> {
  const key = getCipherKey();
  const { rows } = await pool.query<DocumentRow>(
    `SELECT id, title, source_type, source_uri,
            pgp_sym_decrypt(content_enc, $2)::text AS content,
            metadata, project, created_by, status, created_at, updated_at
     FROM documents
     WHERE id = $1 AND status != 'deleted'`,
    [id, key]
  );
  return rows[0] ?? null;
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

    const existingResult = await client.query<DocumentRow>(
      `SELECT id, title, source_type, source_uri,
              pgp_sym_decrypt(content_enc, $2)::text AS content,
              metadata, project, created_by, status, created_at, updated_at
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
           content_enc = pgp_sym_encrypt($4, $8),
           metadata = $5::jsonb,
           status = $6,
           fts = to_tsvector('english', $4),
           updated_at = now()
       WHERE id = $1
       RETURNING id, title, source_type, source_uri,
                 pgp_sym_decrypt(content_enc, $8)::text AS content,
                 metadata, project, created_by, status, created_at, updated_at`,
      [
        id,
        newTitle,
        newSourceUri,
        newContent,
        JSON.stringify(newMetadata),
        newStatus,
        patch.updated_by ?? null,
        key,
      ]
    );

    if (!rowCount || rowCount === 0) {
      throw new Error(`Document not found: ${id}`);
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
