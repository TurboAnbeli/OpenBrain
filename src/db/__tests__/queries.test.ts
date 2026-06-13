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
  getDocument,
  updateDocument,
  replaceDocumentChunks,
  listDocumentChunks,
  searchDocumentChunks,
  type ThoughtMetadata,
  type DocumentInput,
  type DocumentChunkInput,
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
    const params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(params[0]).toBe(documentInput.title);
    expect(params[1]).toBe(documentInput.source_type);
    expect(params[2]).toBe(documentInput.source_uri);
    expect(params[3]).toBe(documentInput.content);
    expect(JSON.parse(params[4] as string)).toEqual(documentInput.metadata);
    expect(params[5]).toBe(documentInput.project);
    expect(params[6]).toBe(documentInput.created_by);
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
    expect(sql).toContain("pgp_sym_encrypt($4, $8)");
    expect(sql).toContain("pgp_sym_decrypt(content_enc, $8)");
    expect(params).toHaveLength(8);
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
