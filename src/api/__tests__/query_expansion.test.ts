import { describe, it, expect } from "vitest";
import {
  shouldExpand,
  reciprocalRankFusion,
} from "../query_expansion.js";

describe("shouldExpand (stop-word gate)", () => {
  it.each([
    ["how soon to operate on flesh-eating disease patients", true],
    ["lifecycle phases equities move through accumulation to distribution", true],
    ["should the team use OpenClaw for code generation", true],
    ["which LLM runs the agent control loop on the home server now", true],
    // Keyword-style baseline queries — gate must NOT fire
    ["Friedland copper mining 10000 years statistic supply", false],
    ["Karpathy 700 experiments Andrej AI agents experimentation", false],
    ["Mearsheimer NATO unraveling Trump argument", false],
    ["narrative smoothing buries contradictions", false],
    ["three mechanisms breaking 25-year US capital dominance", false],
  ])("%p → %p", (query, expected) => {
    expect(shouldExpand(query)).toBe(expected);
  });

  it("strips punctuation before stop-word match", () => {
    expect(shouldExpand("what's the current value?")).toBe(true);
  });
});

describe("reciprocalRankFusion", () => {
  let _id = 0;
  const make = (content: string, id?: string) => ({ id: id ?? `id-${_id++}`, content });

  it("returns single list unchanged when only one list", () => {
    const list = [make("a", "1"), make("b", "2"), make("c", "3")];
    const out = reciprocalRankFusion([list]);
    expect(out.map((r) => r.content)).toEqual(["a", "b", "c"]);
  });

  it("merges and re-ranks two lists, items in both score higher than items in one", () => {
    // y appears in both lists; x and w each appear in one. y should win.
    const a = [make("x", "x"), make("y", "y"), make("z", "z")];
    const b = [make("y", "y"), make("w", "w")];
    // y: 1/(60+2) + 1/(60+1) = 0.0325
    // x: 1/(60+1) = 0.0164
    // w: 1/(60+2) = 0.0161
    // z: 1/(60+3) = 0.0159
    const out = reciprocalRankFusion([a, b]);
    expect(out[0]!.content).toBe("y");
  });

  it("respects top limit", () => {
    const list = Array.from({ length: 20 }, (_, i) => make(`item-${i}`, `id-${i}`));
    const out = reciprocalRankFusion([list], 60, 5);
    expect(out).toHaveLength(5);
  });

  it("keys on id, so same id deduplicated across lists", () => {
    const a = [make("content-a", "shared-id")];
    const b = [make("content-b", "shared-id")];
    const out = reciprocalRankFusion([a, b]);
    // Same id → treated as same item, single entry
    expect(out).toHaveLength(1);
  });
});
