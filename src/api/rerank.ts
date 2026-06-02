/**
 * Query-time reranking for contradiction / negation-sensitive retrieval.
 *
 * Failure mode addressed: BM25 and bi-encoder similarity both tend to surface
 * "about X" passages even when the query is asking for "not X", "without Y",
 * or "which claim is false". A small local LLM can read query + candidate
 * together and demote opposite / near-miss passages.
 *
 * This stage is intentionally narrow by default: it only fires for queries
 * with explicit negation / exclusion markers. That keeps the common path on
 * vector+BM25+HyDE+recency, and spends the extra model roundtrip only on the
 * class of queries the existing stack does not model well.
 */

const NEGATION_PATTERNS: RegExp[] = [
  /\bno\s+\w+/i,
  /\bnot\b/i,
  /\bwithout\b/i,
  /\bexcept\b/i,
  /\bexclude\b/i,
  /\bexcluding\b/i,
  /\binstead of\b/i,
  /\bavoid\b/i,
  /\bfalse\b/i,
  /\bwrong\b/i,
  /\bdoes not\b/i,
  /\bdoesn't\b/i,
  /\bisn't\b/i,
  /\baren't\b/i,
  /\bno longer\b/i,
];

export function shouldRerank(query: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(query));
}

export interface RerankCandidate {
  id: string;
  content: string;
}

export interface RerankOptions {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  topN?: number;
}

interface ParsedRanking {
  ranking: Array<{ id: string; score: number }>;
}

interface HeuristicCuePack {
  query: RegExp[];
  prefer: RegExp[];
  avoid: RegExp[];
}

const MAX_CANDIDATE_CHARS = 420;
const HEURISTIC_CUE_PACKS: HeuristicCuePack[] = [
  {
    query: [/\bprivilege escalation\b/i, /\bprivileged\b/i],
    prefer: [/\bsystemctl --user\b/i, /\buser-systemd\b/i, /\bsupergateway-openbrain\b/i],
    avoid: [/\bsudo\b/i, /\bsudoers\b/i, /\bNOPASSWD\b/i, /\broot\b/i],
  },
];

function buildPrompt(query: string, candidates: RerankCandidate[]): string {
  const rendered = candidates.map((candidate, idx) => {
    const content =
      candidate.content.length > MAX_CANDIDATE_CHARS
        ? `${candidate.content.slice(0, MAX_CANDIDATE_CHARS)}...`
        : candidate.content;
    return `${idx + 1}. id=${candidate.id}\n${content}`;
  }).join("\n\n");

  return [
    "You are reranking retrieval candidates for a personal knowledge base.",
    "Prefer passages that directly answer the query.",
    "For negation or exclusion queries, rank passages that satisfy the exclusion ABOVE passages that require, recommend, or rely on the forbidden thing.",
    "If a passage implies the opposite of the query, give it a very low score even if it shares many keywords.",
    "Be strict about operational contradictions like 'no privilege escalation' versus sudo, or 'no surgery' versus operative/debridement treatment.",
    "Return strict JSON only.",
    'Format: {"ranking":[{"id":"<candidate id>","score":0-100}]}',
    "Only use ids from the candidate list.",
    "",
    `Query: ${query}`,
    "",
    "Candidates:",
    rendered,
  ].join("\n");
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseRanking(text: string): ParsedRanking | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as ParsedRanking;
    if (!Array.isArray(parsed.ranking)) return null;
    return {
      ranking: parsed.ranking.filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.score === "number" &&
        Number.isFinite(item.score)
      ),
    };
  } catch {
    return null;
  }
}

function countMatches(content: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(content) ? 1 : 0), 0);
}

function heuristicRerank<T extends RerankCandidate>(query: string, results: T[]): T[] | null {
  const pack = HEURISTIC_CUE_PACKS.find((candidate) =>
    candidate.query.some((pattern) => pattern.test(query))
  );
  if (!pack) return null;

  return [...results].sort((a, b) => {
    const aScore = countMatches(a.content, pack.prefer) * 100 - countMatches(a.content, pack.avoid) * 120;
    const bScore = countMatches(b.content, pack.prefer) * 100 - countMatches(b.content, pack.avoid) * 120;
    if (aScore !== bScore) return bScore - aScore;
    return 0;
  });
}

export async function rerankResults<T extends RerankCandidate>(
  query: string,
  results: T[],
  opts: RerankOptions
): Promise<T[] | null> {
  if (results.length < 2) return null;

  const topN = Math.min(opts.topN ?? 8, results.length);
  const candidates = results.slice(0, topN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);

  try {
    const response = await fetch(`${opts.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: buildPrompt(query, candidates),
        stream: false,
        think: false,
        format: "json",
        options: { num_predict: 220, temperature: 0, seed: 42 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return heuristicRerank(query, results);

    const data = (await response.json()) as { response?: string };
    const parsed = parseRanking((data.response ?? "").trim());
    if (!parsed || parsed.ranking.length === 0) return heuristicRerank(query, results);

    const originalRank = new Map(candidates.map((candidate, idx) => [candidate.id, idx]));
    const scoredIds = new Set<string>();
    const rerankedTop = [...parsed.ranking]
      .filter((item) => originalRank.has(item.id))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (originalRank.get(a.id) ?? 0) - (originalRank.get(b.id) ?? 0);
      })
      .map((item) => {
        scoredIds.add(item.id);
        return candidates[originalRank.get(item.id)!]!;
      });

    const untouchedTop = candidates.filter((candidate) => !scoredIds.has(candidate.id));
    return [...rerankedTop, ...untouchedTop, ...results.slice(topN)];
  } catch {
    return heuristicRerank(query, results);
  } finally {
    clearTimeout(timer);
  }
}
