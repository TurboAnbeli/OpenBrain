/**
 * Database queries for thoughts: insert, search, list, stats.
 * All queries use parameterized SQL (no interpolation).
 */

import type pg from "pg";

// ─── Types ───────────────────────────────────────────────────────────

export interface ThoughtMetadata {
  type?: string;
  topics?: string[];
  people?: string[];
  action_items?: string[];
  dates?: string[];
  source?: string;
}

export interface ThoughtRow {
  id: string;
  content: string;
  metadata: ThoughtMetadata;
  created_at: Date;
}

export interface SearchResult extends ThoughtRow {
  similarity: number;
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
}

// ─── Insert ──────────────────────────────────────────────────────────

export async function insertThought(
  pool: pg.Pool,
  content: string,
  embedding: number[],
  metadata: ThoughtMetadata
): Promise<ThoughtRow> {
  const embeddingStr = `[${embedding.join(",")}]`;

  const { rows } = await pool.query<ThoughtRow>(
    `INSERT INTO thoughts (content, embedding, metadata)
     VALUES ($1, $2::vector, $3::jsonb)
     RETURNING id, content, metadata, created_at`,
    [content, embeddingStr, JSON.stringify(metadata)]
  );

  return rows[0]!;
}

// ─── Semantic Search ─────────────────────────────────────────────────

export async function searchThoughts(
  pool: pg.Pool,
  queryEmbedding: number[],
  limit: number = 10,
  threshold: number = 0.5,
  filter: Record<string, unknown> = {}
): Promise<SearchResult[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const { rows } = await pool.query<SearchResult>(
    `SELECT id, content, metadata, similarity, created_at
     FROM match_thoughts($1::vector, $2, $3, $4::jsonb)`,
    [embeddingStr, threshold, limit, JSON.stringify(filter)]
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

  idx++;
  params.push(limit);

  const whereClause = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";

  const { rows } = await pool.query<ThoughtRow>(
    `SELECT id, content, metadata, created_at
     FROM thoughts
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${idx}`,
    params
  );

  return rows;
}

// ─── Statistics ──────────────────────────────────────────────────────

export async function getThoughtStats(pool: pg.Pool): Promise<ThoughtStats> {
  // Total count
  const countResult = await pool.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM thoughts"
  );
  const total = parseInt(countResult.rows[0]?.count ?? "0", 10);

  // Type distribution
  const typeResult = await pool.query<{ thought_type: string; count: string }>(
    `SELECT metadata->>'type' AS thought_type, COUNT(*)::text AS count
     FROM thoughts
     GROUP BY metadata->>'type'
     ORDER BY COUNT(*) DESC`
  );
  const types: Record<string, number> = {};
  for (const row of typeResult.rows) {
    types[row.thought_type ?? "unknown"] = parseInt(row.count, 10);
  }

  // Top topics
  const topicResult = await pool.query<{ topic: string; count: string }>(
    `SELECT topic, COUNT(*)::text AS count
     FROM thoughts, jsonb_array_elements_text(metadata->'topics') AS topic
     GROUP BY topic
     ORDER BY COUNT(*) DESC
     LIMIT 10`
  );
  const topTopics: [string, number][] = topicResult.rows.map((r) => [
    r.topic,
    parseInt(r.count, 10),
  ]);

  // Top people
  const peopleResult = await pool.query<{ person: string; count: string }>(
    `SELECT person, COUNT(*)::text AS count
     FROM thoughts, jsonb_array_elements_text(metadata->'people') AS person
     GROUP BY person
     ORDER BY COUNT(*) DESC
     LIMIT 10`
  );
  const topPeople: [string, number][] = peopleResult.rows.map((r) => [
    r.person,
    parseInt(r.count, 10),
  ]);

  // Date range
  const rangeResult = await pool.query<{ earliest: Date | null; latest: Date | null }>(
    "SELECT MIN(created_at) AS earliest, MAX(created_at) AS latest FROM thoughts"
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
