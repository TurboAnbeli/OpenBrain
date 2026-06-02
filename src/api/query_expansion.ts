/**
 * Stop-word-gated HyDE query expansion + Reciprocal Rank Fusion.
 *
 * Failure mode addressed: vocabulary-distance paraphrase. Three adversarial
 * cases on 2026-06-01 (paraphrase-005 medicine "flesh-eating disease",
 * paraphrase-006 trading "lifecycle phases accumulation to distribution",
 * and paraphrase-001 infra "agent control loop home server") embed too far
 * from canonical thoughts that use different vocabulary. Asking a small
 * local LLM to write a *hypothetical answer* to the query (HyDE — Hypothetical
 * Document Embeddings, Gao et al. 2022) lands the embedding near the
 * canonical's neighbourhood and lets RRF fusion recover it.
 *
 * Trade-offs accepted (per 2026-06-01 offline probe):
 *   + paraphrase-005 (NSTI/EAST): rank 7 → 2
 *   + paraphrase-006 (Weinstein Four-Stage): rank 7 → 1
 *   − paraphrase-002 (GBrain density): rank 3 → 7 (regression — HyDE pulls
 *     a different result set into the candidate pool and RRF dilutes
 *     the canonical's score; tried weighted RRF, didn't help)
 *   ~ paraphrase-001 (kimi-k2.6) and distractor-002 (OpenClaw): no change.
 *     The LLM doesn't have corpus-specific facts, hallucinates wrong
 *     directions ("SmolLM" instead of "kimi-k2.6"), so HyDE can't help.
 *   Latency: ~1.5s per gated query (smollm2:1.7b warmed).
 *
 * Gating: only fires when the query contains a stop word. Keyword-style
 * queries ("Friedland copper mining statistic supply") skip the LLM call
 * entirely — keeps baseline latency at ~100ms and avoids regressions on
 * the 24/32 baseline queries that don't benefit from expansion. The gate
 * is also mutually exclusive with the recency boost (recency-001/002/003
 * all PASS via recency alone, so adding HyDE on top would only add latency
 * without lift).
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "is", "are", "was", "were", "of", "in", "on", "for",
  "to", "by", "with", "and", "or", "but", "how", "what", "which", "why",
  "when", "where", "should", "could", "would", "can", "does", "do",
  "that", "this", "through", "at",
]);

export function shouldExpand(query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/);
  return tokens.some((t) => STOPWORDS.has(t.replace(/[.,?!;:]/g, "")));
}

const HYDE_PROMPT_TEMPLATE = (query: string): string =>
  `Write a single concise sentence that would directly answer this query, ` +
  `as a knowledge-base note. Be factual. Output only the sentence.\n\n` +
  `Query: ${query}\nAnswer:`;

export interface HydeOptions {
  endpoint: string;
  model: string;
  timeoutMs?: number;
}

export async function generateHydeAnswer(
  query: string,
  opts: HydeOptions
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const response = await fetch(`${opts.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: HYDE_PROMPT_TEMPLATE(query),
        stream: false,
        options: { num_predict: 60, temperature: 0, seed: 42 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    const text = (data.response ?? "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface RankedResult {
  id: string;
  content: string;
}

export function reciprocalRankFusion<T extends RankedResult>(
  resultLists: T[][],
  k: number = 60,
  top: number = 10
): T[] {
  const scored = new Map<string, { score: number; item: T }>();
  for (const results of resultLists) {
    results.forEach((r, idx) => {
      const key = r.id;
      const rank = idx + 1;
      const inc = 1 / (k + rank);
      const prev = scored.get(key);
      if (prev) prev.score += inc;
      else scored.set(key, { score: inc, item: r });
    });
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map((x) => x.item);
}
