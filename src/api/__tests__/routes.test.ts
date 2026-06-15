/**
 * Unit tests for src/api/routes.ts
 * Tests route registration, input validation, and parameter passing using Hono test client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing
vi.mock("../../db/connection.js", () => ({
  getPool: () => {
    const mockQuery = vi.fn();
    const mockConnect = vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    });
    return { query: mockQuery, connect: mockConnect };
  },
}));

const mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockExtractMetadata = vi.fn().mockResolvedValue({
  type: "observation",
  topics: ["test"],
  people: [],
  action_items: [],
  dates: [],
});

vi.mock("../../embedder/index.js", () => ({
  getEmbedder: () => ({
    generateEmbedding: mockGenerateEmbedding,
    extractMetadata: mockExtractMetadata,
    getVersion: () => "test-embedder",
  }),
}));

// Mock query functions
const mockInsertThought = vi.fn();
const mockSearchThoughts = vi.fn();
const mockBm25SearchThoughts = vi.fn().mockResolvedValue([]);
const mockListThoughts = vi.fn();
const mockGetThoughtStats = vi.fn();
const mockUpdateThought = vi.fn();
const mockDeleteThought = vi.fn();
const mockBatchInsertThoughts = vi.fn();
const mockSearchThoughtsByEntity = vi.fn().mockResolvedValue([]);
const mockFindNearDuplicate = vi.fn();
const mockBumpProofCount = vi.fn();
const mockGetThoughtsByIds = vi.fn();
const mockArchiveThoughts = vi.fn();
const mockExtractAndLinkEntities = vi.fn().mockResolvedValue(undefined);
const mockInsertDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockGetDocumentBySourceUri = vi.fn();
const mockUpdateDocument = vi.fn();
const mockReplaceDocumentChunks = vi.fn();
const mockListDocumentChunks = vi.fn();
const mockSearchDocumentChunks = vi.fn();
const mockInsertConsolidatedObservation = vi.fn();
const mockGetConsolidatedObservation = vi.fn();
const mockSearchConsolidatedObservations = vi.fn();
const mockUpdateConsolidatedObservation = vi.fn();
const mockEnqueueConsolidationJob = vi.fn();
const mockGetConsolidationJob = vi.fn();
const mockInsertExperience = vi.fn();
const mockGetExperience = vi.fn();
const mockListExperiences = vi.fn();
const mockSearchExperiences = vi.fn();
const mockGetMemoryBankContext = vi.fn().mockResolvedValue({ id: "openbrain", name: "OpenBrain", mission: null, disposition: {}, directives: [] });
const mockInsertMemoryLink = vi.fn();
const mockGetMemoryLink = vi.fn();
const mockListMemoryLinks = vi.fn();
const mockInferExperienceTemporalLinks = vi.fn();
const mockInferSupersedesMemoryLinks = vi.fn();
const mockInferExperienceReferenceLinks = vi.fn();
const mockRunConsolidationJob = vi.fn();

vi.mock("../../db/queries.js", () => ({
  insertThought: (...args: any[]) => mockInsertThought(...args),
  searchThoughts: (...args: any[]) => mockSearchThoughts(...args),
  bm25SearchThoughts: (...args: any[]) => mockBm25SearchThoughts(...args),
  listThoughts: (...args: any[]) => mockListThoughts(...args),
  getThoughtStats: (...args: any[]) => mockGetThoughtStats(...args),
  updateThought: (...args: any[]) => mockUpdateThought(...args),
  deleteThought: (...args: any[]) => mockDeleteThought(...args),
  batchInsertThoughts: (...args: any[]) => mockBatchInsertThoughts(...args),
  findNearDuplicate: (...args: any[]) => mockFindNearDuplicate(...args),
  bumpProofCount: (...args: any[]) => mockBumpProofCount(...args),
  getThoughtsByIds: (...args: any[]) => mockGetThoughtsByIds(...args),
  archiveThoughts: (...args: any[]) => mockArchiveThoughts(...args),
  searchThoughtsByEntity: (...args: any[]) => mockSearchThoughtsByEntity(...args),
  extractAndLinkEntities: (...args: any[]) => mockExtractAndLinkEntities(...args),
  insertDocument: (...args: any[]) => mockInsertDocument(...args),
  getDocument: (...args: any[]) => mockGetDocument(...args),
  getDocumentBySourceUri: (...args: any[]) => mockGetDocumentBySourceUri(...args),
  updateDocument: (...args: any[]) => mockUpdateDocument(...args),
  replaceDocumentChunks: (...args: any[]) => mockReplaceDocumentChunks(...args),
  listDocumentChunks: (...args: any[]) => mockListDocumentChunks(...args),
  searchDocumentChunks: (...args: any[]) => mockSearchDocumentChunks(...args),
  insertConsolidatedObservation: (...args: any[]) => mockInsertConsolidatedObservation(...args),
  getConsolidatedObservation: (...args: any[]) => mockGetConsolidatedObservation(...args),
  searchConsolidatedObservations: (...args: any[]) => mockSearchConsolidatedObservations(...args),
  updateConsolidatedObservation: (...args: any[]) => mockUpdateConsolidatedObservation(...args),
  enqueueConsolidationJob: (...args: any[]) => mockEnqueueConsolidationJob(...args),
  getConsolidationJob: (...args: any[]) => mockGetConsolidationJob(...args),
  insertExperience: (...args: any[]) => mockInsertExperience(...args),
  getExperience: (...args: any[]) => mockGetExperience(...args),
  listExperiences: (...args: any[]) => mockListExperiences(...args),
  searchExperiences: (...args: any[]) => mockSearchExperiences(...args),
  getMemoryBankContext: (...args: any[]) => mockGetMemoryBankContext(...args),
  insertMemoryLink: (...args: any[]) => mockInsertMemoryLink(...args),
  getMemoryLink: (...args: any[]) => mockGetMemoryLink(...args),
  listMemoryLinks: (...args: any[]) => mockListMemoryLinks(...args),
  inferExperienceTemporalLinks: (...args: any[]) => mockInferExperienceTemporalLinks(...args),
  inferSupersedesMemoryLinks: (...args: any[]) => mockInferSupersedesMemoryLinks(...args),
  inferExperienceReferenceLinks: (...args: any[]) => mockInferExperienceReferenceLinks(...args),
}));

vi.mock("../../jobs/consolidation.js", () => ({
  runConsolidationJob: (...args: any[]) => mockRunConsolidationJob(...args),
}));

import { createApi } from "../routes.js";

describe("REST API Routes", () => {
  const app = createApi();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Health ────────────────────────────────────────────────────────

  it("GET /health returns healthy", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("healthy");
  });

  // ─── POST /memories ────────────────────────────────────────────────

  it("POST /memories accepts project and supersedes", async () => {
    mockInsertThought.mockResolvedValueOnce({
      id: "abc-123",
      content: "test",
      metadata: { type: "decision" },
      project: "plan-forge",
      created_at: new Date(),
    });

    const res = await app.request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "We chose Redis for caching",
        project: "plan-forge",
        supersedes: "a1b2c3d4-1234-5678-9abc-def012345678",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: string };
    expect(body.project).toBe("plan-forge");
  });

  it("POST /memories returns 400 for invalid supersedes UUID", async () => {
    const res = await app.request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Some valid content",
        supersedes: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /memories returns 400 for empty content", async () => {
    const res = await app.request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });

  // ─── POST /memories/search ─────────────────────────────────────────

  it("POST /memories/search accepts filter params", async () => {
    mockSearchThoughts.mockResolvedValueOnce([]);

    const res = await app.request("/memories/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "caching decisions",
        project: "plan-forge",
        type: "decision",
        topic: "caching",
        include_archived: false,
      }),
    });

    expect(res.status).toBe(200);

    // Verify searchThoughts was called with project, include_archived, and created_by
    expect(mockSearchThoughts).toHaveBeenCalled();
    const callArgs = mockSearchThoughts.mock.calls[0]!;
    expect(callArgs[5]).toBe("plan-forge"); // project param
    expect(callArgs[6]).toBe(false);        // include_archived param
  });


  it("passes the full overfetch window into negation reranking before slicing", async () => {
    const manyResults = Array.from({ length: 11 }, (_, i) => ({
      id: `hormuz-${i}`,
      content: `Hormuz candidate ${i} through the Strait of Hormuz`,
      metadata: {},
      similarity: 0.5 - i * 0.001,
      proof_count: 0,
      created_at: new Date(),
    }));
    manyResults.push({
      id: "non-hormuz",
      content: "Rule on oil price discovery: shortage is anticipatory, not reflecting actual shortage.",
      metadata: {},
      similarity: 0.4,
      proof_count: 0,
      created_at: new Date(),
    });
    mockSearchThoughts.mockResolvedValueOnce(manyResults);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);

    const res = await app.request("/memories/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "oil transit route that does NOT involve Hormuz", limit: 5 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ id: string }>; negation_reranked?: boolean; negation_terms?: string[] };
    expect(body.results[0]?.id).toBe("non-hormuz");
    expect(body.negation_reranked).toBe(true);
    expect(body.negation_terms).toContain("hormuz");
  });

  // ─── PUT /memories/:id ─────────────────────────────────────────────

  it("PUT /memories/:id returns updated thought", async () => {
    mockUpdateThought.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      content: "updated content",
      metadata: { type: "decision" },
      created_at: new Date(),
    });

    const res = await app.request("/memories/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "updated content" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; id: string };
    expect(body.status).toBe("updated");
    expect(body.id).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
  });

  it("PUT /memories/:id returns 404 when not found", async () => {
    mockUpdateThought.mockRejectedValueOnce(new Error("Thought not found: 00000000-0000-0000-0000-000000000000"));

    const res = await app.request("/memories/00000000-0000-0000-0000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "anything" }),
    });

    expect(res.status).toBe(404);
  });

  it("PUT /memories/:id returns 400 for invalid UUID", async () => {
    const res = await app.request("/memories/not-a-uuid", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "anything" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /memories/:id returns 400 for empty content", async () => {
    const res = await app.request("/memories/00000000-0000-0000-0000-000000000000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });

  // ─── DELETE /memories/:id ──────────────────────────────────────────

  it("DELETE /memories/:id returns deletion status", async () => {
    mockDeleteThought.mockResolvedValueOnce({ deleted: true, id: "a1b2c3d4-1234-5678-9abc-def012345678" });

    const res = await app.request("/memories/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("deleted");
  });

  it("DELETE /memories/:id returns 404 when not found", async () => {
    mockDeleteThought.mockResolvedValueOnce({ deleted: false, id: "00000000-0000-0000-0000-000000000000" });

    const res = await app.request("/memories/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });

  it("DELETE /memories/:id returns 400 for invalid UUID", async () => {
    const res = await app.request("/memories/not-a-uuid", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  // ─── POST /memories/batch ──────────────────────────────────────────

  it("POST /memories/batch returns array of results", async () => {
    mockBatchInsertThoughts.mockResolvedValueOnce([
      { id: "id-1", content: "thought 1", metadata: {}, project: "proj", created_at: new Date() },
      { id: "id-2", content: "thought 2", metadata: {}, project: "proj", created_at: new Date() },
    ]);

    const res = await app.request("/memories/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thoughts: [{ content: "thought 1" }, { content: "thought 2" }],
        project: "proj",
        source: "plan-forge",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; results: unknown[] };
    expect(body.count).toBe(2);
    expect(body.results).toHaveLength(2);
  });

  it("POST /memories/batch returns 400 for empty array", async () => {
    const res = await app.request("/memories/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thoughts: [] }),
    });
    expect(res.status).toBe(400);
  });


  // ─── Documents ─────────────────────────────────────────────────────

  it("POST /documents creates an editable source document", async () => {
    const createdAt = new Date();
    mockInsertDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "One brain completion handoff",
      source_type: "manual_note",
      source_uri: "onebrain://notes/handoff",
      content: "A database-first handoff note",
      metadata: { tags: ["one-brain"] },
      project: "one-brain",
      created_by: "ryan",
      bank_id: "openbrain",
      document_kind: "handoff",
      session_id: "session-42",
      task_id: "task-7",
      intent: "operational_log",
      event_started_at: new Date("2026-06-13T00:00:00Z"),
      event_ended_at: new Date("2026-06-13T01:00:00Z"),
      status: "active",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "One brain completion handoff",
        source_type: "manual_note",
        source_uri: "onebrain://notes/handoff",
        content: "A database-first handoff note",
        metadata: { tags: ["one-brain"] },
        project: "one-brain",
        created_by: "ryan",
        bank_id: "openbrain",
        document_kind: "handoff",
        session_id: "session-42",
        task_id: "task-7",
        intent: "operational_log",
        event_started_at: "2026-06-13T00:00:00Z",
        event_ended_at: "2026-06-13T01:00:00Z",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
    expect(body.title).toBe("One brain completion handoff");
    expect(body.status).toBe("active");
    expect(body.bank_id).toBe("openbrain");
    expect(body.document_kind).toBe("handoff");
    expect(body.intent).toBe("operational_log");
    expect(body.event_started_at).toBe("2026-06-13T00:00:00.000Z");
    expect(body.event_ended_at).toBe("2026-06-13T01:00:00.000Z");
    expect(mockInsertDocument).toHaveBeenCalled();
    const docArg = mockInsertDocument.mock.calls[0]![1];
    expect(docArg.title).toBe("One brain completion handoff");
    expect(docArg.source_type).toBe("manual_note");
    expect(docArg.content).toBe("A database-first handoff note");
    expect(docArg.bank_id).toBe("openbrain");
    expect(docArg.document_kind).toBe("handoff");
    expect(docArg.session_id).toBe("session-42");
    expect(docArg.task_id).toBe("task-7");
    expect(docArg.intent).toBe("operational_log");
    expect(docArg.event_started_at).toBe("2026-06-13T00:00:00Z");
    expect(docArg.event_ended_at).toBe("2026-06-13T01:00:00Z");
  });

  it("POST /documents returns 400 for missing title/source_type/content", async () => {
    const res = await app.request("/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", source_type: "manual_note", content: "" }),
    });
    expect(res.status).toBe(400);
    expect(mockInsertDocument).not.toHaveBeenCalled();
  });



  it("GET /documents/by-source-uri returns an active document for importer de-duplication", async () => {
    const createdAt = new Date();
    mockGetDocumentBySourceUri.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Already imported",
      source_type: "ryel_markdown",
      source_uri: "file:///vault/wiki/already.md",
      content: "Existing content",
      metadata: {},
      project: "one-brain",
      status: "active",
      created_by: "hermes",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/documents/by-source-uri?source_uri=" + encodeURIComponent("file:///vault/wiki/already.md"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; source_uri: string };
    expect(body.id).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
    expect(body.source_uri).toBe("file:///vault/wiki/already.md");
    expect(mockGetDocumentBySourceUri).toHaveBeenCalledWith(expect.anything(), "file:///vault/wiki/already.md");
  });

  it("GET /documents/by-source-uri validates source_uri and returns 404 when missing", async () => {
    const missingParam = await app.request("/documents/by-source-uri");
    expect(missingParam.status).toBe(400);

    mockGetDocumentBySourceUri.mockResolvedValueOnce(null);
    const missing = await app.request("/documents/by-source-uri?source_uri=" + encodeURIComponent("file:///missing.md"));
    expect(missing.status).toBe(404);
  });

  it("GET /documents/:id returns an editable source document", async () => {
    const createdAt = new Date();
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Stored source",
      source_type: "markdown",
      source_uri: "file:///tmp/source.md",
      content: "Stored source body",
      metadata: {},
      project: "one-brain",
      created_by: "ryan",
      status: "active",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; content: string };
    expect(body.content).toBe("Stored source body");
    expect(mockGetDocument).toHaveBeenCalled();
    expect(mockGetDocument.mock.calls[0]![1]).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
  });

  it("GET /documents/:id validates UUID and returns 404 when missing", async () => {
    const invalid = await app.request("/documents/not-a-uuid");
    expect(invalid.status).toBe(400);

    mockGetDocument.mockResolvedValueOnce(null);
    const missing = await app.request("/documents/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });

  it("PATCH /documents/:id updates source content and records revisions through the query layer", async () => {
    const updatedAt = new Date();
    mockUpdateDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Updated source",
      source_type: "markdown",
      source_uri: "file:///tmp/source.md",
      content: "Updated source body",
      metadata: { tags: ["updated"] },
      project: "one-brain",
      created_by: "ryan",
      status: "active",
      created_at: updatedAt,
      updated_at: updatedAt,
    });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated source",
        content: "Updated source body",
        metadata: { tags: ["updated"] },
        edit_reason: "manual correction",
        updated_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; content: string };
    expect(body.title).toBe("Updated source");
    expect(body.content).toBe("Updated source body");
    const patchArg = mockUpdateDocument.mock.calls[0]![2];
    expect(patchArg.edit_reason).toBe("manual correction");
    expect(patchArg.updated_by).toBe("ryan");
  });

  it("PATCH /documents/:id validates UUID and returns 404 when the document is missing", async () => {
    const invalid = await app.request("/documents/not-a-uuid", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(invalid.status).toBe(400);

    mockUpdateDocument.mockRejectedValueOnce(new Error("Document not found: 00000000-0000-0000-0000-000000000000"));
    const missing = await app.request("/documents/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(missing.status).toBe(404);
  });



  it("PUT /documents/:id/chunks embeds and replaces chunks for an existing document", async () => {
    const createdAt = new Date();
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Chunked source",
      source_type: "markdown",
      content: "Full source body",
      metadata: {},
      status: "active",
      created_at: createdAt,
      updated_at: createdAt,
    });
    mockReplaceDocumentChunks.mockResolvedValueOnce([
      {
        id: "chunk-0",
        document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
        chunk_index: 0,
        content: "First chunk",
        metadata: { heading: "intro" },
        token_count: 2,
        char_start: 0,
        char_end: 11,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/chunks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks: [{ content: "First chunk", metadata: { heading: "intro" }, token_count: 2, char_start: 0, char_end: 11 }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; chunks: Array<{ content: string }> };
    expect(body.count).toBe(1);
    expect(body.chunks[0]!.content).toBe("First chunk");
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("First chunk");
    expect(mockReplaceDocumentChunks).toHaveBeenCalled();
    const chunkArg = mockReplaceDocumentChunks.mock.calls[0]![2][0];
    expect(chunkArg.chunk_index).toBe(0);
    expect(chunkArg.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("PUT /documents/:id/chunks validates document id, document existence, and chunk content", async () => {
    const invalid = await app.request("/documents/not-a-uuid/chunks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: [{ content: "x" }] }),
    });
    expect(invalid.status).toBe(400);

    mockGetDocument.mockResolvedValueOnce(null);
    const missing = await app.request("/documents/00000000-0000-0000-0000-000000000000/chunks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: [{ content: "x" }] }),
    });
    expect(missing.status).toBe(404);

    mockGetDocument.mockResolvedValueOnce({ id: "a1b2c3d4-1234-5678-9abc-def012345678" });
    const empty = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/chunks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: [{ content: "" }] }),
    });
    expect(empty.status).toBe(400);
  });

  it("GET /documents/:id/chunks returns chunks in storage order", async () => {
    const createdAt = new Date();
    mockGetDocument.mockResolvedValueOnce({ id: "a1b2c3d4-1234-5678-9abc-def012345678" });
    mockListDocumentChunks.mockResolvedValueOnce([
      {
        id: "chunk-0",
        document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
        chunk_index: 0,
        content: "First chunk",
        metadata: {},
        token_count: 2,
        char_start: 0,
        char_end: 11,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/chunks");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; chunks: Array<{ chunk_index: number }> };
    expect(body.count).toBe(1);
    expect(body.chunks[0]!.chunk_index).toBe(0);
    expect(mockListDocumentChunks).toHaveBeenCalled();
  });



  it("POST /documents/search embeds the query and returns matching document chunks", async () => {
    const createdAt = new Date();
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "chunk-0",
        document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
        document_title: "One brain design",
        document_source_type: "markdown",
        document_source_uri: "file:///design.md",
        project: "one-brain",
        chunk_index: 0,
        content: "Database-first knowledge browser",
        metadata: { heading: "design" },
        token_count: 4,
        char_start: 0,
        char_end: 32,
        similarity: 0.91,
        fts_rank: 0,
        score: 0.91,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/documents/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "database-first browser",
        limit: 5,
        threshold: 0.3,
        project: "one-brain",
        source_type: "markdown",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; results: Array<{ document_title: string; similarity: number }> };
    expect(body.count).toBe(1);
    expect(body.results[0]!.document_title).toBe("One brain design");
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("database-first browser");
    expect(mockSearchDocumentChunks).toHaveBeenCalled();
    const options = mockSearchDocumentChunks.mock.calls[0]![2];
    expect(options.limit).toBe(5);
    expect(options.threshold).toBe(0.3);
    expect(options.project).toBe("one-brain");
    expect(options.source_type).toBe("markdown");
  });



  it("POST /documents/search supports hybrid mode and returns score components", async () => {
    const createdAt = new Date();
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "chunk-0",
        document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
        document_title: "Exact config token note",
        document_source_type: "markdown",
        document_source_uri: "file:///config.md",
        project: "one-brain",
        chunk_index: 0,
        content: "OPENBRAIN_SEARCH_THRESHOLD controls retrieval cutoff",
        metadata: {},
        token_count: 4,
        char_start: 0,
        char_end: 52,
        similarity: 0.72,
        fts_rank: 0.41,
        score: 0.6425,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/documents/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "OPENBRAIN_SEARCH_THRESHOLD",
        mode: "hybrid",
        vector_weight: 0.75,
        fts_weight: 0.25,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; results: Array<{ fts_rank: number; score: number }> };
    expect(body.mode).toBe("hybrid");
    expect(body.results[0]!.fts_rank).toBe(0.41);
    expect(body.results[0]!.score).toBe(0.6425);
    const options = mockSearchDocumentChunks.mock.calls[0]![2];
    expect(options.query).toBe("OPENBRAIN_SEARCH_THRESHOLD");
    expect(options.mode).toBe("hybrid");
    expect(options.vector_weight).toBe(0.75);
    expect(options.fts_weight).toBe(0.25);
  });

  it("POST /documents/search rejects invalid search mode", async () => {
    const res = await app.request("/documents/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "valid", mode: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /documents/search validates query and bounds limit", async () => {
    const empty = await app.request("/documents/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(empty.status).toBe(400);

    mockSearchDocumentChunks.mockResolvedValueOnce([]);
    const res = await app.request("/documents/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "valid", limit: 500 }),
    });
    expect(res.status).toBe(200);
    expect(mockSearchDocumentChunks.mock.calls[0]![2].limit).toBe(100);
  });

  // ─── Consolidated Observations ───────────────────────────────────────────────────

  it("POST /consolidated-observations creates a first-class observation row", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockInsertConsolidatedObservation.mockResolvedValueOnce({
      id: "obs-123",
      bank_id: "openbrain",
      content: "Consolidated one-brain note",
      proof_count: 2,
      source_memory_ids: [
        "a1b2c3d4-1234-5678-9abc-def012345678",
        "11111111-2222-3333-4444-555555555555",
      ],
      tags: ["strategy"],
      history: [],
      trend: "stable",
      trend_computed_at: createdAt,
      project: "one-brain",
      created_by: "ryan",
      archived: false,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/consolidated-observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Consolidated one-brain note",
        source_memory_ids: [
          "a1b2c3d4-1234-5678-9abc-def012345678",
          "11111111-2222-3333-4444-555555555555",
        ],
        tags: ["strategy"],
        trend: "stable",
        project: "one-brain",
        created_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Consolidated one-brain note");
    expect(mockInsertConsolidatedObservation).toHaveBeenCalled();
    const insertArg = mockInsertConsolidatedObservation.mock.calls[0]![1];
    expect(insertArg.proof_count).toBe(2);
    expect(insertArg.project).toBe("one-brain");
  });

  it("POST /consolidated-observations/search embeds the query and returns matches", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockSearchConsolidatedObservations.mockResolvedValueOnce([
      {
        id: "obs-123",
        bank_id: "openbrain",
        content: "Consolidated one-brain note",
        proof_count: 2,
        source_memory_ids: [],
        source_quotes: {},
        tags: ["strategy"],
        history: [],
        trend: "stable",
        trend_computed_at: null,
        project: "one-brain",
        created_by: "ryan",
        archived: false,
        similarity: 0.87,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/consolidated-observations/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "one-brain strategy", project: "one-brain", limit: 5 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; results: Array<{ similarity: number }> };
    expect(body.count).toBe(1);
    expect(body.results[0]!.similarity).toBe(0.87);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("one-brain strategy");
    expect(mockSearchConsolidatedObservations.mock.calls[0]![2].project).toBe("one-brain");
  });

  it("GET /consolidated-observations/:id returns the observation payload", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockGetConsolidatedObservation.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      content: "Consolidated one-brain note",
      proof_count: 2,
      source_memory_ids: [],
      tags: ["strategy"],
      history: [],
      trend: "stable",
      trend_computed_at: null,
      project: "one-brain",
      created_by: "ryan",
      archived: false,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/consolidated-observations/a1b2c3d4-1234-5678-9abc-def012345678");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; content: string };
    expect(body.id).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
    expect(body.content).toBe("Consolidated one-brain note");
  });

  it("PUT /consolidated-observations/:id updates the observation and re-embeds changed content", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockUpdateConsolidatedObservation.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      content: "Updated observation",
      proof_count: 3,
      source_memory_ids: [],
      tags: ["strategy"],
      history: [{ previous_content: "Consolidated one-brain note" }],
      trend: "strengthening",
      trend_computed_at: null,
      project: "one-brain",
      created_by: "ryan",
      archived: false,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/consolidated-observations/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Updated observation",
        proof_count: 3,
        trend: "strengthening",
        edit_reason: "refresh with more evidence",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Updated observation");
    const updateArg = mockUpdateConsolidatedObservation.mock.calls[0]![2];
    expect(updateArg.proof_count).toBe(3);
    expect(updateArg.edit_reason).toBe("refresh with more evidence");
  });


  // ─── Experiences ─────────────────────────────────────────────────────

  it("POST /experiences captures explicit high-value experience events with retain directives", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: "Durable memory",
      disposition: {},
      directives: [
        { id: "741a9339-ceb3-468b-81ac-616567382122", name: "no_pii_verbatim", rule_text: "Never store MRN, PHIN, DOB, SIN, patient names, or identifying medical details verbatim.", severity: "hard", priority: 100 },
      ],
    });
    mockInsertExperience.mockResolvedValueOnce({
      id: "exp-123",
      bank_id: "openbrain",
      session_id: "session-slice-d",
      agent_id: "hermes",
      occurred_at: createdAt,
      event_type: "tool_call",
      content: "Ran a live smoke and archived the temporary row.",
      refs: { consolidation_jobs: ["c51282a0-a8ba-4ff7-bcd7-55b74bf991e6"], applied_directive_ids: ["741a9339-ceb3-468b-81ac-616567382122"] },
      project: "one-brain",
      created_by: "hermes",
      created_at: createdAt,
    });

    const res = await app.request("/experiences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "tool_call",
        content: "Ran a live smoke and archived the temporary row.",
        session_id: "session-slice-d",
        agent_id: "hermes",
        refs: { consolidation_jobs: ["c51282a0-a8ba-4ff7-bcd7-55b74bf991e6"] },
        project: "one-brain",
        created_by: "hermes",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGetMemoryBankContext).toHaveBeenCalledWith(expect.anything(), "openbrain", "retain");
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("Ran a live smoke and archived the temporary row.");
    const insertArg = mockInsertExperience.mock.calls[0]![1];
    expect(insertArg.event_type).toBe("tool_call");
    expect(insertArg.refs.applied_directive_ids).toEqual(["741a9339-ceb3-468b-81ac-616567382122"]);
    const body = (await res.json()) as { id: string; event_type: string };
    expect(body.id).toBe("exp-123");
    expect(body.event_type).toBe("tool_call");
  });

  it("POST /experiences rejects verbatim identifiers when retain PII directive is active", async () => {
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: "Durable memory",
      disposition: {},
      directives: [
        { id: "741a9339-ceb3-468b-81ac-616567382122", name: "no_pii_verbatim", rule_text: "Never store MRN, PHIN, DOB, SIN, patient names, or identifying medical details verbatim.", severity: "hard", priority: 100 },
      ],
    });

    const res = await app.request("/experiences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "user_message",
        content: "Patient name: Jane Smith, MRN 123456 should never be captured.",
      }),
    });

    expect(res.status).toBe(422);
    expect(mockInsertExperience).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("GET /experiences lists rows filtered by session_id and event_type", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockListExperiences.mockResolvedValueOnce([
      { id: "exp-123", bank_id: "openbrain", session_id: "session-slice-d", agent_id: "hermes", occurred_at: createdAt, event_type: "assistant_message", content: "Final response summary", refs: {}, project: "one-brain", created_by: "hermes", created_at: createdAt },
    ]);

    const res = await app.request("/experiences?session_id=session-slice-d&event_type=assistant_message&project=one-brain&limit=5");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; results: Array<{ session_id: string; event_type: string }> };
    expect(body.count).toBe(1);
    expect(body.results[0]!.session_id).toBe("session-slice-d");
    expect(mockListExperiences.mock.calls[0]![1]).toMatchObject({ session_id: "session-slice-d", event_type: "assistant_message", project: "one-brain", limit: 5 });
  });

  it("POST /experiences/search embeds query and applies session/event filters", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockSearchExperiences.mockResolvedValueOnce([
      { id: "exp-123", bank_id: "openbrain", session_id: "session-slice-d", agent_id: "hermes", occurred_at: createdAt, event_type: "tool_call", content: "Consolidation smoke succeeded", refs: {}, project: "one-brain", created_by: "hermes", similarity: 0.83, created_at: createdAt },
    ]);

    const res = await app.request("/experiences/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "consolidation smoke", session_id: "session-slice-d", event_type: "tool_call", limit: 3 }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("consolidation smoke");
    expect(mockSearchExperiences.mock.calls[0]![2]).toMatchObject({ session_id: "session-slice-d", event_type: "tool_call", limit: 3 });
    const body = (await res.json()) as { results: Array<{ similarity: number }> };
    expect(body.results[0]!.similarity).toBe(0.83);
  });


  // ─── Memory Links ────────────────────────────────────────────────────

  it("POST /memory-links upserts explicit deterministic links", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockInsertMemoryLink.mockResolvedValueOnce({
      id: "link-123",
      bank_id: "openbrain",
      source_type: "experience",
      source_id: "22222222-2222-4222-8222-222222222222",
      target_type: "experience",
      target_id: "11111111-1111-4111-8111-111111111111",
      relationship: "temporal_after",
      weight: 1,
      inferred: true,
      created_at: createdAt,
    });

    const res = await app.request("/memory-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "experience",
        source_id: "22222222-2222-4222-8222-222222222222",
        target_type: "experience",
        target_id: "11111111-1111-4111-8111-111111111111",
        relationship: "temporal_after",
      }),
    });

    expect(res.status).toBe(200);
    const insertArg = mockInsertMemoryLink.mock.calls[0]![1];
    expect(insertArg).toMatchObject({ bank_id: "openbrain", relationship: "temporal_after", inferred: true });
    const body = (await res.json()) as { id: string; relationship: string };
    expect(body.id).toBe("link-123");
    expect(body.relationship).toBe("temporal_after");
  });

  it("GET /memory-links lists links with relationship and source filters", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockListMemoryLinks.mockResolvedValueOnce([
      { id: "link-123", bank_id: "openbrain", source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222", target_type: "experience", target_id: "11111111-1111-4111-8111-111111111111", relationship: "temporal_after", weight: 1, inferred: true, created_at: createdAt },
    ]);

    const res = await app.request("/memory-links?source_type=experience&source_id=22222222-2222-4222-8222-222222222222&relationship=temporal_after&limit=5");

    expect(res.status).toBe(200);
    expect(mockListMemoryLinks.mock.calls[0]![1]).toMatchObject({ source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222", relationship: "temporal_after", limit: 5 });
    const body = (await res.json()) as { count: number; results: Array<{ relationship: string }> };
    expect(body.count).toBe(1);
    expect(body.results[0]!.relationship).toBe("temporal_after");
  });

  it("POST /memory-links/infer runs only requested deterministic rules", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    const temporalLink = { id: "temporal-link", bank_id: "openbrain", source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222", target_type: "experience", target_id: "11111111-1111-4111-8111-111111111111", relationship: "temporal_after", weight: 1, inferred: true, created_at: createdAt };
    const supersedesLink = { id: "supersedes-link", bank_id: "openbrain", source_type: "thought", source_id: "33333333-3333-4333-8333-333333333333", target_type: "thought", target_id: "44444444-4444-4444-8444-444444444444", relationship: "supersedes", weight: 1, inferred: true, created_at: createdAt };
    mockInferExperienceTemporalLinks.mockResolvedValueOnce([temporalLink]);
    mockInferSupersedesMemoryLinks.mockResolvedValueOnce([supersedesLink]);

    const res = await app.request("/memory-links/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: "openbrain",
        session_id: "slice-e-smoke",
        rules: ["experience_temporal_after", "thought_supersedes"],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockInferExperienceTemporalLinks).toHaveBeenCalledWith(expect.anything(), { bank_id: "openbrain", session_id: "slice-e-smoke" });
    expect(mockInferSupersedesMemoryLinks).toHaveBeenCalledWith(expect.anything(), { bank_id: "openbrain" });
    expect(mockInferExperienceReferenceLinks).not.toHaveBeenCalled();
    const body = (await res.json()) as { count: number; rules: Record<string, number> };
    expect(body.count).toBe(2);
    expect(body.rules.experience_temporal_after).toBe(1);
    expect(body.rules.thought_supersedes).toBe(1);
  });


  // ─── Consolidation Jobs ─────────────────────────────────────────────

  it("POST /consolidation-jobs enqueues explicit observe_thoughts jobs", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockEnqueueConsolidationJob.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      job_type: "observe_thoughts",
      status: "queued",
      input: {
        thought_ids: [
          "11111111-2222-3333-4444-555555555555",
          "66666666-7777-8888-9999-aaaaaaaaaaaa",
        ],
        project: "one-brain",
        created_by: "hermes",
      },
      output: null,
      error: null,
      started_at: null,
      finished_at: null,
      attempts: 0,
      created_at: createdAt,
    });

    const res = await app.request("/consolidation-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_type: "observe_thoughts",
        thought_ids: [
          "11111111-2222-3333-4444-555555555555",
          "66666666-7777-8888-9999-aaaaaaaaaaaa",
        ],
        project: "one-brain",
        created_by: "hermes",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; job_type: string };
    expect(body.status).toBe("queued");
    expect(body.job_type).toBe("observe_thoughts");
    expect(mockEnqueueConsolidationJob.mock.calls[0]![1]).toMatchObject({
      job_type: "observe_thoughts",
      bank_id: "openbrain",
      input: {
        thought_ids: [
          "11111111-2222-3333-4444-555555555555",
          "66666666-7777-8888-9999-aaaaaaaaaaaa",
        ],
        project: "one-brain",
        created_by: "hermes",
      },
    });
  });

  it("POST /consolidation-jobs validates explicit source ids", async () => {
    const res = await app.request("/consolidation-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_type: "observe_thoughts", thought_ids: ["not-a-uuid"] }),
    });

    expect(res.status).toBe(400);
    expect(mockEnqueueConsolidationJob).not.toHaveBeenCalled();
  });

  it("GET /consolidation-jobs/:id returns a job", async () => {
    mockGetConsolidationJob.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      job_type: "observe_documents",
      status: "success",
      input: { source_uris: ["file:///vault/example.md"] },
      output: { observation_id: "11111111-2222-3333-4444-555555555555" },
      error: null,
      started_at: new Date("2026-06-15T00:00:00Z"),
      finished_at: new Date("2026-06-15T00:01:00Z"),
      attempts: 1,
      created_at: new Date("2026-06-15T00:00:00Z"),
    });

    const res = await app.request("/consolidation-jobs/a1b2c3d4-1234-5678-9abc-def012345678");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; output: { observation_id: string } };
    expect(body.status).toBe("success");
    expect(body.output.observation_id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("POST /consolidation-jobs/:id/run runs a queued job", async () => {
    mockRunConsolidationJob.mockResolvedValueOnce({
      job: {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        bank_id: "openbrain",
        job_type: "observe_documents",
        status: "success",
        input: { source_uris: ["file:///vault/example.md"] },
        output: { observation_id: "11111111-2222-3333-4444-555555555555", source_count: 1 },
        error: null,
        started_at: new Date("2026-06-15T00:00:00Z"),
        finished_at: new Date("2026-06-15T00:01:00Z"),
        attempts: 1,
        created_at: new Date("2026-06-15T00:00:00Z"),
      },
      observation: {
        id: "11111111-2222-3333-4444-555555555555",
        bank_id: "openbrain",
        content: "Synthesized document observation",
        proof_count: 1,
        source_memory_ids: ["a1b2c3d4-1234-5678-9abc-def012345678"],
        source_quotes: {},
        tags: ["one-brain"],
        history: [],
        trend: null,
        trend_computed_at: null,
        project: "one-brain",
        created_by: "hermes",
        archived: false,
        created_at: new Date("2026-06-15T00:01:00Z"),
        updated_at: new Date("2026-06-15T00:01:00Z"),
      },
    });

    const res = await app.request("/consolidation-jobs/a1b2c3d4-1234-5678-9abc-def012345678/run", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { status: string }; observation: { id: string } };
    expect(body.job.status).toBe("success");
    expect(body.observation.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(mockRunConsolidationJob).toHaveBeenCalled();
    expect(mockRunConsolidationJob.mock.calls[0]![2].synthesis.model).toBe("qwen3:1.7b");
  });

  // ─── GET /stats ────────────────────────────────────────────────────

  it("GET /stats accepts project query param", async () => {
    mockGetThoughtStats.mockResolvedValueOnce({
      total_thoughts: 5,
      types: {},
      top_topics: [],
      top_people: [],
      date_range: { earliest: null, latest: null },
    });

    const res = await app.request("/stats?project=plan-forge");
    expect(res.status).toBe(200);

    // Verify getThoughtStats was called with project
    expect(mockGetThoughtStats).toHaveBeenCalled();
    const callArgs = mockGetThoughtStats.mock.calls[0]!;
    expect(callArgs[1]).toBe("plan-forge");
  });
});
