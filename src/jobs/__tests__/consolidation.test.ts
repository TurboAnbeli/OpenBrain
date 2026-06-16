import { describe, it, expect, vi, beforeEach } from "vitest";
import type pg from "pg";

const mocks = vi.hoisted(() => ({
  startConsolidationJob: vi.fn(),
  getThoughtsByIds: vi.fn(),
  getDocument: vi.fn(),
  getDocumentBySourceUri: vi.fn(),
  insertConsolidatedObservation: vi.fn(),
  completeConsolidationJob: vi.fn(),
  failConsolidationJob: vi.fn(),
  insertMemoryLink: vi.fn(),
  insertExperience: vi.fn(),
  getMemoryBankContext: vi.fn(),
  synthesizeObservation: vi.fn(),
}));

vi.mock("../../db/queries.js", () => ({
  startConsolidationJob: (...args: any[]) => mocks.startConsolidationJob(...args),
  getThoughtsByIds: (...args: any[]) => mocks.getThoughtsByIds(...args),
  getDocument: (...args: any[]) => mocks.getDocument(...args),
  getDocumentBySourceUri: (...args: any[]) => mocks.getDocumentBySourceUri(...args),
  insertConsolidatedObservation: (...args: any[]) => mocks.insertConsolidatedObservation(...args),
  completeConsolidationJob: (...args: any[]) => mocks.completeConsolidationJob(...args),
  failConsolidationJob: (...args: any[]) => mocks.failConsolidationJob(...args),
  insertMemoryLink: (...args: any[]) => mocks.insertMemoryLink(...args),
  insertExperience: (...args: any[]) => mocks.insertExperience(...args),
  getMemoryBankContext: (...args: any[]) => mocks.getMemoryBankContext(...args),
}));

vi.mock("../../api/synthesize.js", () => ({
  synthesizeObservation: (...args: any[]) => mocks.synthesizeObservation(...args),
}));

import { runConsolidationJob } from "../consolidation.js";

function mockPool(): pg.Pool {
  return { query: vi.fn(), connect: vi.fn() } as unknown as pg.Pool;
}

const embedder = {
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  extractMetadata: vi.fn().mockResolvedValue({ type: "observation", topics: ["one-brain"], people: [], action_items: [], dates: [] }),
  getVersion: () => "test-embedder",
};

const job = {
  id: "job-123",
  bank_id: "openbrain",
  job_type: "observe_thoughts",
  status: "running",
  input: {
    thought_ids: ["a1b2c3d4-1234-5678-9abc-def012345678", "11111111-2222-3333-4444-555555555555"],
    project: "one-brain",
    created_by: "hermes",
  },
  output: null,
  error: null,
  attempts: 1,
  started_at: new Date("2026-06-15T00:00:00Z"),
  finished_at: null,
  created_at: new Date("2026-06-15T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertMemoryLink.mockImplementation(async (_pool, link) => ({ id: `link-${mocks.insertMemoryLink.mock.calls.length}`, ...link, weight: link.weight ?? 1, inferred: link.inferred ?? true, created_at: new Date("2026-06-15T00:02:00Z") }));
  mocks.insertExperience.mockImplementation(async (_pool, experience) => ({ id: `exp-${mocks.insertExperience.mock.calls.length}`, ...experience, created_at: new Date("2026-06-15T00:02:00Z") }));
  mocks.getMemoryBankContext.mockResolvedValue({
    id: "openbrain",
    name: "OpenBrain",
    mission: "Durable, evidence-grounded memory.",
    disposition: { skepticism: 4 },
    project: null,
    directives: [],
  });
});

describe("runConsolidationJob", () => {
  it("materializes an observe_thoughts job into a consolidated observation without archiving sources", async () => {
    const pool = mockPool();
    const sources = [
      { id: job.input.thought_ids[0], content: "First durable observation", project: "one-brain", created_by: "ryan", archived: false, proof_count: 1, metadata: {}, created_at: new Date() },
      { id: job.input.thought_ids[1], content: "Second supporting observation", project: "one-brain", created_by: "ryan", archived: false, proof_count: 1, metadata: {}, created_at: new Date() },
    ];
    const observation = {
      id: "obs-123",
      bank_id: "openbrain",
      content: "Synthesized durable one-brain observation.",
      proof_count: 2,
      source_memory_ids: job.input.thought_ids,
      source_quotes: Object.fromEntries(sources.map((s) => [s.id, s.content])),
      tags: ["one-brain"],
      history: [],
      trend: null,
      trend_computed_at: null,
      project: "one-brain",
      created_by: "hermes",
      archived: false,
      created_at: new Date("2026-06-15T00:01:00Z"),
      updated_at: new Date("2026-06-15T00:01:00Z"),
    };
    mocks.startConsolidationJob.mockResolvedValueOnce(job);
    mocks.getThoughtsByIds.mockResolvedValueOnce(sources);
    mocks.synthesizeObservation.mockResolvedValueOnce(observation.content);
    mocks.insertConsolidatedObservation.mockResolvedValueOnce(observation);
    mocks.completeConsolidationJob.mockImplementationOnce(async (_pool, id, output) => ({ ...job, id, status: "success", output }));

    const result = await runConsolidationJob(pool, "job-123", {
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(result.job.status).toBe("success");
    expect(result.observation?.id).toBe("obs-123");
    expect(mocks.getThoughtsByIds).toHaveBeenCalledWith(pool, job.input.thought_ids);
    expect(mocks.insertConsolidatedObservation.mock.calls[0]![1]).toMatchObject({
      content: observation.content,
      bank_id: "openbrain",
      proof_count: 2,
      source_memory_ids: job.input.thought_ids,
      source_quotes: observation.source_quotes,
      project: "one-brain",
      created_by: "hermes",
    });
    expect(mocks.completeConsolidationJob.mock.calls[0]![2]).toMatchObject({
      observation_id: "obs-123",
      source_kind: "thought",
      source_count: 2,
      source_ids: job.input.thought_ids,
      evidence_link_ids: ["link-1", "link-2"],
      experience_id: "exp-1",
    });
    expect(mocks.insertMemoryLink).toHaveBeenCalledTimes(2);
    expect(mocks.insertMemoryLink.mock.calls[0]![1]).toMatchObject({
      bank_id: "openbrain",
      source_type: "thought",
      source_id: job.input.thought_ids[0],
      target_type: "consolidated_observation",
      target_id: "obs-123",
      relationship: "evidence_for",
      inferred: true,
    });
    expect(mocks.insertMemoryLink.mock.calls[1]![1]).toMatchObject({
      source_type: "thought",
      source_id: job.input.thought_ids[1],
      target_type: "consolidated_observation",
      target_id: "obs-123",
      relationship: "evidence_for",
    });
    expect(mocks.insertExperience).toHaveBeenCalledWith(pool, expect.objectContaining({
      bank_id: "openbrain",
      event_type: "decide",
      session_id: "consolidation:job-123",
      content: expect.stringContaining("Consolidation job job-123 materialized"),
      refs: expect.objectContaining({
        event: "consolidation_completed",
        consolidation_job_id: "job-123",
        observation_id: "obs-123",
        evidence_link_ids: ["link-1", "link-2"],
      }),
      project: "one-brain",
      created_by: "openbrain-system",
    }));
  });


  it("passes active reflect directives into synthesis context before materializing observations", async () => {
    const pool = mockPool();
    const sources = [
      { id: job.input.thought_ids[0], content: "First observation includes a direct identifier that should not be repeated", project: "one-brain", created_by: "ryan", archived: false, proof_count: 1, metadata: {}, created_at: new Date() },
      { id: job.input.thought_ids[1], content: "Second observation says the fact conflicts with an earlier memory", project: "one-brain", created_by: "ryan", archived: false, proof_count: 1, metadata: {}, created_at: new Date() },
    ];
    mocks.getMemoryBankContext.mockResolvedValueOnce({
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
        {
          id: "06e1de99-502b-4865-b1e2-87c8adf01853",
          bank_id: "openbrain",
          name: "no_fact_averaging",
          rule_text: "Do not average conflicting facts.",
          applies_to: ["reflect"],
          severity: "hard",
          active: true,
          priority: 90,
          revision: 1,
        },
      ],
    });
    mocks.startConsolidationJob.mockResolvedValueOnce(job);
    mocks.getThoughtsByIds.mockResolvedValueOnce(sources);
    mocks.synthesizeObservation.mockResolvedValueOnce("Directive-safe synthesis.");
    mocks.insertConsolidatedObservation.mockResolvedValueOnce({
      id: "obs-directive",
      bank_id: "openbrain",
      content: "Directive-safe synthesis.",
      proof_count: 2,
      source_memory_ids: job.input.thought_ids,
      source_quotes: Object.fromEntries(sources.map((s) => [s.id, s.content])),
      tags: ["one-brain"],
      history: [],
      trend: null,
      trend_computed_at: null,
      project: "one-brain",
      created_by: "hermes",
      archived: false,
      created_at: new Date("2026-06-15T00:01:00Z"),
      updated_at: new Date("2026-06-15T00:01:00Z"),
    });
    mocks.completeConsolidationJob.mockImplementationOnce(async (_pool, id, output) => ({ ...job, id, status: "success", output }));

    await runConsolidationJob(pool, "job-123", {
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(mocks.getMemoryBankContext).toHaveBeenCalledWith(pool, "openbrain", "reflect");
    expect(mocks.synthesizeObservation.mock.calls[0]![1]).toMatchObject({
      memoryBank: {
        id: "openbrain",
        mission: "Durable, evidence-grounded memory.",
        directives: [
          { name: "no_pii_verbatim", severity: "hard", rule_text: "Never store patient identifiers verbatim." },
          { name: "no_fact_averaging", severity: "hard", rule_text: "Do not average conflicting facts." },
        ],
      },
    });
    expect(mocks.insertConsolidatedObservation.mock.calls[0]![1].history[0]).toMatchObject({
      directive_ids: ["741a9339-ceb3-468b-81ac-616567382122", "06e1de99-502b-4865-b1e2-87c8adf01853"],
    });
  });


  it("marks observe_documents jobs error when explicit sources are missing", async () => {
    const pool = mockPool();
    const documentJob = {
      ...job,
      job_type: "observe_documents",
      input: { document_ids: ["a1b2c3d4-1234-5678-9abc-def012345678"], project: "one-brain" },
    };
    mocks.startConsolidationJob.mockResolvedValueOnce(documentJob);
    mocks.getDocument.mockResolvedValueOnce(null);
    mocks.failConsolidationJob.mockImplementationOnce(async (_pool, id, error, output) => ({ ...documentJob, id, status: "error", error, output }));

    const result = await runConsolidationJob(pool, "job-123", {
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(result.job.status).toBe("error");
    expect(result.job.error).toContain("no active document sources found");
    expect(mocks.failConsolidationJob.mock.calls[0]![3]).toMatchObject({ source_kind: "document", source_count: 0 });
    expect(mocks.insertConsolidatedObservation).not.toHaveBeenCalled();
  });
});
