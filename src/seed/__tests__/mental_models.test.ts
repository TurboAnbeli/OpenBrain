import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Embedder } from "../../embedder/types.js";

const mockListMentalModels = vi.fn();
const mockInsertMentalModel = vi.fn();
const mockUpdateMentalModel = vi.fn();

vi.mock("../../db/queries.js", () => ({
  listMentalModels: (...args: unknown[]) => mockListMentalModels(...args),
  insertMentalModel: (...args: unknown[]) => mockInsertMentalModel(...args),
  updateMentalModel: (...args: unknown[]) => mockUpdateMentalModel(...args),
}));

import { MENTAL_MODEL_SEEDS, seedMentalModels, mentalModelSeedEmbeddingText } from "../mental_models.js";

describe("mental model seeds", () => {
  const pool = {} as never;
  const embedder: Embedder = {
    generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
    extractMetadata: vi.fn(async () => ({
      type: "observation" as const,
      topics: [],
      people: [],
      action_items: [],
      dates: [],
    })),
    getVersion: () => "test-embedder",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines durable seed models with canonical trigger tags and evidence metadata", () => {
    expect(MENTAL_MODEL_SEEDS.length).toBeGreaterThanOrEqual(4);
    const keys = new Set(MENTAL_MODEL_SEEDS.map((seed) => seed.key));
    expect(keys.size).toBe(MENTAL_MODEL_SEEDS.length);

    for (const seed of MENTAL_MODEL_SEEDS) {
      expect(seed.name.trim().length).toBeGreaterThan(0);
      expect(seed.query.trim().length).toBeGreaterThan(0);
      expect(seed.content.trim().length).toBeGreaterThan(0);
      expect(seed.trigger_tags).toContain(`seed:${seed.key}`);
      expect(seed.structured.seed_key).toBe(seed.key);
      expect(seed.structured.evidence_refs).toEqual(expect.any(Array));
      expect((seed.structured.evidence_refs as unknown[]).length).toBeGreaterThan(0);
      expect(seed.tags).toContain("mental-model");
    }
  });

  it("inserts missing canonical seed models with embeddings and provenance", async () => {
    mockListMentalModels.mockResolvedValue([]);
    mockInsertMentalModel.mockImplementation(async (_pool, input) => ({
      id: `new-${input.structured.seed_key}`,
      ...input,
      active: input.active ?? true,
      created_at: new Date("2026-06-15T00:00:00Z"),
      updated_at: new Date("2026-06-15T00:00:00Z"),
    }));

    const summary = await seedMentalModels({ pool, embedder, project: "openbrain", created_by: "slice-k-test" });

    expect(summary.created).toBe(MENTAL_MODEL_SEEDS.length);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(0);
    expect(mockListMentalModels).toHaveBeenCalledTimes(MENTAL_MODEL_SEEDS.length);
    expect(mockInsertMentalModel).toHaveBeenCalledTimes(MENTAL_MODEL_SEEDS.length);
    expect(mockUpdateMentalModel).not.toHaveBeenCalled();

    const firstSeed = MENTAL_MODEL_SEEDS[0]!;
    expect(embedder.generateEmbedding).toHaveBeenCalledWith(mentalModelSeedEmbeddingText(firstSeed));
    expect(mockListMentalModels.mock.calls[0]![1]).toMatchObject({
      bank_id: "openbrain",
      trigger_tag: `seed:${firstSeed.key}`,
      include_inactive: true,
      limit: 10,
    });
    expect(mockInsertMentalModel.mock.calls[0]![1]).toMatchObject({
      bank_id: "openbrain",
      name: firstSeed.name,
      query: firstSeed.query,
      content: firstSeed.content,
      active: true,
      project: "openbrain",
      created_by: "slice-k-test",
      structured: expect.objectContaining({ seed_key: firstSeed.key, seed_version: expect.any(String) }),
      trigger_tags: expect.arrayContaining([`seed:${firstSeed.key}`]),
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("updates existing seed models instead of duplicating them", async () => {
    const existingUpdatedAt = new Date("2026-06-14T00:00:00Z");
    mockListMentalModels.mockImplementation(async (_pool, options) => [
      {
        id: `existing-${options.trigger_tag}`,
        bank_id: "openbrain",
        name: "Old name",
        query: "Old query",
        content: "Old content",
        structured: { seed_key: options.trigger_tag.replace("seed:", ""), seed_version: "old" },
        tags: ["old"],
        trigger_tags: [options.trigger_tag],
        priority: 0,
        refresh_meta: {},
        history: [],
        active: false,
        project: "openbrain",
        created_by: "old-seeder",
        created_at: existingUpdatedAt,
        updated_at: existingUpdatedAt,
      },
    ]);
    mockUpdateMentalModel.mockImplementation(async (_pool, id, patch) => ({
      id,
      ...patch,
      active: patch.active ?? true,
      created_at: existingUpdatedAt,
      updated_at: new Date("2026-06-15T00:00:00Z"),
    }));

    const summary = await seedMentalModels({ pool, embedder, project: "openbrain", created_by: "slice-k-test" });

    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(MENTAL_MODEL_SEEDS.length);
    expect(mockInsertMentalModel).not.toHaveBeenCalled();
    expect(mockUpdateMentalModel).toHaveBeenCalledTimes(MENTAL_MODEL_SEEDS.length);
    expect(mockUpdateMentalModel.mock.calls[0]![2]).toMatchObject({
      active: true,
      project: "openbrain",
      created_by: "slice-k-test",
      structured: expect.objectContaining({ seed_version: expect.any(String) }),
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it("dry-runs without embedding or writing", async () => {
    mockListMentalModels.mockResolvedValue([]);

    const summary = await seedMentalModels({ pool, embedder, dry_run: true });

    expect(summary.created).toBe(MENTAL_MODEL_SEEDS.length);
    expect(summary.updated).toBe(0);
    expect(embedder.generateEmbedding).not.toHaveBeenCalled();
    expect(mockInsertMentalModel).not.toHaveBeenCalled();
    expect(mockUpdateMentalModel).not.toHaveBeenCalled();
  });
});
