import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { synthesizeObservation } from "../synthesize.js";

describe("synthesizeObservation", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "A directive-safe synthesized observation." }),
    } as unknown as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("includes memory bank mission and active directives in the prompt", async () => {
    await synthesizeObservation(["Observation one", "Observation two"], {
      endpoint: "http://127.0.0.1:11434",
      model: "test-model",
      memoryBank: {
        id: "openbrain",
        name: "OpenBrain",
        mission: "Durable, evidence-grounded memory.",
        disposition: { skepticism: 4 },
        directives: [
          {
            id: "741a9339-ceb3-468b-81ac-616567382122",
            name: "no_pii_verbatim",
            rule_text: "Never store patient identifiers verbatim.",
            severity: "hard",
            priority: 100,
          },
        ],
      },
    });

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(body.prompt).toContain("Memory bank: OpenBrain");
    expect(body.prompt).toContain("Mission: Durable, evidence-grounded memory.");
    expect(body.prompt).toContain("HARD directive no_pii_verbatim: Never store patient identifiers verbatim.");
    expect(body.prompt).toContain("These directives are binding constraints");
  });
});
