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
