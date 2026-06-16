import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";

const mocks = vi.hoisted(() => ({
  getMentalModel: vi.fn(),
  getConsolidatedObservation: vi.fn(),
  getMemoryBankContext: vi.fn(),
  updateMentalModel: vi.fn(),
  insertMemoryLink: vi.fn(),
  insertExperience: vi.fn(),
  synthesizeMentalModelRefresh: vi.fn(),
}));

vi.mock("../../db/queries.js", () => ({
  getMentalModel: (...args: unknown[]) => mocks.getMentalModel(...args),
  getConsolidatedObservation: (...args: unknown[]) => mocks.getConsolidatedObservation(...args),
  getMemoryBankContext: (...args: unknown[]) => mocks.getMemoryBankContext(...args),
  updateMentalModel: (...args: unknown[]) => mocks.updateMentalModel(...args),
  insertMemoryLink: (...args: unknown[]) => mocks.insertMemoryLink(...args),
  insertExperience: (...args: unknown[]) => mocks.insertExperience(...args),
}));

vi.mock("../../api/synthesize.js", () => ({
  synthesizeMentalModelRefresh: (...args: unknown[]) => mocks.synthesizeMentalModelRefresh(...args),
}));

import { refreshMentalModelFromObservations } from "../mental_model_refresh.js";

function mockPool(): pg.Pool {
  return { query: vi.fn(), connect: vi.fn() } as unknown as pg.Pool;
}

const model = {
  id: "a1b2c3d4-1234-5678-9abc-def012345678",
  bank_id: "openbrain",
  name: "Retrieval discipline",
  query: "When should graph ranking be default?",
  content: "Old model content.",
  structured: { seed_key: "retrieval-before-graph-discipline", evidence_refs: [] },
  tags: ["mental-model", "retrieval"],
  trigger_tags: ["seed:retrieval-before-graph-discipline"],
  priority: 85,
  refresh_meta: { source: "slice-k-seed" },
  history: [],
  active: true,
  project: "openbrain",
  created_by: "openbrain-seed:slice-k",
  created_at: new Date("2026-06-15T00:00:00Z"),
  updated_at: new Date("2026-06-15T00:00:00Z"),
};

const observations = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    bank_id: "openbrain",
    content: "Checkpoint Eval B proves default recall should not enable graph globally.",
    proof_count: 2,
    source_memory_ids: [],
    source_quotes: {},
    tags: ["retrieval"],
    history: [],
    trend: null,
    trend_computed_at: null,
    project: "openbrain",
    created_by: "hermes",
    archived: false,
    created_at: new Date("2026-06-15T01:00:00Z"),
    updated_at: new Date("2026-06-15T01:00:00Z"),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    bank_id: "openbrain",
    content: "Mental models are opt-in until evaluated as a default lane.",
    proof_count: 1,
    source_memory_ids: [],
    source_quotes: {},
    tags: ["mental-models"],
    history: [],
    trend: null,
    trend_computed_at: null,
    project: "openbrain",
    created_by: "hermes",
    archived: false,
    created_at: new Date("2026-06-15T01:05:00Z"),
    updated_at: new Date("2026-06-15T01:05:00Z"),
  },
];

const memoryBank = {
  id: "openbrain",
  name: "OpenBrain",
  mission: "Durable, evidence-grounded memory.",
  disposition: { skepticism: 4 },
  project: null,
  directives: [
    {
      id: "741a9339-ceb3-468b-81ac-616567382122",
      bank_id: "openbrain",
      name: "no_pii_verbatim",
      rule_text: "Never store patient identifiers verbatim.",
      applies_to: ["reflect", "retain"],
      severity: "hard",
      active: true,
      priority: 100,
      revision: 1,
    },
  ],
};

const embedder = {
  generateEmbedding: vi.fn(async () => [0.4, 0.5, 0.6]),
  extractMetadata: vi.fn(),
  getVersion: () => "test-embedder",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMentalModel.mockResolvedValue(model);
  mocks.getConsolidatedObservation.mockImplementation(async (_pool, id) => observations.find((obs) => obs.id === id) ?? null);
  mocks.getMemoryBankContext.mockResolvedValue(memoryBank);
  mocks.synthesizeMentalModelRefresh.mockResolvedValue("Refreshed retrieval discipline content.");
  mocks.updateMentalModel.mockImplementation(async (_pool, id, patch) => ({ ...model, id, ...patch, updated_at: new Date("2026-06-15T02:00:00Z") }));
  mocks.insertMemoryLink.mockImplementation(async (_pool, link) => ({ id: `link-${mocks.insertMemoryLink.mock.calls.length}`, ...link, weight: link.weight ?? 1, inferred: link.inferred ?? true, created_at: new Date("2026-06-15T02:00:00Z") }));
  mocks.insertExperience.mockImplementation(async (_pool, experience) => ({ id: `exp-${mocks.insertExperience.mock.calls.length}`, ...experience, created_at: new Date("2026-06-15T02:00:00Z") }));
});

describe("refreshMentalModelFromObservations", () => {
  it("refreshes a mental model from explicit active observations with directive context", async () => {
    const pool = mockPool();
    const result = await refreshMentalModelFromObservations(pool, model.id, {
      observation_ids: observations.map((obs) => obs.id),
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" },
    });

    expect(result.dry_run).toBe(false);
    expect(result.model.content).toBe("Refreshed retrieval discipline content.");
    expect(result.evidence_observations.map((obs) => obs.id)).toEqual(observations.map((obs) => obs.id));
    expect(mocks.getMentalModel).toHaveBeenCalledWith(pool, model.id);
    expect(mocks.getMemoryBankContext).toHaveBeenCalledWith(pool, "openbrain", "reflect");
    expect(mocks.synthesizeMentalModelRefresh).toHaveBeenCalledWith(model, observations, {
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3:1.7b",
      memoryBank,
    });
    expect(embedder.generateEmbedding).toHaveBeenCalledWith(
      "Retrieval discipline\nWhen should graph ranking be default?\nRefreshed retrieval discipline content."
    );
    expect(mocks.updateMentalModel.mock.calls[0]![2]).toMatchObject({
      content: "Refreshed retrieval discipline content.",
      embedding: [0.4, 0.5, 0.6],
      active: true,
      structured: expect.objectContaining({
        seed_key: "retrieval-before-graph-discipline",
        refresh: expect.objectContaining({
          evidence_observation_ids: observations.map((obs) => obs.id),
          directive_ids: ["741a9339-ceb3-468b-81ac-616567382122"],
          evidence_link_ids: ["link-1", "link-2"],
          experience_id: "exp-1",
        }),
      }),
      refresh_meta: expect.objectContaining({
        last_refreshed_by: "mental_model_refresh",
        evidence_observation_ids: observations.map((obs) => obs.id),
        evidence_link_ids: ["link-1", "link-2"],
        experience_id: "exp-1",
      }),
      history: expect.arrayContaining([
        expect.objectContaining({
          event: "mental_model_refresh",
          previous_content: "Old model content.",
          evidence_link_ids: ["link-1", "link-2"],
          experience_id: "exp-1",
        }),
      ]),
    });
    expect(mocks.insertMemoryLink).toHaveBeenCalledTimes(2);
    expect(mocks.insertMemoryLink.mock.calls[0]![1]).toMatchObject({
      bank_id: "openbrain",
      source_type: "consolidated_observation",
      source_id: observations[0]!.id,
      target_type: "mental_model",
      target_id: model.id,
      relationship: "evidence_for",
      inferred: true,
    });
    expect(mocks.insertExperience).toHaveBeenCalledWith(pool, expect.objectContaining({
      bank_id: "openbrain",
      event_type: "decide",
      session_id: `mental_model_refresh:${model.id}`,
      content: expect.stringContaining("Mental model refreshed"),
      refs: expect.objectContaining({
        event: "mental_model_refreshed",
        mental_model_id: model.id,
        evidence_observation_ids: observations.map((obs) => obs.id),
        evidence_link_ids: ["link-1", "link-2"],
      }),
      project: "openbrain",
      created_by: "openbrain-system",
    }));
  });

  it("dry-runs proposed content without embedding or writing", async () => {
    const pool = mockPool();
    const result = await refreshMentalModelFromObservations(pool, model.id, {
      observation_ids: [observations[0]!.id],
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" },
      dry_run: true,
    });

    expect(result.dry_run).toBe(true);
    expect(result.proposed_content).toBe("Refreshed retrieval discipline content.");
    expect(embedder.generateEmbedding).not.toHaveBeenCalled();
    expect(mocks.updateMentalModel).not.toHaveBeenCalled();
    expect(mocks.insertMemoryLink).not.toHaveBeenCalled();
    expect(mocks.insertExperience).not.toHaveBeenCalled();
  });

  it("rejects missing explicit evidence before synthesis", async () => {
    await expect(refreshMentalModelFromObservations(mockPool(), model.id, {
      observation_ids: [],
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" },
    })).rejects.toThrow(/at least one observation_id/i);
    expect(mocks.synthesizeMentalModelRefresh).not.toHaveBeenCalled();
    expect(mocks.updateMentalModel).not.toHaveBeenCalled();
  });

  it("rejects archived or missing observations", async () => {
    mocks.getConsolidatedObservation.mockResolvedValueOnce({ ...observations[0], archived: true });

    await expect(refreshMentalModelFromObservations(mockPool(), model.id, {
      observation_ids: [observations[0]!.id],
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "qwen3:1.7b" },
    })).rejects.toThrow(/no active evidence observations/i);
    expect(mocks.updateMentalModel).not.toHaveBeenCalled();
  });
});
