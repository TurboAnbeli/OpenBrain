/**
 * Graph-first entity ranking for OpenBrain retrieval.
 *
 * Implements the "density imperative" from GBrain: exact relational hits
 * (thoughts that share entities with the query) are prioritised before
 * approximate semantic hits.  This addresses two measured failure modes:
 *
 *   1. Lexical-proper-noun anchor failure — e.g. "OpenClaw" queries that
 *      return generic coding-agent content because the embedding doesn't
 *      strongly weight the proper noun.  Entity linking surfaces the exact
 *      thoughts that mention OpenClaw.
 *   2. Entity disambiguation — when the same name refers to different
 *      concepts (e.g. "Hermes" the god vs "Hermes" the agent framework),
 *      the entity graph can distinguish them by surrounding context.
 *
 * The ranking fuses three result streams via weighted RRF:
 *   - entity hits (k=30, ~2× weight)
 *   - dense vector hits (k=60, standard)
 *   - BM25 hits (k=60, standard)
 *
 * Entity hits are fetched from the `search_thoughts_by_entity()` SQL
 * function which returns overlap_count (how many query entities each
 * thought shares).  Overlap_count is used as a tie-breaker within the
 * entity stream, not as an inter-stream score, preserving the RRF
 * semantics.
 *
 * Gating: entity ranking fires only when the query extracts at least
 * one entity name AND OPENBRAIN_ENTITY_RANKING is not "false".  This
 * keeps the fast path fast for queries that don't mention proper nouns.
 */

import type { SearchResult } from "../db/queries.js";
import { extractQueryEntities } from "./entity_extraction.js";

const ENTITY_K = 30;   // lower k → higher weight for entity hits
const STANDARD_K = 60; // standard RRF constant for vector / BM25

export interface EntityRankedResult {
  id: string;
  content: string;
  metadata: { type?: string; topics?: string[]; people?: string[] };
  created_at: Date;
  proof_count: number;
  similarity?: number;
  overlap_count?: number;
}

export function shouldUseEntityRanking(query: string): boolean {
  const enabled = (process.env.OPENBRAIN_ENTITY_RANKING ?? "true").toLowerCase() !== "false";
  if (!enabled) return false;
  const entities = extractQueryEntities(query);
  return entities.length > 0;
}

export function extractQueryEntityNames(query: string): string[] {
  return extractQueryEntities(query);
}

/**
 * Weighted reciprocal rank fusion: entity stream gets k=30 (higher weight),
 * other streams get k=60.  overlap_count from entity results is preserved
 * in the output for debugging.
 */
export function entityWeightedRRF(
  entityResults: Array<EntityRankedResult & { overlap_count: number }>,
  otherResultsLists: EntityRankedResult[][],
  top: number = 10
): EntityRankedResult[] {
  const scored = new Map<string, { score: number; item: EntityRankedResult }>();

  // Entity stream: weighted by lower k
  entityResults.forEach((r, idx) => {
    const rank = idx + 1;
    const inc = 1 / (ENTITY_K + rank);
    const prev = scored.get(r.id);
    if (prev) {
      prev.score += inc;
      // Keep the highest overlap_count if multiple streams hit the same id
      if ((r.overlap_count ?? 0) > (prev.item.overlap_count ?? 0)) {
        prev.item.overlap_count = r.overlap_count;
      }
    } else {
      scored.set(r.id, {
        score: inc,
        item: { ...r, overlap_count: r.overlap_count, similarity: r.similarity ?? 0 },
      });
    }
  });

  // Other streams: standard k
  for (const results of otherResultsLists) {
    results.forEach((r, idx) => {
      const rank = idx + 1;
      const inc = 1 / (STANDARD_K + rank);
      const prev = scored.get(r.id);
      if (prev) {
        prev.score += inc;
      } else {
        scored.set(r.id, { score: inc, item: { ...r } });
      }
    });
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map((x) => x.item);
}
