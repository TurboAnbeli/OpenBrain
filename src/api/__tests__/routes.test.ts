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
const mockExtractAndLinkEntities = vi.fn().mockResolvedValue(undefined);
const mockInsertDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockUpdateDocument = vi.fn();

vi.mock("../../db/queries.js", () => ({
  insertThought: (...args: any[]) => mockInsertThought(...args),
  searchThoughts: (...args: any[]) => mockSearchThoughts(...args),
  bm25SearchThoughts: (...args: any[]) => mockBm25SearchThoughts(...args),
  listThoughts: (...args: any[]) => mockListThoughts(...args),
  getThoughtStats: (...args: any[]) => mockGetThoughtStats(...args),
  updateThought: (...args: any[]) => mockUpdateThought(...args),
  deleteThought: (...args: any[]) => mockDeleteThought(...args),
  batchInsertThoughts: (...args: any[]) => mockBatchInsertThoughts(...args),
  searchThoughtsByEntity: (...args: any[]) => mockSearchThoughtsByEntity(...args),
  extractAndLinkEntities: (...args: any[]) => mockExtractAndLinkEntities(...args),
  insertDocument: (...args: any[]) => mockInsertDocument(...args),
  getDocument: (...args: any[]) => mockGetDocument(...args),
  updateDocument: (...args: any[]) => mockUpdateDocument(...args),
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
      title: "One brain design note",
      source_type: "manual_note",
      source_uri: "onebrain://notes/design",
      content: "A database-first design note",
      metadata: { tags: ["one-brain"] },
      project: "one-brain",
      created_by: "ryan",
      status: "active",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "One brain design note",
        source_type: "manual_note",
        source_uri: "onebrain://notes/design",
        content: "A database-first design note",
        metadata: { tags: ["one-brain"] },
        project: "one-brain",
        created_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; status: string };
    expect(body.id).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
    expect(body.title).toBe("One brain design note");
    expect(body.status).toBe("active");
    expect(mockInsertDocument).toHaveBeenCalled();
    const docArg = mockInsertDocument.mock.calls[0]![1];
    expect(docArg.title).toBe("One brain design note");
    expect(docArg.source_type).toBe("manual_note");
    expect(docArg.content).toBe("A database-first design note");
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
