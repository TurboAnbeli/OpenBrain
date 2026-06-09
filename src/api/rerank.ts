/**
 * Query-time reranking for contradiction / negation-sensitive retrieval.
 *
 * Two backends:
 *   1. Cross-encoder (preferred): ONNX in-process, ~10–50 ms, deterministic.
 *   2. LLM reranker (fallback): Ollama round-trip, ~3–13 s, handles novel
 *      patterns the cross-encoder has never seen.
 *
 * The cross-encoder fires whenever it is loaded and the query has at least
 * OPENBRAIN_CROSS_ENCODER_MIN_CANDIDATES results (default 3).  The LLM
 * reranker only fires for negation queries (or always if
 * OPENBRAIN_RERANK_ALWAYS is set).
 */

import { isCrossEncoderLoaded, scorePairs } from "./cross_encoder.js";

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
  if ((process.env.OPENBRAIN_RERANK_ALWAYS ?? "false").toLowerCase() === "true") return true;
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
): Promise<{ results: T[] | null; fired: boolean }> {
  if (results.length < 2) return { results: null, fired: false };

  // 1. Try cross-encoder first (fast, deterministic)
  const ceOutput = await crossEncoderRerank(query, results);
  if (ceOutput.fired && ceOutput.results !== null) {
    return ceOutput;
  }

  // 2. Fall back to LLM reranker for negation / hard queries
  const topN = Math.min(opts.topN ?? 8, results.length);
  const candidates = results.slice(0, topN);
  const fallbackModel = process.env.OPENBRAIN_RERANK_FALLBACK_MODEL ?? opts.model;

  async function attempt(model: string): Promise<T[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);

    try {
      const response = await fetch(`${opts.endpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: buildPrompt(query, candidates),
          stream: false,
          think: false,
          format: "json",
          options: { num_predict: 220, temperature: 0, seed: 42 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const data = (await response.json()) as { response?: string };
      const parsed = parseRanking((data.response ?? "").trim());
      if (!parsed || parsed.ranking.length === 0) return null;

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
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // First attempt with primary model
  let reranked = await attempt(opts.model);
  if (reranked) {
    return { results: reranked, fired: true };
  }

  // Retry with fallback model (often a smaller/faster model)
  if (fallbackModel !== opts.model) {
    console.error(`[rerank] Primary model ${opts.model} failed; retrying with ${fallbackModel}`);
    reranked = await attempt(fallbackModel);
    if (reranked) {
      return { results: reranked, fired: true };
    }
  }

  // Final fallback to heuristics
  const heuristic = heuristicRerank(query, results);
  if (heuristic) {
    console.error("[rerank] LLM rerank failed; using heuristic fallback");
    return { results: heuristic, fired: true };
  }

  return { results: null, fired: false };
}

/**
 * Rerank top candidates using the in-process ONNX cross-encoder.
 * Returns null if the cross-encoder is not loaded or results are too few.
 */
export async function crossEncoderRerank<T extends RerankCandidate>(
  query: string,
  results: T[]
): Promise<{ results: T[] | null; fired: boolean }> {
  if (!isCrossEncoderLoaded()) return { results: null, fired: false };

  const minCandidates = parseInt(process.env.OPENBRAIN_CROSS_ENCODER_MIN_CANDIDATES ?? "3", 10);
  if (results.length < minCandidates) return { results: null, fired: false };

  const topN = Math.min(parseInt(process.env.OPENBRAIN_CROSS_ENCODER_TOPN ?? "12", 10), results.length);
  const candidates = results.slice(0, topN);

  try {
    const scores = await scorePairs(
      query,
      candidates.map((c) => c.content)
    );

    const indexed = candidates.map((c, i) => ({ candidate: c, score: scores[i], originalIdx: i }));
    indexed.sort((a, b) => {
      if (b.score! !== a.score!) return b.score! - a.score!;
      return a.originalIdx - b.originalIdx;
    });

    return {
      results: [...indexed.map((item) => item.candidate), ...results.slice(topN)],
      fired: true,
    };
  } catch (err) {
    console.error("[cross-encoder] rerank failed:", (err as Error).message);
    return { results: null, fired: false };
  }
}
