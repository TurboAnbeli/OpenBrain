/**
 * Unit tests for src/db/queries.ts
 * Uses mocked pg.Pool to test query construction and parameter passing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type pg from "pg";

import {
  insertThought,
  searchThoughts,
  listThoughts,
  getThoughtStats,
  updateThought,
  deleteThought,
  batchInsertThoughts,
  insertDocument,
  listDocuments,
  getDocument,
  getDocumentBySourceUri,
  updateDocument,
  listDocumentRevisions,
  getDocumentRevision,
  deleteDocument,
  replaceDocumentChunks,
  listDocumentChunks,
  searchDocumentChunks,
  insertConsolidatedObservation,
  getConsolidatedObservation,
  searchConsolidatedObservations,
  updateConsolidatedObservation,
  insertMentalModel,
  getMentalModel,
  listMentalModels,
  searchMentalModels,
  updateMentalModel,
  enqueueConsolidationJob,
  getConsolidationJob,
  startConsolidationJob,
  completeConsolidationJob,
  failConsolidationJob,
  getMemoryBankContext,
  insertExperience,
  getExperience,
  listExperiences,
  searchExperiences,
  insertMemoryLink,
  getMemoryLink,
  listMemoryLinks,
  expandMemoryLinks,
  recallTemporalMemories,
  inferExperienceTemporalLinks,
  inferSupersedesMemoryLinks,
  inferExperienceReferenceLinks,
  claimNextQueuedJob,
  findConsolidationCandidates,
  type ExperienceInput,
  type MemoryLinkInput,
  type ThoughtMetadata,
  type DocumentInput,
  type DocumentChunkInput,
  type ConsolidatedObservationInput,
  type MentalModelInput,
} from "../queries.js";

// ─── Mock Pool Factory ──────────────────────────────────────────────

function createMockPool() {
  const mockQuery = vi.fn();
  const mockRelease = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue({
    query: mockQuery,
    release: mockRelease,
  });

  const pool = {
    query: mockQuery,
    connect: mockConnect,
  } as unknown as pg.Pool;

  return { pool, mockQuery, mockConnect, mockRelease };
}

// ─── insertThought ──────────────────────────────────────────────────

describe("insertThought", () => {
  it("inserts with project and supersedes params", async () => {
    const { pool, mockQuery } = createMockPool();
    const metadata: ThoughtMetadata = { type: "decision", source: "mcp" };
    const row = {
      id: "abc-123",
      content: "test content",
      metadata,
      project: "plan-forge",
      archived: false,
      supersedes: null,
      created_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await insertThought(
      pool, "test content", [0.1, 0.2], metadata, "plan-forge", undefined, undefined
    );

    expect(result.id).toBe("abc-123");
    expect(result.project).toBe("plan-forge");

    // Verify SQL includes project, supersedes, and created_by columns
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("project");
    expect(sql).toContain("supersedes");
    expect(sql).toContain("created_by");

    // Verify params include project, null supersedes, and null created_by
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBe("plan-forge");
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
  });

  it("inserts without project (backward compatible)", async () => {
    const { pool, mockQuery } = createMockPool();
    const metadata: ThoughtMetadata = { type: "observation" };
    const row = {
      id: "def-456",
      content: "old style",
      metadata,
      project: null,
      archived: false,
      supersedes: null,
      created_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await insertThought(pool, "old style", [0.3], metadata);

    expect(result.project).toBeNull();
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[3]).toBeNull(); // project
    expect(params[4]).toBeNull(); // supersedes
    expect(params[5]).toBeNull(); // created_by
  });

  it("inserts with created_by when provided", async () => {
    const { pool, mockQuery } = createMockPool();
    const metadata: ThoughtMetadata = { type: "observation" };
    const row = {
      id: "ghi-789",
      content: "user thought",
      metadata,
      project: "proj",
      created_by: "sarah",
      archived: false,
      supersedes: null,
      created_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await insertThought(pool, "user thought", [0.4], metadata, "proj", undefined, "sarah");

    expect(result.created_by).toBe("sarah");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[5]).toBe("sarah");
  });
});

// ─── searchThoughts ─────────────────────────────────────────────────

describe("searchThoughts", () => {
  it("passes project and include_archived to match_thoughts RPC", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchThoughts(pool, [0.1], 10, 0.5, {}, "plan-forge", false);

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    // Params: embedding, threshold, limit, filter, project_filter, include_archived, user_filter
    expect(params[4]).toBe("plan-forge");
    expect(params[5]).toBe(false);
  });

  it("passes created_by as user_filter to match_thoughts RPC", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchThoughts(pool, [0.1], 10, 0.5, {}, "plan-forge", false, "sarah");

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[6]).toBe("sarah");
  });

  it("passes type and topic as JSONB filter", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const filter = { type: "decision", topics: ["caching"] };
    await searchThoughts(pool, [0.1], 10, 0.5, filter);

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    const jsonFilter = JSON.parse(params[3] as string);
    expect(jsonFilter.type).toBe("decision");
    expect(jsonFilter.topics).toEqual(["caching"]);
  });

  it("works without filters (backward compatible)", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await searchThoughts(pool, [0.1]);

    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[4]).toBeNull();  // project
    expect(params[5]).toBe(false); // include_archived
    expect(params[6]).toBeNull();  // created_by
  });
});

// ─── listThoughts ───────────────────────────────────────────────────

describe("listThoughts", () => {
  it("filters by project when provided", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listThoughts(pool, { project: "openbrain" });

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("project =");
  });

  it("excludes archived by default", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listThoughts(pool, {});

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("archived = false");
  });

  it("filters by created_by when provided", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listThoughts(pool, { created_by: "sarah" });

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("created_by =");
  });

  it("includes archived when requested", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await listThoughts(pool, { include_archived: true });

    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).not.toContain("archived = false");
  });
});

// ─── getThoughtStats ────────────────────────────────────────────────

describe("getThoughtStats", () => {
  const defaultMocks = (mockQuery: ReturnType<typeof vi.fn>) => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: "5" }] })       // total
      .mockResolvedValueOnce({ rows: [] })                       // types
      .mockResolvedValueOnce({ rows: [] })                       // topics
      .mockResolvedValueOnce({ rows: [] })                       // people
      .mockResolvedValueOnce({ rows: [{ earliest: null, latest: null }] }); // range
  };

  it("scopes by project when provided", async () => {
    const { pool, mockQuery } = createMockPool();
    defaultMocks(mockQuery);

    await getThoughtStats(pool, "plan-forge");

    // First call (count) should include project filter
    const countSql = mockQuery.mock.calls[0]![0] as string;
    expect(countSql).toContain("project =");
    const countParams = mockQuery.mock.calls[0]![1] as unknown[];
    expect(countParams[0]).toBe("plan-forge");
  });

  it("scopes by created_by when provided", async () => {
    const { pool, mockQuery } = createMockPool();
    defaultMocks(mockQuery);

    await getThoughtStats(pool, undefined, "sarah");

    const countSql = mockQuery.mock.calls[0]![0] as string;
    expect(countSql).toContain("created_by =");
    const countParams = mockQuery.mock.calls[0]![1] as unknown[];
    expect(countParams[0]).toBe("sarah");
  });

  it("does not filter by project when omitted", async () => {
    const { pool, mockQuery } = createMockPool();
    defaultMocks(mockQuery);

    await getThoughtStats(pool);

    const countSql = mockQuery.mock.calls[0]![0] as string;
    expect(countSql).not.toContain("project =");
  });
});

// ─── updateThought ──────────────────────────────────────────────────

describe("updateThought", () => {
  it("returns updated row", async () => {
    const { pool, mockQuery } = createMockPool();
    const row = {
      id: "abc-123",
      content: "updated",
      metadata: { type: "decision" },
      project: null,
      archived: false,
      supersedes: null,
      created_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    const result = await updateThought(
      pool, "abc-123", "updated", [0.1], { type: "decision" }
    );

    expect(result.id).toBe("abc-123");
    expect(result.content).toBe("updated");
  });

  it("throws when thought not found", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      updateThought(pool, "nonexistent", "content", [0.1], {})
    ).rejects.toThrow("Thought not found");
  });
});

// ─── deleteThought ──────────────────────────────────────────────────

describe("deleteThought", () => {
  it("returns deletion confirmation", async () => {
    const { pool, mockQuery } = createMockPool();
    // First call: clear supersedes refs
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    // Second call: delete
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await deleteThought(pool, "abc-123");

    expect(result.deleted).toBe(true);
    expect(result.id).toBe("abc-123");
  });

  it("returns deleted=false when thought not found", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await deleteThought(pool, "nonexistent");

    expect(result.deleted).toBe(false);
  });
});

// ─── batchInsertThoughts ────────────────────────────────────────────

describe("batchInsertThoughts", () => {
  it("inserts all thoughts within a transaction", async () => {
    const { pool, mockQuery, mockConnect } = createMockPool();
    const clientQuery = (await mockConnect()).query;

    const row = (i: number) => ({
      id: `id-${i}`,
      content: `thought ${i}`,
      metadata: {},
      project: "proj",
      archived: false,
      supersedes: null,
      created_at: new Date(),
    });

    // BEGIN, INSERT x2, COMMIT
    clientQuery
      .mockResolvedValueOnce({})                     // BEGIN
      .mockResolvedValueOnce({ rows: [row(1)] })     // INSERT 1
      .mockResolvedValueOnce({ rows: [row(2)] })     // INSERT 2
      .mockResolvedValueOnce({});                     // COMMIT

    const results = await batchInsertThoughts(pool, [
      { content: "thought 1", embedding: [0.1], metadata: {}, project: "proj" },
      { content: "thought 2", embedding: [0.2], metadata: {}, project: "proj" },
    ]);

    expect(results).toHaveLength(2);

    // Verify transaction flow: BEGIN → INSERTs → COMMIT
    expect(clientQuery.mock.calls[0]![0]).toBe("BEGIN");
    expect(clientQuery.mock.calls[3]![0]).toBe("COMMIT");
  });

  it("rolls back on error", async () => {
    const { pool, mockConnect } = createMockPool();
    const client = await mockConnect();

    client.query
      .mockResolvedValueOnce({})                          // BEGIN
      .mockRejectedValueOnce(new Error("insert failed")); // INSERT fails

    await expect(
      batchInsertThoughts(pool, [
        { content: "fail", embedding: [0.1], metadata: {} },
      ])
    ).rejects.toThrow("insert failed");

    // Should have called ROLLBACK
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });
});


// ─── Documents ──────────────────────────────────────────────────────

describe("documents", () => {
  const documentInput: DocumentInput = {
    title: "PEITHO trial article",
    source_type: "pdf",
    source_uri: "file:///literature/peitho.pdf",
    content: "Full extracted article text",
    metadata: { doi: "10.1056/example", tags: ["pulmonary-embolism"] },
    project: "medical-literature",
    created_by: "ryan",
    bank_id: "openbrain",
    document_kind: "research",
    session_id: "session-42",
    task_id: "task-7",
    intent: "durable_knowledge",
    event_started_at: "2026-06-14T08:00:00Z",
    event_ended_at: "2026-06-14T09:00:00Z",
  };

  it("inserts source documents with encrypted content and provenance metadata", async () => {
    const { pool, mockQuery } = createMockPool();
    const row = {
      id: "doc-123",
      title: documentInput.title,
      source_type: documentInput.source_type,
      source_uri: documentInput.source_uri,
      content: documentInput.content,
      metadata: documentInput.metadata,
      project: documentInput.project,
      created_by: documentInput.created_by,
      bank_id: documentInput.bank_id,
      document_kind: documentInput.document_kind,
      session_id: documentInput.session_id,
      task_id: documentInput.task_id,
      intent: documentInput.intent,
      event_started_at: new Date("2026-06-14T08:00:00Z"),
      event_ended_at: new Date("2026-06-14T09:00:00Z"),
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await insertDocument(pool, documentInput);

    expect(result.id).toBe("doc-123");
    expect(result.content).toBe(documentInput.content);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO documents");
    expect(sql).toContain("pgp_sym_encrypt($4");
    expect(sql).toContain("to_tsvector('english', $4)");
    expect(sql).toContain("bank_id");
    expect(sql).toContain("document_kind");
    expect(sql).toContain("intent");
    expect(sql).toContain("event_started_at");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(documentInput.title);
    expect(params[1]).toBe(documentInput.source_type);
    expect(params[2]).toBe(documentInput.source_uri);
    expect(params[3]).toBe(documentInput.content);
    expect(JSON.parse(params[4] as string)).toEqual(documentInput.metadata);
    expect(params[5]).toBe(documentInput.project);
    expect(params[6]).toBe(documentInput.created_by);
    expect(params[7]).toBe(documentInput.bank_id);
    expect(params[8]).toBe(documentInput.document_kind);
    expect(params[9]).toBe(documentInput.session_id);
    expect(params[10]).toBe(documentInput.task_id);
    expect(params[11]).toBe(documentInput.intent);
    expect(params[12]).toBe(documentInput.event_started_at);
    expect(params[13]).toBe(documentInput.event_ended_at);
  });

  it("uses the cipher key parameter consistently when inserting documents", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "doc-123",
        ...documentInput,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    await insertDocument(pool, documentInput);

    const sql = mockQuery.mock.calls[0]![0] as string;
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(sql).toContain("pgp_sym_encrypt($4, $15)");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $15)");
    expect(params).toHaveLength(15);
  });

  it("fetches active documents with decrypted content by id", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "doc-123", title: "Title", content: "body", metadata: {}, status: "active" }],
    });

    const result = await getDocument(pool, "doc-123");

    expect(result?.id).toBe("doc-123");
    expect(result?.content).toBe("body");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("pgp_sym_decrypt(content_enc");
    expect(sql).toContain("FROM documents");
    expect(sql).toContain("status != 'deleted'");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("doc-123");
  });

  it("lists document summaries with filters, pagination, and encrypted previews", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "doc-123",
        title: "One brain handoff",
        source_type: "markdown",
        source_uri: "file:///vault/handoff.md",
        content_preview: "Handoff preview",
        content_char_count: 128,
        metadata: { tags: ["one-brain"] },
        project: "one-brain",
        created_by: "hermes",
        bank_id: "openbrain",
        document_kind: "handoff",
        session_id: null,
        task_id: null,
        intent: "operational_log",
        event_started_at: null,
        event_ended_at: null,
        status: "active",
        chunk_count: 3,
        revision_count: 2,
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    const result = await listDocuments(pool, {
      project: "one-brain",
      source_type: "markdown",
      status: "active",
      q: "handoff",
      limit: 25,
      offset: 50,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.content_preview).toBe("Handoff preview");
    expect(result[0]!.chunk_count).toBe(3);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM documents d");
    expect(sql).toContain("pgp_sym_decrypt(d.content_enc");
    expect(sql).toContain("LEFT JOIN document_chunks");
    expect(sql).toContain("LEFT JOIN document_revisions");
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("OFFSET");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params).toContain("one-brain");
    expect(params).toContain("markdown");
    expect(params).toContain("active");
    expect(params).toContain("handoff");
    expect(params).toContain("%handoff%");
    expect(params).toContain(25);
    expect(params).toContain(50);
  });

  it("lists and fetches decrypted document revisions", async () => {
    const { pool, mockQuery } = createMockPool();
    const revision = {
      id: "rev-123",
      document_id: "doc-123",
      revision_number: 2,
      title: "Old title",
      source_uri: "file:///old.md",
      content: "Old body",
      metadata: { tags: ["old"] },
      status: "active",
      edit_reason: "manual correction",
      created_by: "ryan",
      created_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [revision] }).mockResolvedValueOnce({ rows: [revision] });

    const revisions = await listDocumentRevisions(pool, "doc-123");
    const fetched = await getDocumentRevision(pool, "doc-123", 2);

    expect(revisions[0]!.content).toBe("Old body");
    expect(fetched?.revision_number).toBe(2);
    const listSql = mockQuery.mock.calls[0]![0] as string;
    expect(listSql).toContain("FROM document_revisions");
    expect(listSql).toContain("pgp_sym_decrypt(content_enc");
    expect(listSql).toContain("ORDER BY revision_number DESC");
    const fetchSql = mockQuery.mock.calls[1]![0] as string;
    expect(fetchSql).toContain("revision_number = $2");
  });

  it("soft deletes documents without removing rows", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "doc-123" }], rowCount: 1 });

    const result = await deleteDocument(pool, "doc-123");

    expect(result).toEqual({ deleted: true, id: "doc-123" });
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("UPDATE documents");
    expect(sql).toContain("status = 'deleted'");
    expect(sql).not.toContain("DELETE FROM documents");
  });


  it("updates documents and records the prior version as a revision transactionally", async () => {
    const { pool, mockConnect } = createMockPool();
    const client = await mockConnect();
    const existing = {
      id: "doc-123",
      title: "Old title",
      content: "Old body",
      metadata: { tags: ["old"] },
      project: "proj",
      created_by: "ryan",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    const updated = { ...existing, title: "New title", content: "New body" };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ next_revision: 2 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [updated], rowCount: 1 })
      .mockResolvedValueOnce({});

    const result = await updateDocument(pool, "doc-123", {
      title: "New title",
      content: "New body",
      metadata: { tags: ["new"] },
      edit_reason: "correct extracted text",
      updated_by: "ryan",
    });

    expect(result.title).toBe("New title");
    expect(client.query.mock.calls[0]![0]).toBe("BEGIN");
    expect(client.query.mock.calls[1]![0] as string).toContain("FOR UPDATE");
    expect(client.query.mock.calls[3]![0] as string).toContain("INSERT INTO document_revisions");
    expect(client.query.mock.calls[4]![0] as string).toContain("UPDATE documents");
    expect(client.query.mock.calls[5]![0]).toBe("COMMIT");
  });

  it("binds contiguous parameters for document updates", async () => {
    const { pool, mockConnect } = createMockPool();
    const client = await mockConnect();
    const existing = {
      id: "doc-123",
      title: "Old title",
      source_uri: null,
      content: "Old body",
      metadata: {},
      project: "proj",
      created_by: "ryan",
      status: "active",
      created_at: new Date(),
      updated_at: new Date(),
    };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ next_revision: 1 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
      .mockResolvedValueOnce({});

    await updateDocument(pool, "doc-123", { content: "New body", updated_by: "ryan" });

    const updateSql = client.query.mock.calls[4]![0] as string;
    const updateParams = client.query.mock.calls[4]![1] as unknown[];
    expect(updateSql).not.toContain("$8");
    expect(updateSql).toContain("pgp_sym_encrypt($4, $7)");
    expect(updateSql).toContain("pgp_sym_decrypt(content_enc, $7)");
    expect(updateParams).toHaveLength(7);
  });


  it("replaces document chunks transactionally with encrypted content and embeddings", async () => {
    const { pool, mockConnect } = createMockPool();
    const client = await mockConnect();
    const chunkInputs: DocumentChunkInput[] = [
      {
        chunk_index: 0,
        content: "First chunk body",
        embedding: [0.1, 0.2, 0.3],
        metadata: { heading: "intro" },
        token_count: 3,
        char_start: 0,
        char_end: 16,
      },
      {
        chunk_index: 1,
        content: "Second chunk body",
        embedding: [0.4, 0.5, 0.6],
        metadata: { heading: "body" },
        token_count: 3,
        char_start: 17,
        char_end: 34,
      },
    ];
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: "chunk-0", document_id: "doc-123", ...chunkInputs[0], created_at: new Date(), updated_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [{ id: "chunk-1", document_id: "doc-123", ...chunkInputs[1], created_at: new Date(), updated_at: new Date() }] })
      .mockResolvedValueOnce({});

    const results = await replaceDocumentChunks(pool, "doc-123", chunkInputs);

    expect(results).toHaveLength(2);
    expect(client.query.mock.calls[0]![0]).toBe("BEGIN");
    expect(client.query.mock.calls[1]![0] as string).toContain("DELETE FROM document_chunks");
    expect(client.query.mock.calls[2]![0] as string).toContain("INSERT INTO document_chunks");
    expect(client.query.mock.calls[2]![0] as string).toContain("pgp_sym_encrypt($3, $9)");
    expect(client.query.mock.calls[2]![0] as string).toContain("pgp_sym_decrypt(content_enc, $9)");
    expect(client.query.mock.calls[2]![1]).toHaveLength(9);
    expect(client.query.mock.calls[4]![0]).toBe("COMMIT");
  });



  it("searches active document chunks by vector similarity with parent document metadata", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-0",
          document_id: "doc-123",
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
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const results = await searchDocumentChunks(pool, [0.1, 0.2, 0.3], {
      limit: 5,
      threshold: 0.3,
      project: "one-brain",
      source_type: "markdown",
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.document_title).toBe("One brain design");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM document_chunks c");
    expect(sql).toContain("JOIN documents d ON d.id = c.document_id");
    expect(sql).toContain("d.status = 'active'");
    expect(sql).toContain("1 - (c.embedding <=> $1::vector) AS similarity");
    expect(sql).toContain("ORDER BY c.embedding <=> $1::vector ASC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("[0.1,0.2,0.3]");
    expect(params[2]).toBe(5);
    expect(params[3]).toBe(0.3);
    expect(params[4]).toBe("one-brain");
    expect(params[5]).toBe("markdown");
  });



  it("supports hybrid document chunk search with FTS rank and combined score", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "chunk-0",
          document_id: "doc-123",
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
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const results = await searchDocumentChunks(pool, [0.1, 0.2, 0.3], {
      query: "OPENBRAIN_SEARCH_THRESHOLD",
      mode: "hybrid",
      limit: 5,
      threshold: 0.25,
      vector_weight: 0.75,
      fts_weight: 0.25,
    });

    expect(results[0]!.fts_rank).toBe(0.41);
    expect(results[0]!.score).toBe(0.6425);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("plainto_tsquery('english', $7)");
    expect(sql).toContain("ts_rank_cd(c.fts");
    expect(sql).toContain("AS fts_rank");
    expect(sql).toContain("AS score");
    expect(sql).toContain("ORDER BY score DESC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[6]).toBe("OPENBRAIN_SEARCH_THRESHOLD");
    expect(params[7]).toBe(0.75);
    expect(params[8]).toBe(0.25);
  });

  it("lists document chunks in chunk_index order with decrypted content", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: "chunk-0", document_id: "doc-123", chunk_index: 0, content: "First", metadata: {}, token_count: 1, char_start: 0, char_end: 5, created_at: new Date(), updated_at: new Date() },
      ],
    });

    const results = await listDocumentChunks(pool, "doc-123");

    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("First");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM document_chunks");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $2)");
    expect(sql).toContain("ORDER BY chunk_index ASC");
    expect(mockQuery.mock.calls[0]![1]).toHaveLength(2);
  });
});

// ─── Consolidated Observations ───────────────────────────────────────────────────

describe("consolidated observations", () => {
  const observationInput: ConsolidatedObservationInput = {
    content: "Consolidated note about one-brain direction.",
    embedding: [0.11, 0.22, 0.33],
    bank_id: "openbrain",
    proof_count: 2,
    source_memory_ids: [
      "a1b2c3d4-1234-5678-9abc-def012345678",
      "11111111-2222-3333-4444-555555555555",
    ],
    source_quotes: {
      "a1b2c3d4-1234-5678-9abc-def012345678": "first quote",
      "11111111-2222-3333-4444-555555555555": "second quote",
    },
    tags: ["strategy", "one-brain"],
    history: [],
    trend: "stable",
    trend_computed_at: "2026-06-15T00:00:00Z",
    project: "one-brain",
    created_by: "ryan",
  };

  it("inserts observations with encrypted content and evidence metadata", async () => {
    const { pool, mockQuery } = createMockPool();
    const row = {
      id: "obs-123",
      bank_id: observationInput.bank_id,
      content: observationInput.content,
      proof_count: observationInput.proof_count,
      source_memory_ids: observationInput.source_memory_ids,
      source_quotes: {},
      tags: observationInput.tags,
      history: observationInput.history,
      trend: observationInput.trend,
      trend_computed_at: new Date("2026-06-15T00:00:00Z"),
      project: observationInput.project,
      created_by: observationInput.created_by,
      archived: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const result = await insertConsolidatedObservation(pool, observationInput);

    expect(result.id).toBe("obs-123");
    expect(result.content).toBe(observationInput.content);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO consolidated_observations");
    expect(sql).toContain("pgp_sym_encrypt($2, $12)");
    expect(sql).toContain("source_memory_ids");
    expect(sql).toContain("source_quotes");
    expect(sql).toContain("proof_count");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(observationInput.bank_id);
    expect(params[1]).toBe(observationInput.content);
    expect(params[2]).toBe("[0.11,0.22,0.33]");
    expect(params[3]).toBe(observationInput.proof_count);
    expect(params[4]).toEqual(observationInput.source_memory_ids);
    expect(params[5]).toEqual(JSON.stringify(observationInput.source_quotes ?? {}));
  });

  it("fetches observations by id with decrypted content", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "obs-123",
        bank_id: "openbrain",
        content: "Consolidated note",
        proof_count: 2,
        source_memory_ids: [],
        source_quotes: {},
        tags: [],
        history: [],
        trend: "stable",
        trend_computed_at: null,
        project: "one-brain",
        created_by: "ryan",
        archived: false,
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    const result = await getConsolidatedObservation(pool, "obs-123");

    expect(result?.id).toBe("obs-123");
    expect(result?.content).toBe("Consolidated note");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM consolidated_observations");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $2)");
  });

  it("searches active observations by vector similarity with bank/project filters", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "obs-123",
        bank_id: "openbrain",
        content: "Consolidated note",
        proof_count: 2,
        source_memory_ids: [],
        source_quotes: {},
        tags: [],
        history: [],
        trend: "stable",
        trend_computed_at: null,
        project: "one-brain",
        created_by: "ryan",
        archived: false,
        similarity: 0.88,
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    const results = await searchConsolidatedObservations(pool, [0.1, 0.2, 0.3], {
      bank_id: "openbrain",
      project: "one-brain",
      created_by: "ryan",
      limit: 5,
      threshold: 0.4,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.similarity).toBe(0.88);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM consolidated_observations");
    expect(sql).toContain("archived = false");
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS similarity");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("[0.1,0.2,0.3]");
    expect(params[2]).toBe(5);
    expect(params[3]).toBe(0.4);
    expect(params[4]).toBe("openbrain");
    expect(params[5]).toBe("one-brain");
    expect(params[6]).toBe("ryan");
  });

  it("updates observations while appending prior state to history", async () => {
    const { pool, mockConnect } = createMockPool();
    const client = await mockConnect();
    const existing = {
      id: "obs-123",
      bank_id: "openbrain",
      content: "Old observation",
      proof_count: 1,
      source_memory_ids: ["a1b2c3d4-1234-5678-9abc-def012345678"],
      source_quotes: { "a1b2c3d4-1234-5678-9abc-def012345678": "old quote" },
      tags: ["old"],
      history: [],
      trend: "stable",
      trend_computed_at: null,
      project: "one-brain",
      created_by: "ryan",
      archived: false,
      created_at: new Date(),
      updated_at: new Date("2026-06-15T00:00:00Z"),
    };
    const updated = {
      ...existing,
      content: "New observation",
      proof_count: 2,
      source_memory_ids: [
        "a1b2c3d4-1234-5678-9abc-def012345678",
        "11111111-2222-3333-4444-555555555555",
      ],
      source_quotes: { "11111111-2222-3333-4444-555555555555": "new quote" },
      tags: ["new"],
      history: [{ previous_content: "Old observation", edit_reason: "refresh" }],
    };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [updated], rowCount: 1 })
      .mockResolvedValueOnce({});

    const result = await updateConsolidatedObservation(pool, "obs-123", {
      content: "New observation",
      embedding: [0.9, 0.8, 0.7],
      proof_count: 2,
      source_memory_ids: updated.source_memory_ids,
      source_quotes: updated.source_quotes,
      tags: ["new"],
      edit_reason: "refresh",
    });

    expect(result.content).toBe("New observation");
    expect(client.query.mock.calls[0]![0]).toBe("BEGIN");
    expect(client.query.mock.calls[1]![0] as string).toContain("FOR UPDATE");
    const updateSql = client.query.mock.calls[2]![0] as string;
    expect(updateSql).toContain("UPDATE consolidated_observations");
    expect(updateSql).toContain("source_quotes = $6::jsonb");
    expect(updateSql).toContain(`source_memory_ids,
                 source_quotes,`);
    expect(client.query.mock.calls[3]![0]).toBe("COMMIT");
    const updateParams = client.query.mock.calls[2]![1] as unknown[];
    expect(updateParams[3]).toBe(2);
    expect(updateParams[4]).toEqual(updated.source_memory_ids);
    expect(updateParams[5]).toEqual(JSON.stringify(updated.source_quotes));
    expect(result.source_quotes).toEqual(updated.source_quotes);
  });
});


// ─── Mental Models ────────────────────────────────────────────────────

describe("mental models", () => {
  const createdAt = new Date("2026-06-15T00:00:00Z");
  const mentalModelInput: MentalModelInput = {
    bank_id: "openbrain",
    name: "One Brain direction",
    query: "What is the one-brain architecture direction?",
    content: "OpenBrain is canonical; Markdown is transitional UI/archive.",
    embedding: [0.1, 0.2, 0.3],
    structured: { stance: "database-first" },
    tags: ["one-brain"],
    trigger_tags: ["architecture"],
    priority: 7,
    refresh_meta: { source: "manual" },
    history: [{ reason: "seed" }],
    active: true,
    project: "one-brain",
    created_by: "hermes",
  };
  const mentalModelRow = {
    id: "model-123",
    ...mentalModelInput,
    created_at: createdAt,
    updated_at: createdAt,
  };

  it("inserts encrypted mental models with canonical query and trigger metadata", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [mentalModelRow] });

    const result = await insertMentalModel(pool, mentalModelInput);

    expect(result.id).toBe("model-123");
    expect(result.content).toBe(mentalModelInput.content);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO mental_models");
    expect(sql).toContain("pgp_sym_encrypt($4, $15)");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $15)");
    expect(sql).toContain("to_tsvector('english', $2 || ' ' || $3 || ' ' || $4)");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(params[1]).toBe(mentalModelInput.name);
    expect(params[2]).toBe(mentalModelInput.query);
    expect(params[3]).toBe(mentalModelInput.content);
    expect(params[4]).toBe("[0.1,0.2,0.3]");
    expect(JSON.parse(params[5] as string)).toEqual(mentalModelInput.structured);
    expect(JSON.parse(params[7] as string)).toEqual(mentalModelInput.trigger_tags);
    expect(params).toHaveLength(15);
  });

  it("fetches and lists mental models while filtering inactive rows by default", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [mentalModelRow] });
    mockQuery.mockResolvedValueOnce({ rows: [mentalModelRow] });

    const byId = await getMentalModel(pool, "a1b2c3d4-1234-5678-9abc-def012345678");
    const listed = await listMentalModels(pool, {
      bank_id: "openbrain",
      project: "one-brain",
      trigger_tag: "architecture",
      limit: 5,
    });

    expect(byId?.content).toBe(mentalModelInput.content);
    expect(listed).toHaveLength(1);
    const getSql = mockQuery.mock.calls[0]![0] as string;
    const listSql = mockQuery.mock.calls[1]![0] as string;
    expect(getSql).toContain("FROM mental_models");
    expect(getSql).toContain("pgp_sym_decrypt(content_enc");
    expect(listSql).toContain("active = true");
    expect(listSql).toContain("trigger_tags ? $");
    expect(listSql).toContain("ORDER BY priority DESC, updated_at DESC");
  });

  it("searches active mental models by vector with project and threshold filters", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...mentalModelRow, similarity: 0.88 }] });

    const results = await searchMentalModels(pool, [0.1, 0.2, 0.3], {
      bank_id: "openbrain",
      project: "one-brain",
      threshold: 0.3,
      limit: 3,
    });

    expect(results[0]!.similarity).toBe(0.88);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS similarity");
    expect(sql).toContain("active = true");
    expect(sql).toContain("ORDER BY embedding <=> $1::vector ASC, priority DESC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("[0.1,0.2,0.3]");
    expect(params).toContain("openbrain");
    expect(params).toContain("one-brain");
  });

  it("updates mental model content and can deactivate rows for cleanup", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...mentalModelRow, content: "Updated model", active: false }], rowCount: 1 });

    const result = await updateMentalModel(pool, "a1b2c3d4-1234-5678-9abc-def012345678", {
      content: "Updated model",
      embedding: [0.9, 0.8, 0.7],
      active: false,
      refresh_meta: { refreshed_by: "smoke" },
    });

    expect(result.content).toBe("Updated model");
    expect(result.active).toBe(false);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("UPDATE mental_models");
    expect(sql).toContain("content_enc = pgp_sym_encrypt");
    expect(sql).toContain("active = COALESCE($12::boolean, active)");
    expect(sql).toContain("RETURNING id, bank_id, name, query");
  });
});


// ─── Experiences ─────────────────────────────────────────────────────

describe("experiences", () => {
  const createdAt = new Date("2026-06-15T00:00:00Z");
  const experienceInput: ExperienceInput = {
    bank_id: "openbrain",
    session_id: "session-slice-d",
    agent_id: "hermes",
    occurred_at: "2026-06-15T00:00:00Z",
    event_type: "tool_call",
    content: "Ran a live consolidation smoke and archived the temporary observation.",
    embedding: [0.1, 0.2, 0.3],
    refs: { consolidation_jobs: ["c51282a0-a8ba-4ff7-bcd7-55b74bf991e6"] },
    project: "one-brain",
    created_by: "hermes",
  };
  const experienceRow = {
    id: "exp-123",
    ...experienceInput,
    occurred_at: createdAt,
    created_at: createdAt,
  };

  it("inserts encrypted first-class experience events with provenance refs", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [experienceRow] });

    const result = await insertExperience(pool, experienceInput);

    expect(result.id).toBe("exp-123");
    expect(result.content).toBe(experienceInput.content);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO experiences");
    expect(sql).toContain("pgp_sym_encrypt($6, $11)");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $11)");
    expect(sql).toContain("to_tsvector('english', $6)");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(params[1]).toBe("session-slice-d");
    expect(params[4]).toBe("tool_call");
    expect(params[5]).toBe(experienceInput.content);
    expect(params[6]).toBe("[0.1,0.2,0.3]");
    expect(JSON.parse(params[7] as string)).toEqual(experienceInput.refs);
    expect(params).toHaveLength(11);
  });

  it("fetches experiences by id with decrypted content", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [experienceRow] });

    const result = await getExperience(pool, "a1b2c3d4-1234-5678-9abc-def012345678");

    expect(result?.content).toBe(experienceInput.content);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM experiences");
    expect(sql).toContain("pgp_sym_decrypt(content_enc");
    expect(mockQuery.mock.calls[0]![1][0]).toBe("a1b2c3d4-1234-5678-9abc-def012345678");
  });

  it("lists experiences filtered by session_id and event_type", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [experienceRow] });

    const results = await listExperiences(pool, {
      bank_id: "openbrain",
      session_id: "session-slice-d",
      event_type: "tool_call",
      project: "one-brain",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM experiences");
    expect(sql).toContain("session_id = $");
    expect(sql).toContain("event_type = $");
    expect(sql).toContain("ORDER BY occurred_at DESC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params).toContain("session-slice-d");
    expect(params).toContain("tool_call");
  });

  it("searches experiences by vector with event filters", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...experienceRow, similarity: 0.82 }] });

    const results = await searchExperiences(pool, [0.1, 0.2, 0.3], {
      bank_id: "openbrain",
      session_id: "session-slice-d",
      event_type: "tool_call",
      threshold: 0.3,
      limit: 3,
    });

    expect(results[0]!.similarity).toBe(0.82);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("1 - (embedding <=> $1::vector) AS similarity");
    expect(sql).toContain("ORDER BY embedding <=> $1::vector ASC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("[0.1,0.2,0.3]");
    expect(params).toContain("session-slice-d");
    expect(params).toContain("tool_call");
  });
});


// ─── Memory Links ────────────────────────────────────────────────────

describe("memory links", () => {
  const createdAt = new Date("2026-06-15T00:00:00Z");
  const linkInput: MemoryLinkInput = {
    bank_id: "openbrain",
    source_type: "experience",
    source_id: "22222222-2222-4222-8222-222222222222",
    target_type: "experience",
    target_id: "11111111-1111-4111-8111-111111111111",
    relationship: "temporal_after",
    weight: 1,
    inferred: true,
  };
  const linkRow = {
    id: "link-123",
    ...linkInput,
    created_at: createdAt,
  };

  it("upserts deterministic memory links by edge identity", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [linkRow] });

    const result = await insertMemoryLink(pool, linkInput);

    expect(result.id).toBe("link-123");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO memory_links");
    expect(sql).toContain("ON CONFLICT (source_type, source_id, target_type, target_id, relationship)");
    expect(sql).toContain("RETURNING id, source_type, source_id, target_type, target_id, relationship");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(params[1]).toBe("experience");
    expect(params[3]).toBe("experience");
    expect(params[5]).toBe("temporal_after");
  });

  it("fetches and lists memory links with source/target filters", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [linkRow] });
    mockQuery.mockResolvedValueOnce({ rows: [linkRow] });

    const byId = await getMemoryLink(pool, "a1b2c3d4-1234-5678-9abc-def012345678");
    const listed = await listMemoryLinks(pool, {
      bank_id: "openbrain",
      source_type: "experience",
      source_id: linkInput.source_id,
      relationship: "temporal_after",
      limit: 5,
    });

    expect(byId?.id).toBe("link-123");
    expect(listed).toHaveLength(1);
    const getSql = mockQuery.mock.calls[0]![0] as string;
    const listSql = mockQuery.mock.calls[1]![0] as string;
    expect(getSql).toContain("FROM memory_links");
    expect(listSql).toContain("source_type = $");
    expect(listSql).toContain("source_id = $");
    expect(listSql).toContain("relationship = $");
    expect(listSql).toContain("ORDER BY created_at DESC");
  });

  it("expands direct linked memories from explicit seed nodes", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...linkRow,
          seed_type: "experience",
          seed_id: linkInput.source_id,
          direction: "outgoing",
          linked_type: "experience",
          linked_id: linkInput.target_id,
          linked_content: "Earlier experience content",
          linked_title: null,
          linked_metadata: { event_type: "user_message" },
          linked_project: "one-brain",
          linked_created_at: createdAt,
        },
      ],
    });

    const results = await expandMemoryLinks(pool, {
      bank_id: "openbrain",
      seeds: [{ source_type: "experience", source_id: linkInput.source_id }],
      direction: "outgoing",
      relationship: "temporal_after",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.linked_content).toBe("Earlier experience content");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("jsonb_to_recordset");
    expect(sql).toContain("candidate_links");
    expect(sql).toContain("pgp_sym_decrypt(t.content_enc");
    expect(sql).toContain("pgp_sym_decrypt(e.content_enc");
    expect(sql).toContain("relationship = $");
    expect(sql).toContain("ORDER BY cl.created_at DESC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(JSON.parse(params[1] as string)).toEqual([{ source_type: "experience", source_id: linkInput.source_id }]);
    expect(params).toContain("temporal_after");
  });

  it("infers temporal_after links between adjacent experiences in the same session", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [linkRow] });

    const results = await inferExperienceTemporalLinks(pool, {
      bank_id: "openbrain",
      session_id: "slice-e-smoke",
    });

    expect(results).toHaveLength(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("WITH ordered_experiences AS");
    expect(sql).toContain("LAG(id) OVER");
    expect(sql).toContain("temporal_after");
    expect(sql).toContain("ON CONFLICT (source_type, source_id, target_type, target_id, relationship)");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params).toContain("openbrain");
    expect(params).toContain("slice-e-smoke");
  });

  it("infers supersedes links from explicit thought supersession metadata", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...linkRow, source_type: "thought", target_type: "thought", relationship: "supersedes" }] });

    const results = await inferSupersedesMemoryLinks(pool, { bank_id: "openbrain" });

    expect(results[0]!.relationship).toBe("supersedes");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM thoughts");
    expect(sql).toContain("supersedes IS NOT NULL");
    expect(sql).toContain("'supersedes'");
    expect(sql).toContain("ON CONFLICT (source_type, source_id, target_type, target_id, relationship)");
  });

  it("infers evidence_for links from experience refs to consolidated observations", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...linkRow, target_type: "consolidated_observation", relationship: "evidence_for" }] });

    const results = await inferExperienceReferenceLinks(pool, {
      bank_id: "openbrain",
      session_id: "slice-e-smoke",
    });

    expect(results[0]!.relationship).toBe("evidence_for");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("jsonb_array_elements_text");
    expect(sql).toContain("refs->'consolidated_observations'");
    expect(sql).toContain("consolidated_observation");
    expect(sql).toContain("evidence_for");
  });
});


// ─── Temporal Recall ─────────────────────────────────────────────────

describe("recallTemporalMemories", () => {
  it("queries explicit temporal windows across experiences, thoughts, and documents", async () => {
    const { pool, mockQuery } = createMockPool();
    const createdAt = new Date("2026-06-15T16:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          source_type: "experience",
          id: "66666666-6666-4666-8666-666666666666",
          content: "Temporal experience content",
          title: null,
          metadata: { event_type: "assistant_message" },
          project: "one-brain",
          event_at: createdAt,
          event_started_at: createdAt,
          event_ended_at: createdAt,
          created_at: createdAt,
          temporal_score: 1,
        },
      ],
    });

    const results = await recallTemporalMemories(pool, {
      bank_id: "openbrain",
      project: "one-brain",
      created_by: "hermes-smoke",
      time_start: "2026-06-15T15:00:00Z",
      time_end: "2026-06-15T17:00:00Z",
      include_archived: false,
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.source_type).toBe("experience");
    expect(results[0]!.temporal_score).toBe(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("temporal_candidates");
    expect(sql).toContain("FROM experiences e");
    expect(sql).toContain("FROM thoughts t");
    expect(sql).toContain("FROM documents d");
    expect(sql).toContain("pgp_sym_decrypt(e.content_enc");
    expect(sql).toContain("pgp_sym_decrypt(t.content_enc");
    expect(sql).toContain("pgp_sym_decrypt(d.content_enc");
    expect(sql).toContain("ORDER BY temporal_score DESC");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(params[2]).toBe("2026-06-15T15:00:00Z");
    expect(params[3]).toBe("2026-06-15T17:00:00Z");
    expect(params[4]).toBe("one-brain");
    expect(params[5]).toBe("hermes-smoke");
    expect(params[6]).toBe(false);
    expect(params[7]).toBe(5);
  });
});


// ─── Memory Bank Context ─────────────────────────────────────────────

describe("memory bank directive context", () => {
  it("loads active reflect directives ordered by priority with the bank mission", async () => {
    const { pool, mockQuery } = createMockPool();
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "openbrain",
          name: "OpenBrain",
          mission: "Durable, evidence-grounded memory.",
          disposition: { skepticism: 4 },
          project: null,
          directive_id: "741a9339-ceb3-468b-81ac-616567382122",
          directive_name: "no_pii_verbatim",
          directive_rule_text: "Never store patient identifiers verbatim.",
          directive_applies_to: ["reflect", "retain"],
          directive_severity: "hard",
          directive_priority: 100,
          directive_revision: 1,
          directive_created_at: createdAt,
          directive_updated_at: createdAt,
        },
        {
          id: "openbrain",
          name: "OpenBrain",
          mission: "Durable, evidence-grounded memory.",
          disposition: { skepticism: 4 },
          project: null,
          directive_id: "06e1de99-502b-4865-b1e2-87c8adf01853",
          directive_name: "no_fact_averaging",
          directive_rule_text: "Do not average conflicting facts.",
          directive_applies_to: ["reflect"],
          directive_severity: "hard",
          directive_priority: 90,
          directive_revision: 1,
          directive_created_at: createdAt,
          directive_updated_at: createdAt,
        },
      ],
    });

    const context = await getMemoryBankContext(pool, "openbrain", "reflect");

    expect(context?.id).toBe("openbrain");
    expect(context?.mission).toContain("evidence-grounded");
    expect(context?.directives.map((d) => d.name)).toEqual(["no_pii_verbatim", "no_fact_averaging"]);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM memory_banks");
    expect(sql).toContain("LEFT JOIN directives");
    expect(sql).toContain("ORDER BY d.priority DESC");
    expect(mockQuery.mock.calls[0]![1]).toEqual(["openbrain", "reflect"]);
  });
});


// ─── Consolidation Jobs ─────────────────────────────────────────────

describe("consolidation jobs", () => {
  const createdAt = new Date("2026-06-15T00:00:00Z");
  const jobRow = {
    id: "job-123",
    bank_id: "openbrain",
    job_type: "observe_thoughts",
    status: "queued",
    input: {
      thought_ids: [
        "a1b2c3d4-1234-5678-9abc-def012345678",
        "11111111-2222-3333-4444-555555555555",
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
  };

  it("enqueues explicit observe_thoughts jobs", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [jobRow] });

    const result = await enqueueConsolidationJob(pool, {
      job_type: "observe_thoughts",
      bank_id: "openbrain",
      input: jobRow.input,
    });

    expect(result.id).toBe("job-123");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("INSERT INTO consolidation_jobs");
    expect(sql).toContain("job_type");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe("openbrain");
    expect(params[1]).toBe("observe_thoughts");
    expect(JSON.parse(params[2] as string).thought_ids).toHaveLength(2);
  });

  it("fetches consolidation jobs by id", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [jobRow] });

    const result = await getConsolidationJob(pool, "job-123");

    expect(result?.status).toBe("queued");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("FROM consolidation_jobs");
    expect(mockQuery.mock.calls[0]![1]).toEqual(["job-123"]);
  });

  it("marks queued jobs running and increments attempts", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...jobRow, status: "running", attempts: 1 }] });

    const result = await startConsolidationJob(pool, "job-123");

    expect(result?.status).toBe("running");
    expect(result?.attempts).toBe(1);
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("attempts = attempts + 1");
    expect(sql).toContain("WHERE id = $1 AND status IN ('queued', 'error')");
  });

  it("marks jobs success with deterministic output", async () => {
    const { pool, mockQuery } = createMockPool();
    const output = { observation_id: "obs-123", source_count: 2 };
    mockQuery.mockResolvedValueOnce({ rows: [{ ...jobRow, status: "success", output }] });

    const result = await completeConsolidationJob(pool, "job-123", output);

    expect(result.status).toBe("success");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'success'");
    expect(sql).toContain("finished_at = now()");
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe(JSON.stringify(output));
  });

  it("marks jobs error with message and output envelope", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [{ ...jobRow, status: "error", error: "missing sources", output: { source_count: 0 } }] });

    const result = await failConsolidationJob(pool, "job-123", "missing sources", { source_count: 0 });

    expect(result.status).toBe("error");
    expect(result.error).toBe("missing sources");
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'error'");
    expect(sql).toContain("error = $2");
  });
});

describe("claimNextQueuedJob", () => {
  const claimedRow = {
    id: "job-claim-1",
    bank_id: "openbrain",
    job_type: "observe_thoughts",
    status: "running",
    input: { thought_ids: ["t1", "t2"] },
    output: null,
    error: null,
    started_at: new Date("2026-06-18T00:00:00Z"),
    finished_at: null,
    attempts: 1,
    created_at: new Date("2026-06-17T00:00:00Z"),
  };

  it("claims a queued job via SELECT FOR UPDATE SKIP LOCKED and updates status to running", async () => {
    const { pool, mockConnect, mockRelease } = createMockPool();
    const clientQuery = vi.fn();
    // Sequence: BEGIN → SELECT FOR UPDATE SKIP LOCKED → UPDATE → COMMIT
    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "job-claim-1", status: "queued" }] }); // SELECT
    clientQuery.mockResolvedValueOnce({ rows: [claimedRow] }); // UPDATE
    clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockConnect.mockResolvedValue({ query: clientQuery, release: mockRelease });

    const result = await claimNextQueuedJob(pool);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("running");
    expect(result!.attempts).toBe(1);
    // call 0 = BEGIN, call 1 = SELECT, call 2 = UPDATE, call 3 = COMMIT
    const selectSql = clientQuery.mock.calls[1]![0] as string;
    expect(selectSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(selectSql).toContain("WHERE status = 'queued'");
    const updateSql = clientQuery.mock.calls[2]![0] as string;
    expect(updateSql).toContain("SET status = 'running'");
    expect(updateSql).toContain("attempts = attempts + 1");
    // verify client was released
    expect(mockRelease).toHaveBeenCalled();
  });

  it("returns null when no queued jobs exist", async () => {
    const { pool, mockConnect, mockRelease } = createMockPool();
    const clientQuery = vi.fn();
    // Sequence: BEGIN → SELECT (empty) → ROLLBACK
    clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT (no rows)
    clientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    mockConnect.mockResolvedValue({ query: clientQuery, release: mockRelease });

    const result = await claimNextQueuedJob(pool);

    expect(result).toBeNull();
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe("findConsolidationCandidates", () => {
  it("returns groups of unconsolidated thoughts by project", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { project: "test-project", thought_ids: ["id-1", "id-2", "id-3"] },
        { project: "", thought_ids: ["id-4", "id-5"] },
      ],
    });

    const result = await findConsolidationCandidates(pool);

    expect(result).toHaveLength(2);
    expect(result[0]!.project).toBe("test-project");
    expect(result[0]!.thought_ids).toHaveLength(3);
    expect(result[0]!.bank_id).toBe("openbrain");
    // Empty project becomes null
    expect(result[1]!.project).toBeNull();
    const sql = mockQuery.mock.calls[0]![0] as string;
    expect(sql).toContain("unconsolidated");
    expect(sql).toContain("NOT EXISTS");
  });

  it("returns empty array when no candidates exist", async () => {
    const { pool, mockQuery } = createMockPool();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await findConsolidationCandidates(pool);

    expect(result).toEqual([]);
  });
});
