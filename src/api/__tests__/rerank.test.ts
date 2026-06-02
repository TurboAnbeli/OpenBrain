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
});

describe("rerankResults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reorders top candidates from model scores and preserves the tail", async () => {
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

    const results = await rerankResults(
      "which claim is false",
      [
        { id: "a", content: "Candidate A" },
        { id: "b", content: "Candidate B" },
        { id: "c", content: "Candidate C" },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b", topN: 2 }
    );

    expect(results?.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("falls back cleanly on invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "not-json" }),
    }));

    const results = await rerankResults(
      "which claim is false",
      [
        { id: "a", content: "Candidate A" },
        { id: "b", content: "Candidate B" },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" }
    );

    expect(results).toBeNull();
  });

  it("uses deterministic privilege-escalation fallback when model output is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "not-json" }),
    }));

    const results = await rerankResults(
      "VM service restart workflow with no privilege escalation",
      [
        { id: "sudo", content: "Grant a NOPASSWD sudoers rule for sudo systemctl restart openbrain-api.service." },
        { id: "user", content: "Use systemctl --user restart supergateway-openbrain.service from the user-systemd control plane." },
      ],
      { endpoint: "http://127.0.0.1:11434", model: "smollm2:1.7b" }
    );

    expect(results?.map((r) => r.id)).toEqual(["user", "sudo"]);
  });
});
