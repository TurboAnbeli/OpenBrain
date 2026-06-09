import { describe, it, expect } from "vitest";
import { entityWeightedRRF, shouldUseEntityRanking } from "../entity_ranking.js";

describe("shouldUseEntityRanking", () => {
  it("returns true when query contains proper nouns", () => {
    expect(shouldUseEntityRanking("What is OpenClaw?")).toBe(true);
  });

  it("returns false for plain queries", () => {
    expect(shouldUseEntityRanking("what is the meaning of life")).toBe(false);
  });

  it("respects OPENBRAIN_ENTITY_RANKING=false", () => {
    const orig = process.env.OPENBRAIN_ENTITY_RANKING;
    process.env.OPENBRAIN_ENTITY_RANKING = "false";
    expect(shouldUseEntityRanking("OpenClaw is great")).toBe(false);
    process.env.OPENBRAIN_ENTITY_RANKING = orig;
  });
});

describe("entityWeightedRRF", () => {
  const makeResult = (id: string, sim: number) => ({
    id,
    content: `content ${id}`,
    metadata: { type: "observation" as string, topics: [] as string[], people: [] as string[] },
    similarity: sim,
    created_at: new Date(),
    proof_count: 0,
  });

  it("puts entity-only results at the top when no other streams overlap", () => {
    const entityResults = [
      { ...makeResult("e2", 0.4), overlap_count: 2 },
      { ...makeResult("e1", 0.5), overlap_count: 1 },
    ];
    const other: ReturnType<typeof makeResult>[][] = [];
    const ranked = entityWeightedRRF(entityResults, other, 10);
    expect(ranked[0]!.id).toBe("e2"); // higher overlap first within entity stream
    expect(ranked[1]!.id).toBe("e1");
  });

  it("boosts entity hits above dense hits when overlapping", () => {
    const entityResults = [{ ...makeResult("a", 0.5), overlap_count: 1 }];
    const denseResults = [makeResult("a", 0.8), makeResult("b", 0.7)];
    const ranked = entityWeightedRRF(entityResults, [denseResults], 10);
    // Entity hit for 'a' gets k=30 weight, dense hit gets k=60.
    // At rank 1: entity score = 1/(30+1) ≈ 0.0323, dense = 1/(60+1) ≈ 0.0164
    // Combined for 'a': 0.0323 + 0.0164 = 0.0487
    // 'b' only from dense: 1/(60+2) = 0.0161
    expect(ranked[0]!.id).toBe("a");
    expect(ranked[1]!.id).toBe("b");
  });

  it("preserves overlap_count in output", () => {
    const entityResults = [{ ...makeResult("a", 0.5), overlap_count: 3 }];
    const ranked = entityWeightedRRF(entityResults, [], 10);
    expect(ranked[0]!.overlap_count).toBe(3);
  });

  it("respects the top limit", () => {
    const entityResults = Array.from({ length: 5 }, (_, i) => ({
      ...makeResult(`e${i}`, 0.5 - i * 0.05),
      overlap_count: 1,
    }));
    const ranked = entityWeightedRRF(entityResults, [], 3);
    expect(ranked).toHaveLength(3);
  });
});
