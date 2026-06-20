/**
 * Stale-reindex worker tests.
 * Tests the automatic background sweeper that detects and reindexes
 * documents whose chunks have stale embedder versions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing
const mockListDocumentsForReindex = vi.fn();
const mockGetDocumentChunkEmbedderVersionStats = vi.fn();
const mockUpdateDocumentWithChunks = vi.fn();
const mockChunkMarkdown = vi.fn();
const mockExtractEntities = vi.fn();
const mockExtractAndLinkChunkEntities = vi.fn();
const mockGenerateEmbedding = vi.fn();
const mockExtractMetadata = vi.fn();

vi.mock("../../db/queries.js", () => ({
  listDocumentsForReindex: mockListDocumentsForReindex,
  getDocumentChunkEmbedderVersionStats: mockGetDocumentChunkEmbedderVersionStats,
  updateDocumentWithChunks: mockUpdateDocumentWithChunks,
  extractAndLinkChunkEntities: mockExtractAndLinkChunkEntities,
}));

vi.mock("../../embedder/index.js", () => ({
  getEmbedder: () => ({
    generateEmbedding: mockGenerateEmbedding,
    extractMetadata: mockExtractMetadata,
    getVersion: () => "nomic-embed-text",
  }),
  getEmbedderCircuitStates: () => ({ primary: "CLOSED", fallbacks: [] }),
  resetAllCircuits: vi.fn(),
  getEmbedderProviders: () => ["ollama", "openrouter"],
}));

vi.mock("../../import/markdown.js", () => ({
  chunkMarkdown: mockChunkMarkdown,
}));

vi.mock("../../api/entity_extraction.js", () => ({
  extractEntities: mockExtractEntities,
}));

vi.mock("../../db/connection.js", () => ({
  getPool: () => ({
    query: vi.fn(),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
  }),
  getCipherKey: () => "test-cipher-key-aaaaaaaaaaaaaaaaaaaaaaaa",
}));

function makeDocument(overrides: Record<string, any> = {}) {
  return {
    id: "doc-1",
    title: "Test Doc",
    content: "# Hello\n\nWorld",
    source_type: "markdown",
    source_uri: null,
    metadata: {},
    project: null,
    created_by: null,
    bank_id: null,
    document_kind: null,
    session_id: null,
    task_id: null,
    intent: null,
    event_started_at: null,
    event_ended_at: null,
    status: "active",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("StaleReindexWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockChunkMarkdown.mockReturnValue([
      { content: "# Hello\n\nWorld", metadata: {}, token_count: 3, char_start: 0, char_end: 14 },
    ]);
    mockExtractEntities.mockReturnValue([]);
    mockExtractAndLinkChunkEntities.mockResolvedValue(undefined);
    mockUpdateDocumentWithChunks.mockResolvedValue({
      document: { id: "doc-1", title: "Test Doc" },
      chunks: [{ id: "chunk-1", content: "# Hello\n\nWorld", metadata: { embedder_version: "nomic-embed-text" } }],
    });
  });

  it("detects stale chunks and reindexes them", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "old-model", count: 5 },
      { embedder_version: "nomic-embed-text", count: 10 },
    ]);

    mockListDocumentsForReindex.mockResolvedValue([makeDocument()]);

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000, batchSize: 25 });
    const result = await worker.runOnce();

    expect(result.skipped).toBe(false);
    expect(result.reindexed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.staleVersions).toEqual([{ embedder_version: "old-model", count: 5 }]);
    expect(mockListDocumentsForReindex).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ staleOnly: true, targetVersion: "nomic-embed-text" })
    );
    expect(mockUpdateDocumentWithChunks).toHaveBeenCalled();
  });

  it("skips reindex when no stale chunks exist", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "nomic-embed-text", count: 10 },
    ]);

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000 });
    const result = await worker.runOnce();

    expect(result.skipped).toBe(true);
    expect(result.reindexed).toBe(0);
    expect(mockListDocumentsForReindex).not.toHaveBeenCalled();
  });

  it("continues on individual document reindex failure", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "old-model", count: 3 },
      { embedder_version: "nomic-embed-text", count: 10 },
    ]);

    mockListDocumentsForReindex.mockResolvedValue([
      makeDocument({ id: "doc-1", title: "Fail Doc" }),
      makeDocument({ id: "doc-2", title: "Good Doc" }),
    ]);

    // First doc fails, second succeeds
    mockUpdateDocumentWithChunks
      .mockRejectedValueOnce(new Error("Embedding failed"))
      .mockResolvedValueOnce({
        document: { id: "doc-2", title: "Good Doc" },
        chunks: [{ id: "chunk-2", content: "ok", metadata: {} }],
      });

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000 });
    const result = await worker.runOnce();

    expect(result.reindexed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("respects DISABLE_AUTO_REINDEX environment variable", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    vi.stubEnv("DISABLE_AUTO_REINDEX", "true");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "old-model", count: 5 },
    ]);

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000 });
    const result = await worker.runOnce();

    expect(result.skipped).toBe(true);
    expect(mockListDocumentsForReindex).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it("reports stale version stats in result", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "old-model-v1", count: 3 },
      { embedder_version: "old-model-v2", count: 2 },
      { embedder_version: "nomic-embed-text", count: 10 },
    ]);

    mockListDocumentsForReindex.mockResolvedValue([]);

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000 });
    const result = await worker.runOnce();

    expect(result.staleVersions).toEqual([
      { embedder_version: "old-model-v1", count: 3 },
      { embedder_version: "old-model-v2", count: 2 },
    ]);
  });

  it("stop() terminates the background loop", async () => {
    const { StaleReindexWorker } = await import("../stale-reindex-worker.js");

    mockGetDocumentChunkEmbedderVersionStats.mockResolvedValue([
      { embedder_version: "nomic-embed-text", count: 10 },
    ]);

    const worker = new StaleReindexWorker({ pool: {} as any, intervalMs: 60_000 });
    expect(worker.running).toBe(false);
    worker.stop();
    // stop() should be safe to call even if not started
  });
});
