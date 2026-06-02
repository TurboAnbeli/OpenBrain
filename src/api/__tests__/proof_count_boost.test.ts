import { describe, it, expect } from "vitest";
import { proofCountMultiplier, applyProofCountBoost } from "../proof_count_boost.js";

describe("proofCountMultiplier", () => {
  it("returns 1 for proof_count = 1 (no boost)", () => {
    expect(proofCountMultiplier(1)).toBe(1);
  });

  it("returns > 1 for proof_count = 2", () => {
    const m = proofCountMultiplier(2);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThan(1.05);
  });

  it("saturates at +5% for proof_count >= e (~2.718)", () => {
    const atE = proofCountMultiplier(Math.E);
    expect(atE).toBeCloseTo(1.05, 5);

    const at100 = proofCountMultiplier(100);
    expect(at100).toBeCloseTo(1.05, 5);
  });

  it("is monotonically increasing up to saturation", () => {
    const vals = [1, 2, 3, 5, 10].map(proofCountMultiplier);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i - 1]! < 1.05) {
        expect(vals[i]!).toBeGreaterThanOrEqual(vals[i - 1]!);
      }
    }
  });
});

describe("applyProofCountBoost", () => {
  it("does not modify similarity when proof_count is 1", () => {
    const results = [
      { id: "a", similarity: 0.8, proof_count: 1, content: "", metadata: {}, created_at: new Date() },
    ];
    const boosted = applyProofCountBoost(results);
    expect(boosted[0]!.similarity).toBeCloseTo(0.8, 5);
  });

  it("boosts similarity when proof_count > 1", () => {
    const results = [
      { id: "a", similarity: 0.8, proof_count: 5, content: "", metadata: {}, created_at: new Date() },
    ];
    const boosted = applyProofCountBoost(results);
    expect(boosted[0]!.similarity).toBeGreaterThan(0.8);
    expect(boosted[0]!.similarity).toBeLessThanOrEqual(0.8 * 1.05);
  });

  it("treats missing proof_count as 1 (no boost)", () => {
    const results = [
      { id: "a", similarity: 0.7, content: "", metadata: {}, created_at: new Date() },
    ];
    const boosted = applyProofCountBoost(results);
    expect(boosted[0]!.similarity).toBeCloseTo(0.7, 5);
  });

  it("preserves original array length and order", () => {
    const results = [
      { id: "a", similarity: 0.9, proof_count: 3, content: "", metadata: {}, created_at: new Date() },
      { id: "b", similarity: 0.7, proof_count: 1, content: "", metadata: {}, created_at: new Date() },
    ];
    const boosted = applyProofCountBoost(results);
    expect(boosted).toHaveLength(2);
    expect(boosted[0]!.id).toBe("a");
    expect(boosted[1]!.id).toBe("b");
  });

  it("does not mutate the input array", () => {
    const original = 0.8;
    const results = [
      { id: "a", similarity: original, proof_count: 10, content: "", metadata: {}, created_at: new Date() },
    ];
    applyProofCountBoost(results);
    expect(results[0]!.similarity).toBe(original);
  });
});
