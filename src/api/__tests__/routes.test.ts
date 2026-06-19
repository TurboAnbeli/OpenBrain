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
const mockExtractAndLinkChunkEntities = vi.fn().mockResolvedValue(undefined);
const mockInsertDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockGetDocument = vi.fn();
const mockGetDocumentBySourceUri = vi.fn();
const mockUpdateDocument = vi.fn();
const mockUpdateDocumentWithChunks = vi.fn();
const mockListDocumentRevisions = vi.fn();
const mockGetDocumentRevision = vi.fn();
const mockDeleteDocument = vi.fn();
const mockReplaceDocumentChunks = vi.fn();
const mockListDocumentChunks = vi.fn();
const mockSearchDocumentChunks = vi.fn();
const mockSearchDocumentChunksByEntity = vi.fn().mockResolvedValue([]);
const mockInsertConsolidatedObservation = vi.fn();
const mockGetConsolidatedObservation = vi.fn();
const mockSearchConsolidatedObservations = vi.fn();
const mockUpdateConsolidatedObservation = vi.fn();
const mockInsertMentalModel = vi.fn();
const mockGetMentalModel = vi.fn();
const mockListMentalModels = vi.fn();
const mockSearchMentalModels = vi.fn();
const mockUpdateMentalModel = vi.fn();
const mockEnqueueConsolidationJob = vi.fn();
const mockGetConsolidationJob = vi.fn();
const mockInsertExperience = vi.fn();
const mockGetExperience = vi.fn();
const mockListExperiences = vi.fn();
const mockSearchExperiences = vi.fn();
const mockInsertRecallRoutingTelemetry = vi.fn();
const mockGetMemoryBankContext = vi.fn().mockResolvedValue({ id: "openbrain", name: "OpenBrain", mission: null, disposition: {}, directives: [] });
const mockInsertMemoryLink = vi.fn();
const mockGetMemoryLink = vi.fn();
const mockListMemoryLinks = vi.fn();
const mockExpandMemoryLinks = vi.fn();
const mockRecallTemporalMemories = vi.fn();
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
  extractAndLinkChunkEntities: (...args: any[]) => mockExtractAndLinkChunkEntities(...args),
  insertDocument: (...args: any[]) => mockInsertDocument(...args),
  listDocuments: (...args: any[]) => mockListDocuments(...args),
  getDocument: (...args: any[]) => mockGetDocument(...args),
  getDocumentBySourceUri: (...args: any[]) => mockGetDocumentBySourceUri(...args),
  updateDocument: (...args: any[]) => mockUpdateDocument(...args),
  updateDocumentWithChunks: (...args: any[]) => mockUpdateDocumentWithChunks(...args),
  listDocumentRevisions: (...args: any[]) => mockListDocumentRevisions(...args),
  getDocumentRevision: (...args: any[]) => mockGetDocumentRevision(...args),
  deleteDocument: (...args: any[]) => mockDeleteDocument(...args),
  replaceDocumentChunks: (...args: any[]) => mockReplaceDocumentChunks(...args),
  listDocumentChunks: (...args: any[]) => mockListDocumentChunks(...args),
  searchDocumentChunks: (...args: any[]) => mockSearchDocumentChunks(...args),
  searchDocumentChunksByEntity: (...args: any[]) => mockSearchDocumentChunksByEntity(...args),
  insertConsolidatedObservation: (...args: any[]) => mockInsertConsolidatedObservation(...args),
  getConsolidatedObservation: (...args: any[]) => mockGetConsolidatedObservation(...args),
  searchConsolidatedObservations: (...args: any[]) => mockSearchConsolidatedObservations(...args),
  updateConsolidatedObservation: (...args: any[]) => mockUpdateConsolidatedObservation(...args),
  insertMentalModel: (...args: any[]) => mockInsertMentalModel(...args),
  getMentalModel: (...args: any[]) => mockGetMentalModel(...args),
  listMentalModels: (...args: any[]) => mockListMentalModels(...args),
  searchMentalModels: (...args: any[]) => mockSearchMentalModels(...args),
  updateMentalModel: (...args: any[]) => mockUpdateMentalModel(...args),
  enqueueConsolidationJob: (...args: any[]) => mockEnqueueConsolidationJob(...args),
  getConsolidationJob: (...args: any[]) => mockGetConsolidationJob(...args),
  insertExperience: (...args: any[]) => mockInsertExperience(...args),
  getExperience: (...args: any[]) => mockGetExperience(...args),
  listExperiences: (...args: any[]) => mockListExperiences(...args),
  searchExperiences: (...args: any[]) => mockSearchExperiences(...args),
  insertRecallRoutingTelemetry: (...args: any[]) => mockInsertRecallRoutingTelemetry(...args),
  getMemoryBankContext: (...args: any[]) => mockGetMemoryBankContext(...args),
  insertMemoryLink: (...args: any[]) => mockInsertMemoryLink(...args),
  getMemoryLink: (...args: any[]) => mockGetMemoryLink(...args),
  listMemoryLinks: (...args: any[]) => mockListMemoryLinks(...args),
  expandMemoryLinks: (...args: any[]) => mockExpandMemoryLinks(...args),
  recallTemporalMemories: (...args: any[]) => mockRecallTemporalMemories(...args),
  inferExperienceTemporalLinks: (...args: any[]) => mockInferExperienceTemporalLinks(...args),
  inferSupersedesMemoryLinks: (...args: any[]) => mockInferSupersedesMemoryLinks(...args),
  inferExperienceReferenceLinks: (...args: any[]) => mockInferExperienceReferenceLinks(...args),
}));

const mockReflectAnswer = vi.fn();
vi.mock("../reflect.js", () => ({
  reflectAnswer: (...args: any[]) => mockReflectAnswer(...args),
}));

vi.mock("../../jobs/consolidation.js", () => ({
  runConsolidationJob: (...args: any[]) => mockRunConsolidationJob(...args),
}));

import { createApi } from "../routes.js";

describe("REST API Routes", () => {
  const app = createApi();

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertRecallRoutingTelemetry.mockResolvedValue({
      id: "tel-123",
      bank_id: "openbrain",
      occurred_at: new Date(),
      source_router: "heuristic",
      route: "document_only",
      source_balance: "score",
      source_types: ["document_chunk"],
      confidence: 0.85,
      reasons: [],
      project: null,
      created_by: null,
    });
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
      id: "22222222-2222-4222-8222-222222222222",
      content: "test",
      metadata: { type: "decision" },
      project: "plan-forge",
      created_at: new Date(),
    });
    mockInsertMemoryLink.mockResolvedValueOnce({
      id: "link-123",
      bank_id: "openbrain",
      source_type: "thought",
      source_id: "22222222-2222-4222-8222-222222222222",
      target_type: "thought",
      target_id: "a1b2c3d4-1234-5678-9abc-def012345678",
      relationship: "supersedes",
      weight: 1,
      inferred: true,
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
    expect(mockInsertMemoryLink).toHaveBeenCalledWith(expect.anything(), {
      bank_id: "openbrain",
      source_type: "thought",
      source_id: "22222222-2222-4222-8222-222222222222",
      target_type: "thought",
      target_id: "a1b2c3d4-1234-5678-9abc-def012345678",
      relationship: "supersedes",
      weight: 1,
      inferred: true,
    });
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


  // ─── POST /recall ──────────────────────────────────────────────────

  it("POST /recall returns unified recall results with lane scores and explicit link expansion", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        content: "Semantic thought content",
        metadata: { type: "decision" },
        project: "one-brain",
        proof_count: 2,
        similarity: 0.82,
        created_at: createdAt,
      },
    ]);
    mockBm25SearchThoughts.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        content: "Semantic thought content",
        metadata: { type: "decision" },
        project: "one-brain",
        proof_count: 2,
        similarity: 0.41,
        created_at: createdAt,
      },
    ]);
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333333",
        document_id: "44444444-4444-4444-8444-444444444444",
        document_title: "One brain design",
        document_source_type: "agent-note",
        document_source_uri: "file:///note.md",
        project: "one-brain",
        chunk_index: 0,
        content: "Document chunk content",
        metadata: { section: "recall" },
        similarity: 0.77,
        fts_rank: 0.2,
        score: 0.63,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);
    mockSearchConsolidatedObservations.mockResolvedValueOnce([
      {
        id: "55555555-5555-4555-8555-555555555555",
        bank_id: "openbrain",
        content: "Observation content",
        proof_count: 3,
        source_memory_ids: ["11111111-1111-4111-8111-111111111111"],
        source_quotes: {},
        tags: ["recall"],
        history: [],
        trend: "stable",
        project: "one-brain",
        archived: false,
        similarity: 0.72,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);
    mockSearchExperiences.mockResolvedValueOnce([
      {
        id: "66666666-6666-4666-8666-666666666666",
        bank_id: "openbrain",
        session_id: "slice-h",
        agent_id: "hermes",
        occurred_at: createdAt,
        event_type: "tool_call",
        content: "Experience content",
        refs: { temporary: true },
        project: "one-brain",
        created_by: "hermes",
        similarity: 0.66,
        created_at: createdAt,
      },
    ]);
    mockExpandMemoryLinks.mockResolvedValueOnce([
      {
        id: "link-123",
        bank_id: "openbrain",
        source_type: "experience",
        source_id: "22222222-2222-4222-8222-222222222222",
        target_type: "experience",
        target_id: "77777777-7777-4777-8777-777777777777",
        relationship: "temporal_after",
        weight: 1,
        inferred: true,
        created_at: createdAt,
        seed_type: "experience",
        seed_id: "22222222-2222-4222-8222-222222222222",
        direction: "outgoing",
        linked_type: "experience",
        linked_id: "77777777-7777-4777-8777-777777777777",
        linked_content: "Linked earlier experience",
        linked_title: null,
        linked_metadata: { event_type: "user_message" },
        linked_project: "one-brain",
        linked_created_at: createdAt,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "recall explicit links",
        bank_id: "openbrain",
        project: "one-brain",
        include_experiences: true,
        include_observations: true,
        include_documents: true,
        expand_from_seeds: [{ source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222" }],
        link_direction: "outgoing",
        link_relationship: "temporal_after",
        limit: 10,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("recall explicit links");
    expect(mockSearchThoughts).toHaveBeenCalled();
    expect(mockBm25SearchThoughts).toHaveBeenCalled();
    expect(mockSearchDocumentChunks).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ mode: "hybrid", project: "one-brain" }));
    expect(mockSearchConsolidatedObservations).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ bank_id: "openbrain", project: "one-brain" }));
    expect(mockSearchExperiences).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ bank_id: "openbrain", project: "one-brain" }));
    expect(mockExpandMemoryLinks).toHaveBeenCalledWith(expect.anything(), {
      bank_id: "openbrain",
      seeds: [{ source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222" }],
      direction: "outgoing",
      relationship: "temporal_after",
      include_archived: false,
      limit: 10,
    });

    const body = (await res.json()) as {
      count: number;
      lanes: { semantic: boolean; bm25: boolean; documents: boolean; observations: boolean; experiences: boolean; link_expansion: boolean; temporal: string };
      results: Array<{ source_type: string; id: string; semantic_score: number; bm25_score: number; link_score: number; content: string }>;
    };
    expect(body.count).toBe(5);
    expect(body.lanes).toMatchObject({ semantic: true, bm25: true, documents: true, observations: true, experiences: true, link_expansion: true, temporal: "stub" });
    const thought = body.results.find((result) => result.source_type === "thought");
    expect(thought?.semantic_score).toBe(0.82);
    expect(thought?.bm25_score).toBe(0.41);
    const linked = body.results.find((result) => result.id === "77777777-7777-4777-8777-777777777777");
    expect(linked?.source_type).toBe("experience");
    expect(linked?.link_score).toBe(1);
    expect(linked?.content).toBe("Linked earlier experience");
  });

  it("POST /recall activates temporal lane for explicit time windows", async () => {
    const createdAt = new Date("2026-06-15T16:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockRecallTemporalMemories.mockResolvedValueOnce([
      {
        source_type: "experience",
        id: "66666666-6666-4666-8666-666666666666",
        content: "Temporal experience content",
        title: null,
        metadata: { event_type: "assistant_message", occurred_at: createdAt.toISOString() },
        project: "one-brain",
        event_at: createdAt,
        event_started_at: createdAt,
        event_ended_at: createdAt,
        created_at: createdAt,
        temporal_score: 1,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "what happened during slice i",
        bank_id: "openbrain",
        project: "one-brain",
        include_documents: false,
        include_observations: false,
        include_experiences: false,
        time_start: "2026-06-15T15:00:00Z",
        time_end: "2026-06-15T17:00:00Z",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockRecallTemporalMemories).toHaveBeenCalledWith(expect.anything(), {
      bank_id: "openbrain",
      project: "one-brain",
      created_by: undefined,
      time_start: "2026-06-15T15:00:00Z",
      time_end: "2026-06-15T17:00:00Z",
      include_archived: false,
      limit: 5,
    });
    const body = (await res.json()) as {
      lanes: { temporal: string };
      results: Array<{ source_type: string; id: string; score: number; semantic_score: number; bm25_score: number; temporal_score: number; link_score: number; content: string }>;
    };
    expect(body.lanes.temporal).toBe("active");
    expect(body.results[0]).toMatchObject({
      source_type: "experience",
      id: "66666666-6666-4666-8666-666666666666",
      content: "Temporal experience content",
      score: 1,
      semantic_score: 0,
      bm25_score: 0,
      temporal_score: 1,
      link_score: 0,
    });
  });

  it("POST /recall validates temporal windows", async () => {
    const invalidTimestamp = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bad time", time_start: "not-a-time" }),
    });
    expect(invalidTimestamp.status).toBe(400);

    const invertedWindow = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "bad range",
        time_start: "2026-06-15T17:00:00Z",
        time_end: "2026-06-15T15:00:00Z",
      }),
    });
    expect(invertedWindow.status).toBe(400);
    expect(mockRecallTemporalMemories).not.toHaveBeenCalled();
  });

  it("POST /recall validates query, seed ids, and link direction", async () => {
    const empty = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(empty.status).toBe(400);

    const invalid = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "bad seed",
        expand_from_seeds: [{ source_type: "experience", source_id: "not-a-uuid" }],
        link_direction: "sideways",
      }),
    });

    expect(invalid.status).toBe(400);
    expect(mockSearchThoughts).not.toHaveBeenCalled();
    expect(mockExpandMemoryLinks).not.toHaveBeenCalled();
  });

  it("POST /recall accepts explicit source_types to run document-only recall", async () => {
    const createdAt = new Date("2026-06-16T00:00:00Z");
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333333",
        document_id: "44444444-4444-4444-8444-444444444444",
        document_title: "Source-filtered document",
        document_source_type: "agent-note",
        document_source_uri: "file:///source-filtered.md",
        project: "one-brain",
        chunk_index: 0,
        content: "Document-only recall result",
        metadata: {},
        similarity: 0.73,
        fts_rank: 0.3,
        score: 0.62,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "document source filter",
        source_types: ["document_chunk"],
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchThoughts).not.toHaveBeenCalled();
    expect(mockBm25SearchThoughts).not.toHaveBeenCalled();
    expect(mockSearchConsolidatedObservations).not.toHaveBeenCalled();
    expect(mockSearchExperiences).not.toHaveBeenCalled();
    expect(mockSearchMentalModels).not.toHaveBeenCalled();
    expect(mockSearchDocumentChunks).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ mode: "hybrid", limit: 5 }));

    const body = (await res.json()) as {
      count: number;
      lanes: { semantic: boolean; bm25: boolean; documents: boolean; observations: boolean; experiences: boolean; mental_models: boolean; source_types: string[] | null };
      results: Array<{ source_type: string; id: string }>;
    };
    expect(body.count).toBe(1);
    expect(body.lanes).toMatchObject({
      semantic: false,
      bm25: false,
      documents: true,
      observations: false,
      experiences: false,
      mental_models: false,
      source_types: ["document_chunk"],
    });
    expect(body.results).toEqual([
      expect.objectContaining({ source_type: "document_chunk", id: "33333333-3333-4333-8333-333333333333" }),
    ]);
  });

  it("POST /recall can balance final results across source types", async () => {
    const createdAt = new Date("2026-06-16T00:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111111",
        content: "Thought one",
        metadata: {},
        project: null,
        proof_count: 1,
        similarity: 0.99,
        created_at: createdAt,
      },
      {
        id: "11111111-1111-4111-8111-111111111112",
        content: "Thought two",
        metadata: {},
        project: null,
        proof_count: 1,
        similarity: 0.98,
        created_at: createdAt,
      },
      {
        id: "11111111-1111-4111-8111-111111111113",
        content: "Thought three",
        metadata: {},
        project: null,
        proof_count: 1,
        similarity: 0.97,
        created_at: createdAt,
      },
      {
        id: "11111111-1111-4111-8111-111111111114",
        content: "Thought four",
        metadata: {},
        project: null,
        proof_count: 1,
        similarity: 0.96,
        created_at: createdAt,
      },
    ]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333331",
        document_id: "44444444-4444-4444-8444-444444444441",
        document_title: "Document one",
        document_source_type: "agent-note",
        document_source_uri: "file:///doc-one.md",
        project: null,
        chunk_index: 0,
        content: "Balanced document one",
        metadata: {},
        similarity: 0.65,
        fts_rank: 0.2,
        score: 0.55,
        created_at: createdAt,
        updated_at: createdAt,
      },
      {
        id: "33333333-3333-4333-8333-333333333332",
        document_id: "44444444-4444-4444-8444-444444444442",
        document_title: "Document two",
        document_source_type: "agent-note",
        document_source_uri: "file:///doc-two.md",
        project: null,
        chunk_index: 0,
        content: "Balanced document two",
        metadata: {},
        similarity: 0.64,
        fts_rank: 0.1,
        score: 0.54,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);
    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "global recall should not crowd documents",
        source_balance: "balanced",
        include_observations: false,
        include_experiences: false,
        limit: 4,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lanes: { source_balance: string };
      results: Array<{ source_type: string; id: string }>;
    };
    expect(body.lanes.source_balance).toBe("balanced");
    expect(body.results.map((result) => result.source_type)).toEqual([
      "thought",
      "document_chunk",
      "thought",
      "document_chunk",
    ]);
  });

  it("POST /recall can route title-like queries to document-only recall when source_router is heuristic", async () => {
    const createdAt = new Date("2026-06-16T00:00:00Z");
    mockSearchDocumentChunks.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333335",
        document_id: "44444444-4444-4444-8444-444444444445",
        document_title: "Claude AI OAuth Connector Failure Root Cause",
        document_source_type: "agent-note",
        document_source_uri: "file:///claude-oauth-root-cause.md",
        project: null,
        chunk_index: 0,
        content: "Document routed result",
        metadata: {},
        similarity: 0.74,
        fts_rank: 0.4,
        score: 0.66,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Claude AI OAuth Connector Failure Root Cause",
        source_router: "heuristic",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchDocumentChunks).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ mode: "hybrid", limit: 5 }));
    expect(mockSearchThoughts).not.toHaveBeenCalled();
    expect(mockBm25SearchThoughts).not.toHaveBeenCalled();
    expect(mockSearchConsolidatedObservations).not.toHaveBeenCalled();
    expect(mockSearchExperiences).not.toHaveBeenCalled();
    expect(mockSearchMentalModels).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      lanes: { source_router: string; source_router_decision: { route: string; source_types: string[]; source_balance: string }; source_types: string[] | null; source_balance: string };
      results: Array<{ source_type: string }>;
    };
    expect(body.lanes.source_router).toBe("heuristic");
    expect(body.lanes.source_router_decision).toMatchObject({
      route: "document_only",
      source_types: ["document_chunk"],
      source_balance: "score",
    });
    expect(body.lanes.source_types).toEqual(["document_chunk"]);
    expect(body.lanes.source_balance).toBe("score");
    expect(body.results.map((result) => result.source_type)).toEqual(["document_chunk"]);
  });

  it("POST /recall does not route first-person summary queries to document-only recall", async () => {
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchDocumentChunks.mockResolvedValueOnce([]);
    mockSearchConsolidatedObservations.mockResolvedValueOnce([]);
    mockSearchExperiences.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "summarize my views on options trading",
        source_router: "heuristic",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchThoughts).toHaveBeenCalled();
    expect(mockBm25SearchThoughts).toHaveBeenCalled();
    expect(mockSearchDocumentChunks).toHaveBeenCalled();
    expect(mockSearchConsolidatedObservations).toHaveBeenCalled();
    expect(mockSearchExperiences).toHaveBeenCalled();

    const body = (await res.json()) as {
      lanes: { source_router_decision: { route: string; source_types: string[] | null; source_balance: string; reasons: string[] }; source_types: string[] | null; source_balance: string };
    };
    expect(body.lanes.source_router_decision).toMatchObject({
      route: "balanced_mixed",
      source_types: null,
      source_balance: "balanced",
    });
    expect(body.lanes.source_router_decision.reasons).toContain("fallback_mixed_visibility");
    expect(body.lanes.source_types).toBeNull();
    expect(body.lanes.source_balance).toBe("balanced");
  });

  it("POST /recall does not treat lowercase keyword memory queries as document titles", async () => {
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchDocumentChunks.mockResolvedValueOnce([]);
    mockSearchConsolidatedObservations.mockResolvedValueOnce([]);
    mockSearchExperiences.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "current Hermes orchestrator model production",
        source_router: "heuristic",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchThoughts).toHaveBeenCalled();
    expect(mockSearchDocumentChunks).toHaveBeenCalled();

    const body = (await res.json()) as {
      lanes: { source_router_decision: { route: string; source_types: string[] | null; source_balance: string; reasons: string[] }; source_types: string[] | null; source_balance: string };
    };
    expect(body.lanes.source_router_decision).toMatchObject({
      route: "balanced_mixed",
      source_types: null,
      source_balance: "balanced",
    });
    expect(body.lanes.source_router_decision.reasons).toContain("fallback_mixed_visibility");
    expect(body.lanes.source_types).toBeNull();
  });

  it("POST /recall can route memory-style queries to thought-only recall when source_router is heuristic", async () => {
    const createdAt = new Date("2026-06-16T00:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111118",
        content: "We decided to keep OAuth connector retries explicit.",
        metadata: { type: "decision" },
        project: null,
        proof_count: 1,
        similarity: 0.91,
        created_at: createdAt,
      },
    ]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "what did I decide about oauth connector retries",
        source_router: "heuristic",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchThoughts).toHaveBeenCalled();
    expect(mockBm25SearchThoughts).toHaveBeenCalled();
    expect(mockSearchDocumentChunks).not.toHaveBeenCalled();
    expect(mockSearchConsolidatedObservations).not.toHaveBeenCalled();
    expect(mockSearchExperiences).not.toHaveBeenCalled();
    expect(mockSearchMentalModels).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      lanes: { source_router: string; source_router_decision: { route: string; source_types: string[]; source_balance: string }; source_types: string[] | null; source_balance: string };
      results: Array<{ source_type: string }>;
    };
    expect(body.lanes.source_router).toBe("heuristic");
    expect(body.lanes.source_router_decision).toMatchObject({
      route: "thought_only",
      source_types: ["thought"],
      source_balance: "score",
    });
    expect(body.lanes.source_types).toEqual(["thought"]);
    expect(body.results.map((result) => result.source_type)).toEqual(["thought"]);
  });

  it("POST /recall lets explicit source controls override the heuristic router", async () => {
    const createdAt = new Date("2026-06-16T00:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([
      {
        id: "11111111-1111-4111-8111-111111111119",
        content: "Explicit thought override",
        metadata: {},
        project: null,
        proof_count: 1,
        similarity: 0.9,
        created_at: createdAt,
      },
    ]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Claude AI OAuth Connector Failure Root Cause",
        source_router: "heuristic",
        source_types: ["thought"],
        source_balance: "balanced",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchThoughts).toHaveBeenCalled();
    expect(mockSearchDocumentChunks).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      lanes: { source_router: string; source_router_decision: { route: string }; source_types: string[] | null; source_balance: string };
      results: Array<{ source_type: string }>;
    };
    expect(body.lanes.source_router).toBe("heuristic");
    expect(body.lanes.source_router_decision.route).toBe("document_only");
    expect(body.lanes.source_types).toEqual(["thought"]);
    expect(body.lanes.source_balance).toBe("balanced");
    expect(body.results.map((result) => result.source_type)).toEqual(["thought"]);
  });

  it("POST /recall validates source_router", async () => {
    const invalidRouter = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bad router", source_router: "always-on" }),
    });
    expect(invalidRouter.status).toBe(400);
    expect(mockSearchThoughts).not.toHaveBeenCalled();
  });

  it("POST /recall validates source_types and source_balance", async () => {
    const invalidSourceType = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bad source", source_types: ["graph"] }),
    });
    expect(invalidSourceType.status).toBe(400);

    const emptySourceTypes = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bad source", source_types: [] }),
    });
    expect(emptySourceTypes.status).toBe(400);

    const invalidBalance = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "bad balance", source_balance: "graph" }),
    });
    expect(invalidBalance.status).toBe(400);
    expect(mockSearchThoughts).not.toHaveBeenCalled();
  });

  it("POST /recall records route telemetry when source_router is used", async () => {
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchDocumentChunks.mockResolvedValueOnce([]);
    mockSearchConsolidatedObservations.mockResolvedValueOnce([]);
    mockSearchExperiences.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Claude AI OAuth Connector Failure Root Cause",
        source_router: "heuristic",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockInsertRecallRoutingTelemetry).toHaveBeenCalledTimes(1);
    const input = mockInsertRecallRoutingTelemetry.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.source_router).toBe("heuristic");
    expect(input.route).toBe("document_only");
    expect(input.source_balance).toBe("score");
    expect(Array.isArray(input.source_types)).toBe(true);
    expect(typeof input.confidence).toBe("number");
    expect(Array.isArray(input.reasons)).toBe(true);
    // Structural privacy guarantee: telemetry input has no query/content field.
    expect(input).not.toHaveProperty("query");
    expect(input).not.toHaveProperty("content");
    expect(JSON.stringify(input)).not.toContain("OAuth");
    expect(mockInsertExperience).not.toHaveBeenCalled();
  });

  it("POST /recall omits telemetry when source_router is off", async () => {
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchDocumentChunks.mockResolvedValueOnce([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "memory lookup", limit: 5 }),
    });

    expect(res.status).toBe(200);
    expect(mockInsertRecallRoutingTelemetry).not.toHaveBeenCalled();
  });

  it("POST /recall activates chunk_graph lane when query has entities", async () => {
    mockSearchThoughts.mockReset();
    mockBm25SearchThoughts.mockReset();
    mockSearchDocumentChunks.mockReset();
    mockSearchDocumentChunksByEntity.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchExperiences.mockReset();
    mockSearchMentalModels.mockReset();
    mockExpandMemoryLinks.mockReset();
    mockRecallTemporalMemories.mockReset();
    mockSearchThoughts.mockResolvedValue([]);
    mockBm25SearchThoughts.mockResolvedValue([]);
    mockSearchDocumentChunks.mockResolvedValue([]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchExperiences.mockResolvedValue([]);
    mockSearchMentalModels.mockResolvedValue([]);
    mockExpandMemoryLinks.mockResolvedValue([]);
    mockRecallTemporalMemories.mockResolvedValue([]);
    mockSearchDocumentChunksByEntity.mockResolvedValue([
      {
        id: "chunk-graph-1",
        document_id: "doc-1",
        document_title: "OpenBrain Plan",
        document_source_type: "ryel_markdown",
        document_source_uri: null,
        project: null,
        chunk_index: 0,
        content: "...",
        metadata: {},
        token_count: 100,
        char_start: 0,
        char_end: 200,
        created_at: new Date(),
        updated_at: new Date(),
        overlap_count: 2,
        similarity: 1.0,
        fts_rank: 0,
        score: 1.0,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Slice S Phase 4 startup synthesis migration", limit: 5 }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchDocumentChunksByEntity).toHaveBeenCalledTimes(1);
    const callArgs = mockSearchDocumentChunksByEntity.mock.calls[0]!;
    expect(Array.isArray(callArgs[1])).toBe(true);
    expect((callArgs[1] as string[]).length).toBeGreaterThan(0);
    const body = (await res.json()) as { lanes: { chunk_graph: { status: string; result_count: number; max_overlap: number } } };
    expect(body.lanes.chunk_graph.status).toBe("active");
    expect(body.lanes.chunk_graph.result_count).toBe(1);
    expect(body.lanes.chunk_graph.max_overlap).toBe(2);
  });

  it("POST /recall reports chunk_graph as stub when query has no entities", async () => {
    mockSearchThoughts.mockReset();
    mockBm25SearchThoughts.mockReset();
    mockSearchDocumentChunks.mockReset();
    mockSearchDocumentChunksByEntity.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchExperiences.mockReset();
    mockSearchMentalModels.mockReset();
    mockExpandMemoryLinks.mockReset();
    mockRecallTemporalMemories.mockReset();
    mockSearchThoughts.mockResolvedValue([]);
    mockBm25SearchThoughts.mockResolvedValue([]);
    mockSearchDocumentChunks.mockResolvedValue([]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchExperiences.mockResolvedValue([]);
    mockSearchMentalModels.mockResolvedValue([]);
    mockExpandMemoryLinks.mockResolvedValue([]);
    mockRecallTemporalMemories.mockResolvedValue([]);
    mockSearchDocumentChunksByEntity.mockResolvedValue([]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "the and or", limit: 5 }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchDocumentChunksByEntity).not.toHaveBeenCalled();
    const body = (await res.json()) as { lanes: { chunk_graph: { status: string } } };
    expect(body.lanes.chunk_graph.status).toBe("stub");
  });

  // ─── POST /reflect ─────────────────────────────────────────────────

  it("POST /reflect returns 400 when query missing", async () => {
    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bank_id: "openbrain" }),
    });
    expect(res.status).toBe(400);
    expect(mockReflectAnswer).not.toHaveBeenCalled();
  });

  it("POST /reflect returns cascade + LLM answer with full response structure", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([
      {
        id: "mm-1",
        name: "explicit-recall-lane-discipline",
        query: "recall policy",
        content: "Default recall stays opt-in.",
        structured: {},
        tags: ["recall", "policy"],
        trigger_tags: ["recall"],
        priority: 1,
        refresh_meta: { source: "seed", next_refresh_after: "2099-01-01T00:00:00Z" },
        history: [],
        active: true,
        project: null,
        created_by: null,
        created_at: new Date("2026-01-01"),
        updated_at: new Date("2026-06-01"),
        similarity: 0.9,
        bank_id: "openbrain",
      },
    ]);
    mockSearchConsolidatedObservations.mockResolvedValue([
      {
        id: "co-1",
        content: "OpenBrain is single-user, localhost-only.",
        proof_count: 3,
        source_memory_ids: [],
        source_quotes: {},
        tags: ["infra"],
        history: [],
        trend: "stable",
        trend_computed_at: null,
        project: null,
        created_by: null,
        archived: false,
        created_at: new Date("2026-03-01"),
        updated_at: new Date("2026-05-01"),
        bank_id: "openbrain",
        similarity: 0.8,
      },
    ]);
    mockSearchThoughts.mockResolvedValue([
      { id: "th-1", content: "Slice S migrated 29 synthesis thoughts.", metadata: { type: "observation", topics: ["migration"] }, similarity: 0.7, proof_count: 1, created_at: new Date("2026-06-01"), project: "openbrain", archived: false },
    ]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: "I am Ryan's memory bank.",
      disposition: { skepticism: 4 },
      directives: [
        { id: "d-1", name: "no_pii_verbatim", rule_text: "Never store PII verbatim.", severity: "hard", priority: 100, applies_to: ["reflect"] },
      ],
    });
    mockReflectAnswer.mockResolvedValueOnce("Default recall stays opt-in [mm-1]; the bank is single-user [co-1].");

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "what is OpenBrain's recall policy?" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.query).toBe("what is OpenBrain's recall policy?");
    expect(body.bank_id).toBe("openbrain");
    expect(body.answer).toBe("Default recall stays opt-in [mm-1]; the bank is single-user [co-1].");
    const cascade = body.cascade as Record<string, unknown>;
    expect((cascade.mental_models as unknown[]).length).toBe(1);
    expect((cascade.consolidated_observations as unknown[]).length).toBe(1);
    expect((cascade.raw_facts as unknown[]).length).toBe(1);

    // Verify new top-level response fields
    expect(body.mental_models).toBeDefined();
    expect((body.mental_models as unknown[]).length).toBe(1);
    const mms = body.mental_models as Record<string, unknown>[];
    const mm = mms[0]!;
    expect(mm.id).toBe("mm-1");
    expect(mm.name).toBe("explicit-recall-lane-discipline");
    expect(mm.stale).toBe(false); // next_refresh_after is 2099

    expect(body.observations).toBeDefined();
    expect((body.observations as unknown[]).length).toBe(1);
    const obss = body.observations as Record<string, unknown>[];
    const obs = obss[0]!;
    expect(obs.id).toBe("co-1");
    expect(obs.proof_count).toBe(3);

    expect(body.raw_facts).toBeDefined();
    expect((body.raw_facts as unknown[]).length).toBe(1);
    const rfs = body.raw_facts as Record<string, unknown>[];
    const rf = rfs[0]!;
    expect(rf.id).toBe("th-1");
    expect(rf.type).toBe("observation");

    expect(body.reflect_telemetry).toBeDefined();
    const telemetry = body.reflect_telemetry as Record<string, unknown>;
    expect(telemetry.model).toBeDefined();
    expect(telemetry.total_ms).toBeDefined();
    expect(telemetry.mental_model_count).toBe(1);
    expect(telemetry.observation_count).toBe(1);
    expect(telemetry.raw_fact_count).toBe(1);
    expect(telemetry.stale_mental_models).toEqual([]);

    // Verify new top-level evidence_count and model_used fields
    expect(body.evidence_count).toBe(3);
    expect(body.model_used).toBeDefined();

    expect(mockGetMemoryBankContext).toHaveBeenCalledWith(expect.anything(), "openbrain", "reflect");
    expect(mockReflectAnswer).toHaveBeenCalledTimes(1);
    expect(mockSearchMentalModels).toHaveBeenCalledTimes(1);
    expect(mockSearchConsolidatedObservations).toHaveBeenCalledTimes(1);
    expect(mockSearchThoughts).toHaveBeenCalledTimes(1);
  });

  it("POST /reflect marks mental models as stale when next_refresh_after is past", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([
      {
        id: "mm-stale",
        name: "stale-model",
        query: "stale query",
        content: "Stale content.",
        structured: {},
        tags: [],
        trigger_tags: [],
        priority: 2,
        refresh_meta: { next_refresh_after: "2020-01-01T00:00:00Z" },
        history: [],
        active: true,
        project: null,
        created_by: null,
        created_at: new Date("2025-01-01"),
        updated_at: new Date("2025-06-01"),
        similarity: 0.85,
        bank_id: "openbrain",
      },
    ]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchThoughts.mockResolvedValue([]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: null,
      disposition: {},
      directives: [],
    });
    mockReflectAnswer.mockResolvedValueOnce(null);

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "stale check" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const mms = body.mental_models as Record<string, unknown>[];
    expect(mms.length).toBe(1);
    expect(mms[0]!.stale).toBe(true);
    const telemetry = body.reflect_telemetry as Record<string, unknown>;
    expect(telemetry.stale_mental_models).toContain("mm-stale");
  });

  it("POST /reflect respects model_hint parameter", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchThoughts.mockResolvedValue([]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: null,
      disposition: {},
      directives: [],
    });
    mockReflectAnswer.mockResolvedValueOnce("A response.");

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test model hint", model_hint: "custom-model:7b" }),
    });

    expect(res.status).toBe(200);
    expect(mockReflectAnswer).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ model: "custom-model:7b" }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    const telemetry = body.reflect_telemetry as Record<string, unknown>;
    expect(telemetry.model).toBe("custom-model:7b");
  });

  it("POST /reflect returns cascade with null answer when LLM refuses", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchThoughts.mockResolvedValue([]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: null,
      disposition: null,
      directives: [],
    });
    mockReflectAnswer.mockResolvedValueOnce(null);

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "anything" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.answer).toBeNull();
    expect(body.cascade).toBeDefined();
    expect(body.evidence_count).toBe(0);
    expect(body.model_used).toBeDefined();
    expect(body.reflect_telemetry).toBeDefined();
  });

  it("POST /reflect omits detailed sources when include_sources is false", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([
      {
        id: "mm-src",
        name: "test-model",
        query: "test",
        content: "Model content.",
        structured: {},
        tags: [],
        trigger_tags: [],
        priority: 1,
        refresh_meta: {},
        history: [],
        active: true,
        project: null,
        created_by: null,
        created_at: new Date("2026-01-01"),
        updated_at: new Date("2026-06-01"),
        similarity: 0.9,
        bank_id: "openbrain",
      },
    ]);
    mockSearchConsolidatedObservations.mockResolvedValue([
      {
        id: "co-src",
        content: "Observation content.",
        proof_count: 2,
        source_memory_ids: [],
        source_quotes: {},
        tags: ["test"],
        history: [],
        trend: "stable",
        trend_computed_at: null,
        project: null,
        created_by: null,
        archived: false,
        created_at: new Date("2026-03-01"),
        updated_at: new Date("2026-05-01"),
        bank_id: "openbrain",
        similarity: 0.8,
      },
    ]);
    mockSearchThoughts.mockResolvedValue([]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: null,
      disposition: {},
      directives: [],
    });
    mockReflectAnswer.mockResolvedValueOnce("Summary answer.");

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test include_sources", include_sources: false }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.evidence_count).toBe(2);
    expect(body.model_used).toBeDefined();
    expect(body.answer).toBe("Summary answer.");
    expect(body.cascade).toBeUndefined();
    expect(body.mental_models).toBeUndefined();
    expect(body.observations).toBeUndefined();
    expect(body.raw_facts).toBeUndefined();
    expect(body.memory_bank).toBeUndefined();
    expect(body.reflect_telemetry).toBeDefined();
    const telemetry = body.reflect_telemetry as Record<string, unknown>;
    expect(telemetry.mental_model_count).toBe(1);
    expect(telemetry.observation_count).toBe(1);
    expect(telemetry.raw_fact_count).toBe(0);
  });

  it("POST /reflect includes sources by default when include_sources is true", async () => {
    mockSearchThoughts.mockReset();
    mockSearchMentalModels.mockReset();
    mockSearchConsolidatedObservations.mockReset();
    mockSearchMentalModels.mockResolvedValue([]);
    mockSearchConsolidatedObservations.mockResolvedValue([]);
    mockSearchThoughts.mockResolvedValue([
      { id: "th-default", content: "A raw fact.", metadata: { type: "observation", topics: ["test"] }, similarity: 0.7, proof_count: 1, created_at: new Date("2026-06-01"), project: null, archived: false },
    ]);
    mockGetMemoryBankContext.mockResolvedValueOnce({
      id: "openbrain",
      name: "OpenBrain",
      mission: null,
      disposition: {},
      directives: [],
    });
    mockReflectAnswer.mockResolvedValueOnce("A fact was found.");

    const res = await app.request("/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "default sources test", include_sources: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.evidence_count).toBe(1);
    expect(body.cascade).toBeDefined();
    expect(body.mental_models).toBeDefined();
    expect(body.observations).toBeDefined();
    expect(body.raw_facts).toBeDefined();
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

  it("GET /documents returns a filtered paginated document explorer list", async () => {
    const now = new Date("2026-06-18T12:00:00Z");
    mockListDocuments.mockResolvedValueOnce([
      {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
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
        created_at: now,
        updated_at: now,
      },
    ]);

    const res = await app.request("/documents?project=one-brain&source_type=markdown&status=active&q=handoff&limit=25&offset=50");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; limit: number; offset: number; documents: Array<Record<string, unknown>> };
    expect(body.count).toBe(1);
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);
    expect(body.documents[0]!.content_preview).toBe("Handoff preview");
    expect(body.documents[0]!.chunk_count).toBe(3);
    expect(mockListDocuments).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      project: "one-brain",
      source_type: "markdown",
      status: "active",
      q: "handoff",
      limit: 25,
      offset: 50,
    }));
  });

  it("GET /documents rejects invalid list query params", async () => {
    const invalidStatus = await app.request("/documents?status=missing");
    expect(invalidStatus.status).toBe(400);
    const invalidLimit = await app.request("/documents?limit=0");
    expect(invalidLimit.status).toBe(400);
    expect(mockListDocuments).not.toHaveBeenCalled();
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
    mockUpdateDocumentWithChunks.mockResolvedValueOnce({
      document: {
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
      },
      chunks: [],
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
    const patchArg = mockUpdateDocumentWithChunks.mock.calls[0]![2];
    expect(patchArg.edit_reason).toBe("manual correction");
    expect(patchArg.updated_by).toBe("ryan");
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it("PATCH /documents/:id regenerates document chunks and embeddings when content changes", async () => {
    const updatedAt = new Date("2026-06-19T12:00:00Z");
    mockUpdateDocumentWithChunks.mockResolvedValueOnce({
      document: {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        title: "Updated source",
        source_type: "markdown",
        source_uri: "file:///tmp/source.md",
        content: "# Updated source\n\nAlpha beta gamma.\n\n## Searchable section\n\nNeedleTerm123 now belongs in retrieval.",
        metadata: { tags: ["updated"] },
        project: "one-brain",
        created_by: "ryan",
        status: "active",
        created_at: updatedAt,
        updated_at: updatedAt,
      },
      chunks: [
        {
          id: "chunk-0",
          document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
          chunk_index: 0,
          content: "# Updated source\n\nAlpha beta gamma.\n\n## Searchable section\n\nNeedleTerm123 now belongs in retrieval.",
          metadata: { heading: "root" },
          token_count: 10,
          char_start: 0,
          char_end: 96,
          created_at: updatedAt,
          updated_at: updatedAt,
        },
      ],
    });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "# Updated source\n\nAlpha beta gamma.\n\n## Searchable section\n\nNeedleTerm123 now belongs in retrieval.",
        edit_reason: "regenerate retrieval artifacts",
        updated_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(expect.stringContaining("NeedleTerm123"));
    expect(mockUpdateDocumentWithChunks).toHaveBeenCalledWith(
      expect.anything(),
      "a1b2c3d4-1234-5678-9abc-def012345678",
      expect.objectContaining({ content: expect.stringContaining("NeedleTerm123") }),
      expect.arrayContaining([
        expect.objectContaining({
          chunk_index: 0,
          content: expect.stringContaining("NeedleTerm123"),
          embedding: [0.1, 0.2, 0.3],
          metadata: expect.objectContaining({ heading: expect.any(String) }),
        }),
      ])
    );
    expect(mockReplaceDocumentChunks).not.toHaveBeenCalled();
    expect(mockExtractAndLinkChunkEntities).toHaveBeenCalledWith(expect.anything(), "chunk-0", expect.any(Array));
  });

  it("PATCH /documents/:id prepares embeddings before mutating document content", async () => {
    const updatedAt = new Date("2026-06-19T13:00:00Z");
    mockGenerateEmbedding.mockRejectedValueOnce(new Error("embedder unavailable"));

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "# Updated source\n\nEmbeddingFailureTerm should not commit before embedding succeeds.",
        edit_reason: "prove embedding happens before commit",
        updated_by: "ryan",
      }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; detail: string; reindexed?: boolean };
    expect(body.error).toBe("Failed to reindex document");
    expect(body.detail).toContain("embedder unavailable");
    expect(body.reindexed).toBe(false);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockUpdateDocumentWithChunks).not.toHaveBeenCalled();
    expect(mockReplaceDocumentChunks).not.toHaveBeenCalled();
  });

  it("PATCH /documents/:id commits document edits and regenerated chunks atomically", async () => {
    const updatedAt = new Date("2026-06-19T13:05:00Z");
    mockUpdateDocumentWithChunks.mockResolvedValueOnce({
      document: {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        title: "Atomic updated source",
        source_type: "markdown",
        source_uri: "file:///tmp/source.md",
        content: "# Atomic update\n\nAtomicNeedleTerm now belongs in retrieval.",
        metadata: { tags: ["atomic"] },
        project: "one-brain",
        created_by: "ryan",
        status: "active",
        created_at: updatedAt,
        updated_at: updatedAt,
      },
      chunks: [
        {
          id: "chunk-atomic-0",
          document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
          chunk_index: 0,
          content: "# Atomic update\n\nAtomicNeedleTerm now belongs in retrieval.",
          metadata: { heading: "root" },
          token_count: 7,
          char_start: 0,
          char_end: 58,
          created_at: updatedAt,
          updated_at: updatedAt,
        },
      ],
    });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Atomic updated source",
        content: "# Atomic update\n\nAtomicNeedleTerm now belongs in retrieval.",
        metadata: { tags: ["atomic"] },
        edit_reason: "atomic edit and reindex",
        updated_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; reindexed?: boolean; chunk_count?: number };
    expect(body.title).toBe("Atomic updated source");
    expect(body.reindexed).toBe(true);
    expect(body.chunk_count).toBe(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(expect.stringContaining("AtomicNeedleTerm"));
    expect(mockUpdateDocumentWithChunks).toHaveBeenCalledWith(
      expect.anything(),
      "a1b2c3d4-1234-5678-9abc-def012345678",
      expect.objectContaining({
        title: "Atomic updated source",
        content: expect.stringContaining("AtomicNeedleTerm"),
        edit_reason: "atomic edit and reindex",
        updated_by: "ryan",
      }),
      expect.arrayContaining([
        expect.objectContaining({
          chunk_index: 0,
          content: expect.stringContaining("AtomicNeedleTerm"),
          embedding: [0.1, 0.2, 0.3],
        }),
      ])
    );
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockReplaceDocumentChunks).not.toHaveBeenCalled();
    expect(mockExtractAndLinkChunkEntities).toHaveBeenCalledWith(expect.anything(), "chunk-atomic-0", expect.any(Array));
  });

  it("PATCH /documents/:id does not reindex metadata-only edits", async () => {
    const updatedAt = new Date("2026-06-19T13:10:00Z");
    mockUpdateDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Metadata-only source",
      source_type: "markdown",
      source_uri: "file:///tmp/source.md",
      content: "Unchanged content",
      metadata: { tags: ["metadata-only"] },
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
        metadata: { tags: ["metadata-only"] },
        edit_reason: "metadata correction",
        updated_by: "ryan",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reindexed?: boolean; chunk_count?: number };
    expect(body.reindexed).toBe(false);
    expect(body.chunk_count).toBeUndefined();
    expect(mockUpdateDocument).toHaveBeenCalled();
    expect(mockUpdateDocumentWithChunks).not.toHaveBeenCalled();
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockReplaceDocumentChunks).not.toHaveBeenCalled();
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

  it("GET /documents/:id/revisions lists decrypted revision history", async () => {
    const now = new Date("2026-06-18T12:00:00Z");
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Current source",
      source_type: "markdown",
      content: "Current body",
      metadata: {},
      status: "active",
      created_at: now,
      updated_at: now,
    });
    mockListDocumentRevisions.mockResolvedValueOnce([
      {
        id: "rev-123",
        document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
        revision_number: 1,
        title: "Old source",
        source_uri: "file:///old.md",
        content: "Old body",
        metadata: { tags: ["old"] },
        status: "active",
        edit_reason: "manual correction",
        created_by: "ryan",
        created_at: now,
      },
    ]);

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/revisions");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { document_id: string; count: number; revisions: Array<Record<string, unknown>> };
    expect(body.count).toBe(1);
    expect(body.revisions[0]!.content).toBe("Old body");
    expect(body.revisions[0]!.revision_number).toBe(1);
    expect(mockListDocumentRevisions).toHaveBeenCalledWith(expect.anything(), "a1b2c3d4-1234-5678-9abc-def012345678");
  });

  it("GET /documents/:id/revisions/:rev/diff returns revision-to-current diff metrics", async () => {
    const now = new Date("2026-06-18T12:00:00Z");
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Current source",
      source_type: "markdown",
      source_uri: "file:///current.md",
      content: "line one\nline two changed\nline three",
      metadata: { tags: ["new"] },
      status: "active",
      created_at: now,
      updated_at: now,
    });
    mockGetDocumentRevision.mockResolvedValueOnce({
      id: "rev-123",
      document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
      revision_number: 1,
      title: "Old source",
      source_uri: "file:///old.md",
      content: "line one\nline two",
      metadata: { tags: ["old"] },
      status: "active",
      edit_reason: "manual correction",
      created_by: "ryan",
      created_at: now,
    });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/revisions/1/diff");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: Record<string, unknown>; revision: Record<string, unknown> };
    expect(body.revision.revision_number).toBe(1);
    expect(body.diff.changed).toBe(true);
    expect(body.diff.added_lines).toBeGreaterThan(0);
    expect(body.diff.removed_lines).toBeGreaterThan(0);
    expect(body.diff.title_changed).toBe(true);
  });


  it("POST /documents/:id/reindex regenerates chunks and embeddings for an existing document", async () => {
    const updatedAt = new Date("2026-06-19T14:00:00Z");
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Reindex target",
      source_type: "markdown",
      source_uri: "file:///vault/reindex.md",
      content: "# Reindex test\n\nFresh NeedleReindex content.",
      metadata: { tags: ["stale"] },
      project: "one-brain",
      created_by: "ryan",
      status: "active",
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    mockUpdateDocumentWithChunks.mockResolvedValueOnce({
      document: {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        title: "Reindex target",
        source_type: "markdown",
        source_uri: "file:///vault/reindex.md",
        content: "# Reindex test\n\nFresh NeedleReindex content.",
        metadata: { tags: ["stale"] },
        project: "one-brain",
        created_by: "ryan",
        status: "active",
        created_at: updatedAt,
        updated_at: updatedAt,
      },
      chunks: [
        {
          id: "chunk-reindex-0",
          document_id: "a1b2c3d4-1234-5678-9abc-def012345678",
          chunk_index: 0,
          content: "# Reindex test\n\nFresh NeedleReindex content.",
          metadata: { heading: "root" },
          token_count: 8,
          char_start: 0,
          char_end: 44,
          created_at: updatedAt,
          updated_at: updatedAt,
        },
      ],
    });
    mockExtractAndLinkChunkEntities.mockResolvedValueOnce([]);

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reindexed: boolean; chunk_count: number };
    expect(body.reindexed).toBe(true);
    expect(body.chunk_count).toBe(1);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      expect.stringContaining("NeedleReindex")
    );
    expect(mockUpdateDocumentWithChunks).toHaveBeenCalledWith(
      expect.anything(),
      "a1b2c3d4-1234-5678-9abc-def012345678",
      expect.objectContaining({ content: expect.stringContaining("NeedleReindex") }),
      expect.arrayContaining([
        expect.objectContaining({
          chunk_index: 0,
          content: expect.stringContaining("NeedleReindex"),
          embedding: [0.1, 0.2, 0.3],
        }),
      ])
    );
  });

  it("POST /documents/:id/reindex returns 404 for missing document", async () => {
    mockGetDocument.mockResolvedValueOnce(null);

    const res = await app.request("/documents/00000000-0000-0000-0000-000000000000/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
  });

  it("POST /documents/:id/reindex returns 502 when embedder is unavailable", async () => {
    const updatedAt = new Date("2026-06-19T14:05:00Z");
    mockGetDocument.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      title: "Reindex embedder-fail",
      source_type: "markdown",
      source_uri: null,
      content: "Content that will fail embedding.",
      metadata: {},
      project: "one-brain",
      created_by: "ryan",
      status: "active",
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    mockGenerateEmbedding.mockRejectedValueOnce(new Error("embedder offline"));

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; reindexed: boolean };
    expect(body.error).toBe("Failed to reindex document");
    expect(body.reindexed).toBe(false);
    expect(mockUpdateDocumentWithChunks).not.toHaveBeenCalled();
  });

  it("DELETE /documents/:id soft deletes a document", async () => {
    mockDeleteDocument.mockResolvedValueOnce({ deleted: true, id: "a1b2c3d4-1234-5678-9abc-def012345678" });

    const res = await app.request("/documents/a1b2c3d4-1234-5678-9abc-def012345678", { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; id: string };
    expect(body.deleted).toBe(true);
    expect(mockDeleteDocument).toHaveBeenCalledWith(expect.anything(), "a1b2c3d4-1234-5678-9abc-def012345678");
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


  // ─── Mental Models ────────────────────────────────────────────────────

  it("POST /mental-models creates an explicit mental model", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockInsertMentalModel.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      name: "One Brain direction",
      query: "What is the one-brain architecture direction?",
      content: "OpenBrain is canonical; Markdown is transitional UI/archive.",
      structured: { stance: "database-first" },
      tags: ["one-brain"],
      trigger_tags: ["architecture"],
      priority: 7,
      refresh_meta: { source: "manual" },
      history: [],
      active: true,
      project: "one-brain",
      created_by: "hermes",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/mental-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "One Brain direction",
        query: "What is the one-brain architecture direction?",
        content: "OpenBrain is canonical; Markdown is transitional UI/archive.",
        structured: { stance: "database-first" },
        tags: ["one-brain"],
        trigger_tags: ["architecture"],
        priority: 7,
        project: "one-brain",
        created_by: "hermes",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("One Brain direction\nWhat is the one-brain architecture direction?\nOpenBrain is canonical; Markdown is transitional UI/archive.");
    const insertArg = mockInsertMentalModel.mock.calls[0]![1];
    expect(insertArg.name).toBe("One Brain direction");
    expect(insertArg.embedding).toEqual([0.1, 0.2, 0.3]);
    const body = (await res.json()) as { id: string; name: string; trigger_tags: string[] };
    expect(body.name).toBe("One Brain direction");
    expect(body.trigger_tags).toEqual(["architecture"]);
  });

  it("POST /mental-models validates required fields and structured metadata", async () => {
    const missing = await app.request("/mental-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", query: "q", content: "c" }),
    });
    expect(missing.status).toBe(400);

    const badTags = await app.request("/mental-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "n", query: "q", content: "c", trigger_tags: "architecture" }),
    });
    expect(badTags.status).toBe(400);
    expect(mockInsertMentalModel).not.toHaveBeenCalled();
  });

  it("GET /mental-models lists models and GET /mental-models/:id fetches one", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    const row = {
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      name: "One Brain direction",
      query: "What is the one-brain architecture direction?",
      content: "OpenBrain is canonical.",
      structured: {},
      tags: ["one-brain"],
      trigger_tags: ["architecture"],
      priority: 7,
      refresh_meta: {},
      history: [],
      active: true,
      project: "one-brain",
      created_by: "hermes",
      created_at: createdAt,
      updated_at: createdAt,
    };
    mockListMentalModels.mockResolvedValueOnce([row]);
    mockGetMentalModel.mockResolvedValueOnce(row);

    const listRes = await app.request("/mental-models?bank_id=openbrain&project=one-brain&trigger_tag=architecture&limit=5");
    expect(listRes.status).toBe(200);
    expect(mockListMentalModels.mock.calls[0]![1]).toMatchObject({ bank_id: "openbrain", project: "one-brain", trigger_tag: "architecture", limit: 5 });
    const listBody = (await listRes.json()) as { count: number; results: Array<{ name: string }> };
    expect(listBody.count).toBe(1);

    const getRes = await app.request("/mental-models/a1b2c3d4-1234-5678-9abc-def012345678");
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { id: string; content: string };
    expect(getBody.content).toBe("OpenBrain is canonical.");
  });

  it("POST /mental-models/search embeds query and returns similarity", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockSearchMentalModels.mockResolvedValueOnce([
      {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        bank_id: "openbrain",
        name: "One Brain direction",
        query: "What is the one-brain architecture direction?",
        content: "OpenBrain is canonical.",
        structured: {},
        tags: ["one-brain"],
        trigger_tags: ["architecture"],
        priority: 7,
        refresh_meta: {},
        history: [],
        active: true,
        project: "one-brain",
        created_by: "hermes",
        similarity: 0.91,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/mental-models/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "one brain direction", project: "one-brain", trigger_tag: "architecture", limit: 3 }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("one brain direction");
    expect(mockSearchMentalModels.mock.calls[0]![2]).toMatchObject({ project: "one-brain", trigger_tag: "architecture", limit: 3 });
    const body = (await res.json()) as { results: Array<{ similarity: number }> };
    expect(body.results[0]!.similarity).toBe(0.91);
  });

  it("PUT /mental-models/:id updates and can deactivate a model", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockGetMentalModel.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      name: "One Brain direction",
      query: "What is the one-brain architecture direction?",
      content: "OpenBrain is canonical.",
      structured: {},
      tags: [],
      trigger_tags: [],
      priority: 0,
      refresh_meta: {},
      history: [],
      active: true,
      project: "one-brain",
      created_by: "hermes",
      created_at: createdAt,
      updated_at: createdAt,
    });
    mockUpdateMentalModel.mockResolvedValueOnce({
      id: "a1b2c3d4-1234-5678-9abc-def012345678",
      bank_id: "openbrain",
      name: "One Brain direction",
      query: "What is the one-brain architecture direction?",
      content: "Updated mental model",
      structured: {},
      tags: [],
      trigger_tags: [],
      priority: 0,
      refresh_meta: { refreshed_by: "smoke" },
      history: [],
      active: false,
      project: "one-brain",
      created_by: "hermes",
      created_at: createdAt,
      updated_at: createdAt,
    });

    const res = await app.request("/mental-models/a1b2c3d4-1234-5678-9abc-def012345678", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated mental model", active: false, refresh_meta: { refreshed_by: "smoke" } }),
    });

    expect(res.status).toBe(200);
    expect(mockGenerateEmbedding).toHaveBeenCalledWith("One Brain direction\nWhat is the one-brain architecture direction?\nUpdated mental model");
    expect(mockGetMentalModel).toHaveBeenCalledWith(expect.anything(), "a1b2c3d4-1234-5678-9abc-def012345678");
    expect(mockUpdateMentalModel.mock.calls[0]![2]).toMatchObject({ content: "Updated mental model", active: false });
    const body = (await res.json()) as { active: boolean };
    expect(body.active).toBe(false);
  });

  it("POST /recall can opt into the mental-model lane without changing default recall", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockSearchThoughts.mockResolvedValueOnce([]);
    mockBm25SearchThoughts.mockResolvedValueOnce([]);
    mockSearchMentalModels.mockResolvedValueOnce([
      {
        id: "a1b2c3d4-1234-5678-9abc-def012345678",
        bank_id: "openbrain",
        name: "One Brain direction",
        query: "What is the one-brain architecture direction?",
        content: "OpenBrain is canonical.",
        structured: { stance: "database-first" },
        tags: ["one-brain"],
        trigger_tags: ["architecture"],
        priority: 7,
        refresh_meta: {},
        history: [],
        active: true,
        project: "one-brain",
        created_by: "hermes",
        similarity: 0.93,
        created_at: createdAt,
        updated_at: createdAt,
      },
    ]);

    const res = await app.request("/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "one brain direction",
        include_documents: false,
        include_observations: false,
        include_experiences: false,
        include_mental_models: true,
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockSearchMentalModels).toHaveBeenCalledWith(expect.anything(), [0.1, 0.2, 0.3], expect.objectContaining({ bank_id: "openbrain", limit: 5 }));
    const body = (await res.json()) as { lanes: Record<string, unknown>; results: Array<{ source_type: string; title: string; semantic_score: number }> };
    expect(body.lanes.mental_models).toBe(true);
    expect(body.results[0]!.source_type).toBe("mental_model");
    expect(body.results[0]!.title).toBe("One Brain direction");
    expect(body.results[0]!.semantic_score).toBe(0.93);
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
    mockInferExperienceTemporalLinks.mockResolvedValueOnce([]);
    mockInferExperienceReferenceLinks.mockResolvedValueOnce([]);

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
    expect(mockInferExperienceTemporalLinks).toHaveBeenCalledWith(expect.anything(), { bank_id: "openbrain", session_id: "session-slice-d" });
    expect(mockInferExperienceReferenceLinks).toHaveBeenCalledWith(expect.anything(), { bank_id: "openbrain", session_id: "session-slice-d" });
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

  it("POST /memory-links/expand returns directly linked memories for explicit seeds", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockExpandMemoryLinks.mockResolvedValueOnce([
      {
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
        seed_type: "experience",
        seed_id: "22222222-2222-4222-8222-222222222222",
        direction: "outgoing",
        linked_type: "experience",
        linked_id: "11111111-1111-4111-8111-111111111111",
        linked_content: "Earlier experience content",
        linked_title: null,
        linked_metadata: { event_type: "user_message" },
        linked_project: "one-brain",
        linked_created_at: createdAt,
      },
    ]);

    const res = await app.request("/memory-links/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: "openbrain",
        seeds: [{ source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222" }],
        direction: "outgoing",
        relationship: "temporal_after",
        limit: 5,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockExpandMemoryLinks).toHaveBeenCalledWith(expect.anything(), {
      bank_id: "openbrain",
      seeds: [{ source_type: "experience", source_id: "22222222-2222-4222-8222-222222222222" }],
      direction: "outgoing",
      relationship: "temporal_after",
      include_archived: false,
      limit: 5,
    });
    const body = (await res.json()) as { count: number; results: Array<{ linked_memory: { content: string }; link: { relationship: string } }> };
    expect(body.count).toBe(1);
    expect(body.results[0]!.link.relationship).toBe("temporal_after");
    expect(body.results[0]!.linked_memory.content).toBe("Earlier experience content");
  });

  it("POST /memory-links/expand validates seed ids and direction", async () => {
    const res = await app.request("/memory-links/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seeds: [{ source_type: "experience", source_id: "not-a-uuid" }],
        direction: "sideways",
      }),
    });

    expect(res.status).toBe(400);
    expect(mockExpandMemoryLinks).not.toHaveBeenCalled();
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
    expect(mockRunConsolidationJob.mock.calls[0]![2].synthesis.model).toBe(
      process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "qwen3:1.7b"
    );
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
