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
 * Temporal signal priority follows the same split Hindsight documents between
 * "when it happened" and "when you learned it":
 *   1. explicit occurrence dates from metadata.dates[]
 *   2. explicit ISO dates parsed from the content itself
 *   3. created_at as a learned-at fallback
 *
 * This keeps late-ingested historical notes from automatically outranking a
 * slightly older but more exact current-state fact.
 */

export const RECENCY_WEIGHT = 0.2;
export const RECENCY_HORIZON_DAYS = 90;
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?)?\b/g;

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
  content?: string;
  metadata?: {
    dates?: string[];
  };
}

function toDate(value: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestDate(values: Iterable<string>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = toDate(value);
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) {
      latest = date;
    }
  }
  return latest;
}

function parseLatestDateFromContent(content?: string): Date | null {
  if (!content) return null;
  const matches = content.matchAll(ISO_DATE_RE);
  const dates: string[] = [];
  for (const match of matches) {
    if (match[0]) dates.push(match[0]);
  }
  return latestDate(dates);
}

export function getEffectiveDate(result: RankableResult): Date {
  const metadataDate = latestDate(result.metadata?.dates ?? []);
  if (metadataDate) return metadataDate;

  const contentDate = parseLatestDateFromContent(result.content);
  if (contentDate) return contentDate;

  return result.created_at;
}

export function applyRecencyBoost<T extends RankableResult>(
  results: T[],
  weight: number = RECENCY_WEIGHT,
  nowMs: number = Date.now()
): T[] {
  return [...results].sort((a, b) => {
    const da = 1 - a.similarity + weight * ageFactor(getEffectiveDate(a), nowMs);
    const db = 1 - b.similarity + weight * ageFactor(getEffectiveDate(b), nowMs);
    return da - db;
  });
}
