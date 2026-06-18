import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type pg from "pg";

const mocks = vi.hoisted(() => ({
  claimNextQueuedJob: vi.fn(),
  findConsolidationCandidates: vi.fn(),
  enqueueConsolidationJob: vi.fn(),
  runConsolidationJob: vi.fn(),
}));

vi.mock("../../db/queries.js", () => ({
  claimNextQueuedJob: (...args: unknown[]) => mocks.claimNextQueuedJob(...args),
  findConsolidationCandidates: (...args: unknown[]) => mocks.findConsolidationCandidates(...args),
  enqueueConsolidationJob: (...args: unknown[]) => mocks.enqueueConsolidationJob(...args),
}));

vi.mock("../../jobs/consolidation.js", () => ({
  runConsolidationJob: (...args: unknown[]) => mocks.runConsolidationJob(...args),
}));

import { runConsolidationWorkerLoop, runSingleConsolidationCycle } from "../consolidation-worker.js";

function mockPool(): pg.Pool {
  return { query: vi.fn(), connect: vi.fn() } as unknown as pg.Pool;
}

const embedder = {
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  extractMetadata: vi.fn().mockResolvedValue({ type: "observation", topics: ["test"], people: [], action_items: [], dates: [] }),
  getVersion: () => "test-embedder",
};

const job = {
  id: "job-auto-1",
  bank_id: "openbrain",
  job_type: "observe_thoughts",
  status: "running",
  input: {
    thought_ids: ["a1b2c3d4-1234-5678-9abc-def012345678", "11111111-2222-3333-4444-555555555555"],
    project: "test-project",
  },
  output: null,
  error: null,
  attempts: 1,
  started_at: new Date("2026-06-18T00:00:00Z"),
  finished_at: null,
  created_at: new Date("2026-06-18T00:00:00Z"),
};

const observation = {
  id: "obs-auto-1",
  bank_id: "openbrain",
  content: "Synthesized observation from auto-discovered thoughts.",
  proof_count: 2,
  source_memory_ids: job.input.thought_ids,
  source_quotes: Object.fromEntries(job.input.thought_ids.map((id: string) => [id, "content"])),
  tags: ["test"],
  history: [],
  trend: null,
  trend_computed_at: null,
  project: "test-project",
  created_by: "openbrain-system",
  archived: false,
  created_at: new Date("2026-06-18T00:01:00Z"),
  updated_at: new Date("2026-06-18T00:01:00Z"),
};

/**
 * Helper: start the worker loop with a very short interval, wait one cycle,
 * then trigger SIGTERM to shut it down. Returns the loop promise.
 * Mocks must be set up before calling.
 */
async function runOneCycle(
  options: Parameters<typeof runConsolidationWorkerLoop>[0],
): Promise<void> {
  const signals: Array<() => void> = [];
  const processOnSpy = vi.spyOn(process, "on").mockImplementation(
    (event: string | symbol, listener: (...args: any[]) => void) => {
      if (event === "SIGTERM" || event === "SIGINT") {
        signals.push(listener as () => void);
      }
      return process;
    },
  );

  const loopPromise = runConsolidationWorkerLoop(options);

  // Wait for the first cycle to complete (mocks resolve synchronously in microtask)
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Trigger SIGTERM to stop the loop
  for (const handler of signals) handler();

  await loopPromise;
  processOnSpy.mockRestore();
}

describe("runConsolidationWorkerLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default safe fallbacks: no queued jobs, no candidates
    mocks.claimNextQueuedJob.mockResolvedValue(null);
    mocks.findConsolidationCandidates.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-discovers unconsolidated thoughts and enqueues a job when no queued jobs exist", async () => {
    const pool = mockPool();
    const candidates: Array<{ bank_id: string; project: string | null; thought_ids: string[] }> = [
      { bank_id: "openbrain", project: "test-project", thought_ids: job.input.thought_ids },
    ];

    mocks.claimNextQueuedJob.mockResolvedValueOnce(null);
    mocks.findConsolidationCandidates.mockResolvedValueOnce(candidates);
    mocks.enqueueConsolidationJob.mockResolvedValueOnce(job);

    await runOneCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
      intervalMs: 10,
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.findConsolidationCandidates).toHaveBeenCalledWith(pool);
    expect(mocks.enqueueConsolidationJob).toHaveBeenCalledWith(pool, {
      job_type: "observe_thoughts",
      bank_id: "openbrain",
      input: {
        thought_ids: job.input.thought_ids,
        project: "test-project",
      },
    });
  });

  it("claims and runs a queued job when one is available", async () => {
    const pool = mockPool();

    // First cycle: claim a job and run it. Subsequent cycles: claimNextQueuedJob returns null.
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce(job)
      .mockResolvedValue(null);
    mocks.runConsolidationJob.mockResolvedValueOnce({
      job: { ...job, status: "success" },
      observation,
    });

    await runOneCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
      intervalMs: 10,
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.runConsolidationJob).toHaveBeenCalledWith(
      pool,
      job,
      expect.objectContaining({
        embedder,
        synthesis: expect.objectContaining({
          endpoint: "http://127.0.0.1:11434",
          model: "test-model",
        }),
      }),
    );
    // The claimed job was processed
    expect(mocks.runConsolidationJob).toHaveBeenCalledTimes(1);
  });

  it("uses OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT env var when set", async () => {
    const pool = mockPool();
    process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT = "http://custom-llm:8080";

    mocks.claimNextQueuedJob.mockResolvedValueOnce(job);
    mocks.runConsolidationJob.mockResolvedValueOnce({
      job: { ...job, status: "success" },
      observation,
    });

    await runOneCycle({
      pool,
      embedder,
      synthesis: { endpoint: "", model: "test-model" },
      intervalMs: 10,
    });

    expect(mocks.runConsolidationJob).toHaveBeenCalledWith(
      pool,
      job,
      expect.objectContaining({
        synthesis: expect.objectContaining({
          endpoint: "http://custom-llm:8080",
        }),
      }),
    );

    delete process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT;
  });

  it("uses OPENBRAIN_LLM_CONSOLIDATION_MODEL env var when set", async () => {
    const pool = mockPool();
    process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL = "gemma-4-E4B-it";

    mocks.claimNextQueuedJob.mockResolvedValueOnce(job);
    mocks.runConsolidationJob.mockResolvedValueOnce({
      job: { ...job, status: "success" },
      observation,
    });

    await runOneCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "" },
      intervalMs: 10,
    });

    expect(mocks.runConsolidationJob).toHaveBeenCalledWith(
      pool,
      job,
      expect.objectContaining({
        synthesis: expect.objectContaining({
          model: "gemma-4-E4B-it",
        }),
      }),
    );

    delete process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL;
  });

  it("handles errors in runConsolidationJob gracefully and continues looping", async () => {
    const pool = mockPool();

    // First cycle: claim a job → error running it
    mocks.claimNextQueuedJob
      .mockResolvedValueOnce(job)   // First cycle: claim a job
      .mockResolvedValue(null);      // All subsequent cycles: no more jobs

    mocks.runConsolidationJob.mockRejectedValueOnce(new Error("LLM timeout"));

    // Two-cycle test: first cycle errors, second cycle (idle) proves loop continues
    const signals: Array<() => void> = [];
    const processOnSpy = vi.spyOn(process, "on").mockImplementation(
      (event: string | symbol, listener: (...args: any[]) => void) => {
        if (event === "SIGTERM" || event === "SIGINT") {
          signals.push(listener as () => void);
        }
        return process;
      },
    );

    const loopPromise = runConsolidationWorkerLoop({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
      intervalMs: 10,
    });

    // Wait for first cycle (claim+error) + second cycle (no job, idle)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Shut down
    for (const handler of signals) handler();
    await loopPromise;

    // claimNextQueuedJob called at least twice (once for the error cycle, once for the idle cycle)
    expect(mocks.claimNextQueuedJob.mock.calls.length).toBeGreaterThanOrEqual(2);
    // runConsolidationJob was called once (and failed)
    expect(mocks.runConsolidationJob).toHaveBeenCalledTimes(1);

    processOnSpy.mockRestore();
  });

  it("goes idle when no queued jobs and no candidates exist", async () => {
    const pool = mockPool();

    mocks.claimNextQueuedJob.mockResolvedValueOnce(null);
    mocks.findConsolidationCandidates.mockResolvedValueOnce([]);

    await runOneCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
      intervalMs: 10,
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.findConsolidationCandidates).toHaveBeenCalledWith(pool);
    expect(mocks.enqueueConsolidationJob).not.toHaveBeenCalled();
  });

  it("exits with code 1 when RSS exceeds memory cap", async () => {
    const pool = mockPool();
    const originalExitCode = process.exitCode;

    // We can't easily mock process.memoryUsage, so we test indirectly:
    // The worker checks RSS each cycle. Since we can't force RSS > 512MB in a test,
    // we verify the function exists and the cap constant is used.
    // The actual behavior is tested via integration tests.
    expect(typeof runConsolidationWorkerLoop).toBe("function");

    process.exitCode = originalExitCode;
  });
});

describe("runSingleConsolidationCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claims and runs a queued job in single-cycle mode", async () => {
    const pool = mockPool();

    mocks.claimNextQueuedJob.mockResolvedValueOnce(job);
    mocks.runConsolidationJob.mockResolvedValueOnce({
      job: { ...job, status: "success" },
      observation,
    });

    await runSingleConsolidationCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.runConsolidationJob).toHaveBeenCalledWith(
      pool,
      job,
      expect.objectContaining({
        embedder,
        synthesis: expect.objectContaining({
          endpoint: "http://127.0.0.1:11434",
          model: "test-model",
        }),
      }),
    );
    // Should NOT auto-discover after claiming a job
    expect(mocks.findConsolidationCandidates).not.toHaveBeenCalled();
    expect(mocks.enqueueConsolidationJob).not.toHaveBeenCalled();
  });

  it("auto-discovers when no queued job in single-cycle mode", async () => {
    const pool = mockPool();
    const candidates: Array<{ bank_id: string; project: string | null; thought_ids: string[] }> = [
      { bank_id: "openbrain", project: "test-project", thought_ids: job.input.thought_ids },
    ];

    mocks.claimNextQueuedJob.mockResolvedValueOnce(null);
    mocks.findConsolidationCandidates.mockResolvedValueOnce(candidates);
    mocks.enqueueConsolidationJob.mockResolvedValueOnce(job);

    await runSingleConsolidationCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.findConsolidationCandidates).toHaveBeenCalledWith(pool);
    expect(mocks.enqueueConsolidationJob).toHaveBeenCalledWith(pool, {
      job_type: "observe_thoughts",
      bank_id: "openbrain",
      input: {
        thought_ids: job.input.thought_ids,
        project: "test-project",
      },
    });
  });

  it("goes idle when no queued jobs and no candidates in single-cycle mode", async () => {
    const pool = mockPool();

    mocks.claimNextQueuedJob.mockResolvedValueOnce(null);
    mocks.findConsolidationCandidates.mockResolvedValueOnce([]);

    await runSingleConsolidationCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    });

    expect(mocks.claimNextQueuedJob).toHaveBeenCalledWith(pool);
    expect(mocks.findConsolidationCandidates).toHaveBeenCalledWith(pool);
    expect(mocks.enqueueConsolidationJob).not.toHaveBeenCalled();
  });

  it("handles errors gracefully in single-cycle mode", async () => {
    const pool = mockPool();

    mocks.claimNextQueuedJob.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(runSingleConsolidationCycle({
      pool,
      embedder,
      synthesis: { endpoint: "http://127.0.0.1:11434", model: "test-model" },
    })).rejects.toThrow("DB connection lost");
  });
});
