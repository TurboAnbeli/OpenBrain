/**
 * Specificity-conditional recency re-rank.
 *
 * When the search query contains a "specificity marker" (current, now, latest,
 * etc.), the caller is asking for present-state facts rather than topical
 * neighbours. Pure cosine similarity tends to favour topically-adjacent
 * framework / pattern thoughts over a single reference thought with the exact
 * current value — see adversarial case adv-recency-001.
 *
 * Blended distance:
 *     d = (1 - similarity) + W * clamp(age_days / HORIZON_DAYS, 0, 1)
 *
 * W=0.20 is the minimum that flips adv-recency-001 (2026-05-20 reference
 * thought) above the topically-adjacent framework thoughts on the failing
 * query, per the offline sweep on 2026-05-31. Higher weights swing the
 * baseline harder if the gate ever fires on a non-recency query.
 *
 * Caveat: this uses `created_at` (ingestion time), not metadata.dates[].
 * The two coincide for adv-recency-001 but a future thought ingested today
 * about a 2024 reality would be wrongly boosted.
 */

export const RECENCY_WEIGHT = 0.2;
export const RECENCY_HORIZON_DAYS = 90;

const SPECIFICITY_MARKERS: RegExp[] = [
  /\bcurrent\b/,
  /\bnow\b/,
  /\blatest\b/,
  /\btoday\b/,
  /\bin use\b/,
  /\bright now\b/,
];

export function hasSpecificityMarker(query: string): boolean {
  const q = query.toLowerCase();
  return SPECIFICITY_MARKERS.some((re) => re.test(q));
}

export function overfetchLimit(requestedLimit: number, boost: boolean): number {
  return boost ? Math.max(requestedLimit * 3, 30) : requestedLimit;
}

function ageFactor(createdAt: Date, nowMs: number = Date.now()): number {
  const ageMs = nowMs - createdAt.getTime();
  const horizonMs = RECENCY_HORIZON_DAYS * 86400 * 1000;
  if (ageMs <= 0) return 0;
  if (ageMs >= horizonMs) return 1;
  return ageMs / horizonMs;
}

export interface RankableResult {
  similarity: number;
  created_at: Date;
}

export function applyRecencyBoost<T extends RankableResult>(
  results: T[],
  weight: number = RECENCY_WEIGHT,
  nowMs: number = Date.now()
): T[] {
  return [...results].sort((a, b) => {
    const da = 1 - a.similarity + weight * ageFactor(a.created_at, nowMs);
    const db = 1 - b.similarity + weight * ageFactor(b.created_at, nowMs);
    return da - db;
  });
}
