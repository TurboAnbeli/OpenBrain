import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock onnxruntime-node
vi.mock("onnxruntime-node", () => ({
  Tensor: class MockTensor {
    data: any;
    dims: number[];
    constructor(_type: string, data: any, dims: number[]) {
      this.data = data;
      this.dims = dims;
    }
  },
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockImplementation(async (inputs: any) => {
        const batchSize = inputs.input_ids.dims[0];
        return {
          logits: {
            data: new Float32Array(Array.from({ length: batchSize }, (_, i) => 50 - i * 10)),
          },
        };
      }),
    }),
  },
}));

// Mock fs
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes("tokenizer.json")) {
      return JSON.stringify({
        model: {
          vocab: {
            "[CLS]": 101,
            "[SEP]": 102,
            "[PAD]": 0,
            "[UNK]": 100,
            "what": 200,
            "is": 201,
            "python": 202,
            "a": 203,
            "programming": 204,
            "language": 205,
            "javascript": 206,
            "different": 207,
            "hello": 208,
            "world": 209,
          },
        },
        added_tokens: [
          { content: "[CLS]", id: 101 },
          { content: "[SEP]", id: 102 },
          { content: "[PAD]", id: 0 },
          { content: "[UNK]", id: 100 },
        ],
      });
    }
    if (path.includes("tokenizer_config.json")) {
      return JSON.stringify({ model_max_length: 512 });
    }
    return "";
  }),
  existsSync: vi.fn().mockReturnValue(true),
}));

import {
  loadCrossEncoder,
  scorePairs,
  isCrossEncoderLoaded,
  getLoadedModelName,
} from "../cross_encoder.js";
import { crossEncoderRerank } from "../rerank.js";

describe("cross_encoder module", () => {
  beforeEach(async () => {
    await loadCrossEncoder({ model: "test-model" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the model and tokenizer", () => {
    expect(isCrossEncoderLoaded()).toBe(true);
    expect(getLoadedModelName()).toBe("test-model");
  });

  it("scores pairs and returns scores for each passage", async () => {
    const scores = await scorePairs("what is python", ["python is a programming language", "javascript is different"]);
    expect(scores).toHaveLength(2);
    expect(typeof scores[0]).toBe("number");
    expect(typeof scores[1]).toBe("number");
  });
});

describe("crossEncoderRerank", () => {
  beforeEach(async () => {
    await loadCrossEncoder({ model: "test-model" });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("reranks candidates by cross-encoder scores", async () => {
    const results = [
      { id: "a", content: "First candidate", similarity: 0.9 },
      { id: "b", content: "Second candidate", similarity: 0.8 },
      { id: "c", content: "Third candidate", similarity: 0.7 },
    ];

    const output = await crossEncoderRerank("test query", results);

    expect(output.fired).toBe(true);
    expect(output.results).not.toBeNull();
    expect(output.results?.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to original order on tie-breaker", async () => {
    const results = [
      { id: "z", content: "Z candidate", similarity: 0.5 },
      { id: "a", content: "A candidate", similarity: 0.5 },
      { id: "m", content: "M candidate", similarity: 0.5 },
    ];

    const output = await crossEncoderRerank("test query", results);
    expect(output.fired).toBe(true);
    expect(output.results?.map((r) => r.id)).toEqual(["z", "a", "m"]);
  });

  it("returns null when fewer than min candidates", async () => {
    vi.stubEnv("OPENBRAIN_CROSS_ENCODER_MIN_CANDIDATES", "5");
    const results = [
      { id: "a", content: "Only one", similarity: 0.9 },
      { id: "b", content: "Only two", similarity: 0.8 },
    ];

    const output = await crossEncoderRerank("test query", results);
    expect(output.fired).toBe(false);
    expect(output.results).toBeNull();
  });

  it("respects topN limit", async () => {
    vi.stubEnv("OPENBRAIN_CROSS_ENCODER_TOPN", "2");
    const results = [
      { id: "a", content: "A", similarity: 0.9 },
      { id: "b", content: "B", similarity: 0.8 },
      { id: "c", content: "C", similarity: 0.7 },
      { id: "d", content: "D", similarity: 0.6 },
    ];

    const output = await crossEncoderRerank("test query", results);
    expect(output.fired).toBe(true);
    const ids = output.results?.map((r) => r.id) ?? [];
    expect(ids.slice(0, 2)).toEqual(["a", "b"]);
    expect(ids.slice(2)).toEqual(["c", "d"]);
  });
});
