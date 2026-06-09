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

  it("retries with fallback model on primary failure", async () => {
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
