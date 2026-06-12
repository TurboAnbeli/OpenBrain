import { describe, expect, it, vi, afterEach } from "vitest";

import { rerankResults, shouldRerank } from "../rerank.js";

describe("shouldRerank", () => {
  it("fires on explicit negation / exclusion queries", () => {
    expect(shouldRerank("what is not the current orchestrator model")).toBe(true);
    expect(shouldRerank("strategies without options leverage")).toBe(true);
    expect(shouldRerank("which claim is false")).toBe(true);
    expect(shouldRerank("necrotizing fasciitis treatment that uses no surgery")).toBe(true);
    expect(shouldRerank("VM service restart workflow with no privilege escalation")).toBe(true);
  });

  it("stays off for ordinary topical queries", () => {
    expect(shouldRerank("current hermes orchestrator model production")).toBe(false);
    expect(shouldRerank("friedland copper supply statistic")).toBe(false);
  });

  it("fires for all queries when OPENBRAIN_RERANK_ALWAYS is set", () => {
    vi.stubEnv("OPENBRAIN_RERANK_ALWAYS", "true");
    expect(shouldRerank("ordinary query")).toBe(true);
    expect(shouldRerank("no negation here")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("rerankResults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reorders top candidates from model scores and preserves the tail", async () => {
    vi.stubEnv("OPENBRAIN_RERANK_LLM", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          ranking: [
            { id: "b", score: 98 },
            { id: "a", score: 40 },
          ],
        }),
      }),
    }));

    const output = await rerankResults(
      "which claim is false",
      [
        { id: "a", content: "Candidate A" },
        { id: "b", content: "Candidate B" },
        { id: "c", content: "Candidate C" },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b", topN: 2 }
    );

    expect(output.results?.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(output.fired).toBe(true);
  });

  it("falls back cleanly on invalid model output with no heuristic match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "not-json" }),
    }));

    const output = await rerankResults(
      "which claim is false",
      [
        { id: "a", content: "Candidate A" },
        { id: "b", content: "Candidate B" },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" }
    );

    expect(output.results).toBeNull();
    expect(output.fired).toBe(false);
  });

  it("uses deterministic privilege-escalation fallback when model output is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "not-json" }),
    }));

    const output = await rerankResults(
      "VM service restart workflow with no privilege escalation",
      [
        { id: "sudo", content: "Grant a NOPASSWD sudoers rule for sudo systemctl restart openbrain-api.service." },
        { id: "user", content: "Use systemctl --user restart supergateway-openbrain.service from the user-systemd control plane." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.results?.map((r) => r.id)).toEqual(["user", "sudo"]);
    expect(output.fired).toBe(true);
  });


  it("deterministically demotes candidates that violate a general exclusion cue", async () => {
    const output = await rerankResults(
      "oil transit route that does NOT involve Hormuz",
      [
        { id: "hormuz", content: "Oil transit risk through the Strait of Hormuz and Iran-Oman strait." },
        { id: "rule", content: "Over 50% of the world's EXPORT crude flows through Hormuz." },
        { id: "non-hormuz", content: "Rule on oil price discovery: shortage is anticipatory, not reflecting actual shortage." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.fired).toBe(true);
    expect(output.results?.map((r) => r.id)).toEqual(["non-hormuz", "hormuz", "rule"]);
  });

  it("does not demote a candidate that explicitly satisfies a not-about cue", async () => {
    const output = await rerankResults(
      "NATO argument not about Ukraine",
      [
        { id: "satisfies", content: "This NATO argument is not about Ukraine; it is about alliance credibility." },
        { id: "violates", content: "The argument centered on Ukraine and NATO escalation." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.fired).toBe(true);
    expect(output.results?.map((r) => r.id)).toEqual(["satisfies", "violates"]);
  });


  it("does not fire on epistemic visibility idioms", async () => {
    const output = await rerankResults(
      "why does combining Gave Pape and Ryan geopolitics reveal something not visible from any single view",
      [
        { id: "expected", content: "The combined view requires all three to see clearly." },
        { id: "other", content: "A single view misses the synthesis." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.fired).toBe(false);
    expect(output.results).toBeNull();
  });

  it("does not fire on no-exit/loss-of-face trap idioms", async () => {
    const output = await rerankResults(
      "Iran war structurally unwinnable escalation trap no exit without loss of face",
      [
        { id: "expected", content: "Structurally unwinnable through escalation yet impossible to exit without loss of face." },
        { id: "other", content: "A separate Iran war note." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.fired).toBe(false);
    expect(output.results).toBeNull();
  });


  it("does not fire on concept-behind paraphrase queries that contain not", async () => {
    const output = await rerankResults(
      "concept behind beta reflect business risk not leverage unlevered relever target",
      [
        { id: "expected", content: "Beta should reflect the business risk, not the leverage risk — use unlevered beta and relever for the target capital structure." },
        { id: "other", content: "Generic risk-premium content." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(output.fired).toBe(false);
    expect(output.results).toBeNull();
  });

  it("retries with fallback model on primary failure", async () => {
    vi.stubEnv("OPENBRAIN_RERANK_LLM", "true");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: JSON.stringify({
            ranking: [
              { id: "b", score: 95 },
              { id: "a", score: 30 },
            ],
          }),
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENBRAIN_RERANK_FALLBACK_MODEL", "smollm2:1.7b");

    const output = await rerankResults(
      "which claim is false",
      [
        { id: "a", content: "Candidate A" },
        { id: "b", content: "Candidate B" },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" }
    );

    expect(output.results?.map((r) => r.id)).toEqual(["b", "a"]);
    expect(output.fired).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });
});
