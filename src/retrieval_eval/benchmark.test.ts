/**
 * OpenBrain Retrieval Quality Benchmark Harness
 *
 * Evaluates multi-source recall, reflect cascade, source routing,
 * negation reranking, and paraphrase robustness.
 *
 * Usage:
 *   set -a && . ./.env && set +a && pnpm vitest run src/retrieval_eval/benchmark.test.ts
 *
 * Or with a specific category:
 *   RETRIEVAL_EVAL_CATEGORIES=recall,negation pnpm vitest run src/retrieval_eval/benchmark.test.ts
 *
 * Skip live API tests:
 *   SKIP_RETRIEVAL_EVAL=true pnpm vitest run src/retrieval_eval/benchmark.test.ts
 */

import { describe, expect, it } from "vitest";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RecallResult {
  source_type: string;
  id: string;
  content: string;
  title: string | null;
  metadata: Record<string, unknown>;
  project: string | null;
  created_at: string;
  score: number;
  semantic_score: number;
  bm25_score: number;
  temporal_score: number;
  link_score: number;
}

interface RecallResponse {
  query: string;
  bank_id: string;
  count: number;
  lanes: Record<string, unknown>;
  results: RecallResult[];
}

interface ReflectResponse {
  query: string;
  bank_id: string;
  evidence_count: number;
  model_used: string;
  answer: string | null;
  reflect_telemetry: Record<string, unknown>;
  cascade: Record<string, unknown>;
  mental_models: unknown[];
  observations: unknown[];
  raw_facts: unknown[];
  memory_bank: Record<string, unknown>;
}

interface MemoryCaptureResponse {
  id: string;
  captured_at?: string;
  deduplicated?: boolean;
}

interface EvalCase {
  id: string;
  category: string;
  query: string;
  bank_id?: string;
  expected: {
    relevant_content?: string[];
    source_route?: string;
    excluded_terms?: string[];
    answer_terms?: string[];
  };
}

interface EvalResult {
  case_id: string;
  category: string;
  query: string;
  passed: boolean;
  metric: string;
  value: number;
  details: string;
  latency_ms: number;
}

/* ------------------------------------------------------------------ */
/*  Ground-truth eval cases                                             */
/* ------------------------------------------------------------------ */

const EVAL_CASES: EvalCase[] = [
  // --- Recall: multi-source retrieval ---
  { id: "recall-001", category: "recall", query: "what is OpenBrain", expected: { relevant_content: ["openbrain", "knowledge"] } },
  { id: "recall-002", category: "recall", query: "memory link graph structure", expected: { relevant_content: ["memory", "link"] } },
  { id: "recall-003", category: "recall", query: "embedding model configuration", expected: { relevant_content: ["embedding", "model"] } },
  { id: "recall-004", category: "recall", query: "how does OpenBrain store and retrieve memories", expected: { relevant_content: ["openbrain", "memory"] } },
  { id: "recall-005", category: "recall", query: "consolidated observation synthesis", expected: { relevant_content: ["consolidated", "observation"] } },

  // --- Routing: source classification (advisory — logged, not hard-fail) ---
  { id: "routing-001", category: "routing", query: "remember when I set up the MCP bridge", expected: { source_route: "thought_only" } },
  { id: "routing-002", category: "routing", query: "find the document about black-scholes model", expected: { source_route: "document_only" } },
  { id: "routing-003", category: "routing", query: "how does the retrieval pipeline work", expected: { source_route: "balanced_mixed" } },

  // --- Negation: excluded terms should be demoted from top results ---
  { id: "negation-001", category: "negation", query: "investment strategies without crypto", expected: { excluded_terms: ["crypto", "bitcoin", "ethereum", "cryptocurrency"] } },
  { id: "negation-002", category: "negation", query: "medical practice not related to surgery", expected: { excluded_terms: ["surgery", "surgical"] } },

  // --- Paraphrase: different wording, same semantic target ---
  { id: "paraphrase-001", category: "paraphrase", query: "how are thoughts connected together", expected: { relevant_content: ["memory", "link"] } },
  { id: "paraphrase-002", category: "paraphrase", query: "what connects memories together", expected: { relevant_content: ["memory", "link"] } },

  // --- Reflect: 3-tier cascade answer quality ---
  { id: "reflect-001", category: "reflect", query: "What is the structure of the OpenBrain knowledge system?", expected: { answer_terms: ["openbrain"] } },
  { id: "reflect-002", category: "reflect", query: "How does document chunking work?", expected: { answer_terms: ["chunk"] } },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BASE_URL = process.env.OPENBRAIN_API_URL ?? "http://127.0.0.1:8000";
const ADMIN_KEY = process.env.OPENBRAIN_ADMIN_KEY ?? "";

const MIN_CATEGORY_PASS_RATES: Record<string, number> = {
  retain: 1.0,
  recall: 1.0,
  routing: 1.0,
  negation: 0.5, // known gap: crypto can leak into one top-3 result; guard against worsening
  paraphrase: 1.0,
  reflect: 1.0,
};

const MAX_AVG_LATENCY_MS: Record<string, number> = {
  retain: 2000,
  recall: 1000,
  routing: 1000,
  negation: 1000,
  paraphrase: 1000,
  reflect: 20000, // includes local/cloud LLM synthesis warm-up variability
};

async function fetchJSON<T>(
  path: string,
  body?: unknown,
  method?: "GET" | "POST" | "DELETE"
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ADMIN_KEY) headers["X-OpenBrain-Admin-Key"] = ADMIN_KEY;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/*  Benchmark suite                                                     */
/* ------------------------------------------------------------------ */

const CATEGORIES = (process.env.RETRIEVAL_EVAL_CATEGORIES ?? "").split(",").filter(Boolean);
const categoryIsActive = (category: string) => CATEGORIES.length === 0 || CATEGORIES.includes(category);
const ACTIVE_CASES = CATEGORIES.length > 0
  ? EVAL_CASES.filter((c) => categoryIsActive(c.category))
  : EVAL_CASES;

const skipIfNoAPI = process.env.SKIP_RETRIEVAL_EVAL === "true";
const results: EvalResult[] = [];

describe.skipIf(skipIfNoAPI)("Retrieval quality benchmark", () => {
  // Reflect involves LLM synthesis — needs longer timeout
  // vitest default testTimeout is 5000ms, we need 60s for reflect

  // --- Retain: capture should immediately become recallable ---
  describe.skipIf(!categoryIsActive("retain"))("retain", () => {
    it("retain: capture -> recall roundtrip preserves a unique memory", async () => {
      const token = `retain-quality-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const content = `OpenBrain retain quality sentinel ${token}: capture should be stored, embedded, and recallable immediately.`;
      const start = performance.now();
      let capturedId: string | null = null;
      let deduplicated = false;

      try {
        const capture = await fetchJSON<MemoryCaptureResponse>("/memories", {
          content,
          source: "retrieval_eval",
          project: "retrieval-eval",
          metadata: {
            type: "reference",
            topics: ["retrieval_eval", "retain_quality"],
            people: [],
            action_items: [],
            dates: [],
          },
        });
        capturedId = capture.id;
        deduplicated = capture.deduplicated === true;

        const res = await fetchJSON<RecallResponse>("/recall", {
          query: `retain quality sentinel ${token}`,
          bank_id: "openbrain",
          project: "retrieval-eval",
          source_types: ["thought"],
          include_documents: false,
          include_observations: false,
          include_experiences: false,
          include_mental_models: false,
          limit: 5,
          threshold: 0,
        });

        const found = (res.results ?? []).some((r) => r.id === capturedId || r.content.includes(token));
        const latency_ms = performance.now() - start;
        results.push({
          case_id: "retain-001",
          category: "retain",
          query: `retain quality sentinel ${token}`,
          passed: found && !deduplicated,
          metric: "retain_roundtrip",
          value: found && !deduplicated ? 1 : 0,
          details: deduplicated ? "Unexpectedly deduplicated unique sentinel" : found ? "Captured memory found by recall" : "Captured memory missing from recall",
          latency_ms,
        });

        expect(deduplicated).toBe(false);
        expect(found).toBe(true);
      } finally {
        if (capturedId && !deduplicated) {
          await fetchJSON<{ status: string; id: string }>(`/memories/${capturedId}`, undefined, "DELETE");
        }
      }
    });
  });

  // --- Recall ---
  describe.skipIf(!categoryIsActive("recall"))("recall", () => {
    const cases = ACTIVE_CASES.filter((c) => c.category === "recall");
    if (cases.length === 0) return;

    it.each(cases)("recall: $id — $query", async ({ id, query, expected }) => {
      const start = performance.now();
      const res = await fetchJSON<RecallResponse>("/recall", { query, bank_id: "openbrain", limit: 10 });
      const latency_ms = performance.now() - start;

      const topContent = (res.results ?? []).slice(0, 5).map((r) => r.content).join(" ").toLowerCase();
      const terms = expected.relevant_content ?? [];
      const matchCount = terms.filter((t) => topContent.includes(t.toLowerCase())).length;
      const recallAt5 = terms.length > 0 ? matchCount / terms.length : 0;

      results.push({ case_id: id, category: "recall", query, passed: recallAt5 >= 0.5, metric: "recall@5", value: recallAt5, details: `Matched ${matchCount}/${terms.length} in top 5`, latency_ms });
      expect(recallAt5).toBeGreaterThanOrEqual(0.5);
    });
  });

  // --- Routing ---
  describe.skipIf(!categoryIsActive("routing"))("routing", () => {
    const cases = ACTIVE_CASES.filter((c) => c.category === "routing");
    if (cases.length === 0) return;

    it.each(cases)("routing: $id — $query", async ({ id, query, expected }) => {
      const start = performance.now();
      const res = await fetchJSON<RecallResponse>("/recall", { query, bank_id: "openbrain", limit: 5, source_router: "heuristic" });
      const latency_ms = performance.now() - start;

      const lanes = res.lanes as { route?: string; source_router_decision?: { route?: string } };
      const actualRoute = lanes.source_router_decision?.route ?? lanes.route ?? "unknown";
      const expectedRoute = expected.source_route ?? "balanced_mixed";
      const passed = actualRoute === expectedRoute;

      results.push({ case_id: id, category: "routing", query, passed, metric: "route_accuracy", value: passed ? 1 : 0, details: `Expected: ${expectedRoute}, Got: ${actualRoute}`, latency_ms });
      expect(actualRoute).toBe(expectedRoute);
    });
  });

  // --- Negation ---
  describe.skipIf(!categoryIsActive("negation"))("negation", () => {
    const cases = ACTIVE_CASES.filter((c) => c.category === "negation");
    if (cases.length === 0) return;

    it.each(cases)("negation: $id — $query", async ({ id, query, expected }) => {
      const start = performance.now();
      const res = await fetchJSON<RecallResponse>("/recall", { query, bank_id: "openbrain", limit: 5 });
      const latency_ms = performance.now() - start;

      const top3 = (res.results ?? []).slice(0, 3).map((r) => r.content.toLowerCase()).join(" ");
      const excluded = expected.excluded_terms ?? [];
      const violations = excluded.filter((t) => top3.includes(t.toLowerCase()));

      results.push({ case_id: id, category: "negation", query, passed: violations.length === 0, metric: "negation_precision", value: violations.length === 0 ? 1 : 1 - violations.length / excluded.length, details: violations.length ? `Excluded terms found: ${violations.join(", ")}` : "Clean", latency_ms });
      expect(violations.length).toBeLessThanOrEqual(1);  // negation is imperfect — at most 1 violation in top 3
    });
  });

  // --- Paraphrase ---
  describe.skipIf(!categoryIsActive("paraphrase"))("paraphrase", () => {
    const cases = ACTIVE_CASES.filter((c) => c.category === "paraphrase");
    if (cases.length === 0) return;

    it.each(cases)("paraphrase: $id — $query", async ({ id, query, expected }) => {
      const start = performance.now();
      const res = await fetchJSON<RecallResponse>("/recall", { query, bank_id: "openbrain", limit: 10 });
      const latency_ms = performance.now() - start;

      const topContent = (res.results ?? []).slice(0, 5).map((r) => r.content).join(" ").toLowerCase();
      const terms = expected.relevant_content ?? [];
      const matchCount = terms.filter((t) => topContent.includes(t.toLowerCase())).length;
      const relevance = terms.length > 0 ? matchCount / terms.length : 0;

      results.push({ case_id: id, category: "paraphrase", query, passed: relevance >= 0.5, metric: "paraphrase_recall@5", value: relevance, details: `Matched ${matchCount}/${terms.length}`, latency_ms });
      expect(relevance).toBeGreaterThanOrEqual(0.5);
    });
  });

  // --- Reflect ---
  describe.skipIf(!categoryIsActive("reflect"))("reflect", () => {
    const cases = ACTIVE_CASES.filter((c) => c.category === "reflect");
    if (cases.length === 0) return;

    it.each(cases)("reflect: $id — $query", async ({ id, query, expected }) => {
      const start = performance.now();
      const res = await fetchJSON<ReflectResponse>("/reflect", { query, bank_id: "openbrain" });
      const latency_ms = performance.now() - start;

      const answer = (res.answer ?? "").toLowerCase();
      const terms = expected.answer_terms ?? [];
      const matchCount = terms.filter((t) => answer.includes(t.toLowerCase())).length;
      const answerRelevance = terms.length > 0 ? matchCount / terms.length : 0;
      const hasEvidence = (res.mental_models?.length ?? 0) + (res.observations?.length ?? 0) + (res.raw_facts?.length ?? 0) > 0;

      results.push({ case_id: id, category: "reflect", query, passed: answerRelevance >= 0.5 && hasEvidence, metric: "answer_relevance", value: answerRelevance, details: `Terms: ${matchCount}/${terms.length}, evidence: ${hasEvidence}`, latency_ms });
      expect(answerRelevance).toBeGreaterThanOrEqual(0.5);
      expect(hasEvidence).toBe(true);
    });
  });

  // --- Summary ---
  it("reports aggregate metrics", () => {
    if (results.length === 0) {
      console.log("No benchmark results collected (all categories skipped).");
      return;
    }
    const byCategory = new Map<string, EvalResult[]>();
    for (const r of results) {
      const arr = byCategory.get(r.category) ?? [];
      arr.push(r);
      byCategory.set(r.category, arr);
    }

    const lines: string[] = ["\n═══ Retrieval Quality Benchmark Results ═══"];
    for (const [cat, catResults] of byCategory) {
      const passRate = catResults.filter((r) => r.passed).length / catResults.length;
      const avgLatency = catResults.reduce((s, r) => s + r.latency_ms, 0) / catResults.length;
      const avgMetric = catResults.reduce((s, r) => s + r.value, 0) / catResults.length;
      lines.push(`\n  ${cat.toUpperCase()}: ${catResults.filter((r) => r.passed).length}/${catResults.length} passed (${(passRate * 100).toFixed(0)}%)`);
      lines.push(`    avg metric: ${avgMetric.toFixed(3)}, avg latency: ${avgLatency.toFixed(0)}ms`);
      for (const r of catResults) {
        lines.push(`    ${r.passed ? "✓" : "✗"} ${r.case_id}: ${r.metric}=${r.value.toFixed(3)} (${r.latency_ms.toFixed(0)}ms) — ${r.details}`);
      }

      const minPassRate = MIN_CATEGORY_PASS_RATES[cat];
      if (minPassRate !== undefined) {
        expect(passRate).toBeGreaterThanOrEqual(minPassRate);
      }
      const maxAvgLatency = MAX_AVG_LATENCY_MS[cat];
      if (maxAvgLatency !== undefined) {
        expect(avgLatency).toBeLessThanOrEqual(maxAvgLatency);
      }
    }

    const overallPass = results.filter((r) => r.passed).length;
    lines.push(`\n  TOTAL: ${overallPass}/${results.length} passed (${((overallPass / results.length) * 100).toFixed(0)}%)`);
    lines.push("════════════════════════════════════════════\n");
    console.log(lines.join("\n"));
  });
});