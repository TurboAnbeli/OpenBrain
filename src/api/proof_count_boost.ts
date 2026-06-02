/**
 * Proof-count multiplicative boost for retrieval results.
 *
 * Mirrors Hindsight's ±5% confidence signal: thoughts that have been
 * reinforced by near-duplicate captures (proof_count > 1) receive a
 * score multiplier. The boost saturates at proof_count = e^1 ≈ 2.7,
 * yielding a maximum of +5%.
 *
 *   multiplier = 1 + 0.05 × min(ln(proof_count), 1)
 *
 * Applied after RRF fusion but before the optional cross-encoder rerank,
 * so higher-confidence thoughts enter the rerank candidate window with
 * higher scores.
 */

export interface ProofCountResult {
  similarity: number;
  proof_count?: number;
}

export function proofCountMultiplier(n: number): number {
  if (n <= 1) return 1;
  return 1 + 0.05 * Math.min(Math.log(n), 1);
}

export function applyProofCountBoost<T extends ProofCountResult>(results: T[]): T[] {
  return results.map((r) => ({
    ...r,
    similarity: r.similarity * proofCountMultiplier(r.proof_count ?? 1),
  }));
}
