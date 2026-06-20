import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryBankDirective, deleteMemoryBankDirective, expandMemoryLinks, exportAllDocuments, exportDocument, getDocument, getRevisionDiff, listDocumentChunks, listDocumentRevisions, listExperiences, listMemoryBankDirectives, listMemoryLinks, listMentalModels, reflect, reindexDocument, searchConsolidatedObservations, setStoredAdminApiKey, getStoredAdminApiKey, updateDocument, updateMemoryBankDirective } from "./api";

describe("updateDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
  });

  it("stores admin API keys under the stable OpenBrain namespace", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    setStoredAdminApiKey("test-admin-key");

    expect(storage.get("openbrain.admin_api_key")).toBe("test-admin-key");
    expect(getStoredAdminApiKey()).toBe("test-admin-key");

    setStoredAdminApiKey("");
    expect(storage.has("openbrain.admin_api_key")).toBe(false);
  });

  it("migrates admin API keys from the legacy truncated storage key", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const legacyKey = "openbrain" + "_admin_api_" + "key";
    storage.set(legacyKey, "legacy-admin-key");

    expect(getStoredAdminApiKey()).toBe("legacy-admin-key");
    expect(storage.get("openbrain.admin_api_key")).toBe("legacy-admin-key");
    expect(storage.has(legacyKey)).toBe(false);
  });

  it("PATCHes the document editor payload to /documents/:id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "doc-1", title: "Updated", content: "Body" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await updateDocument("doc-1", {
      title: "Updated",
      content: "Body",
      edit_reason: "web editor smoke",
      updated_by: "openbrain-web",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/web/api/documents/doc-1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated",
          content: "Body",
          edit_reason: "web editor smoke",
          updated_by: "openbrain-web",
        }),
      })
    );
  });

  it("encodes document IDs in path helpers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "doc/1", title: "Encoded", content: "Body", count: 0, revisions: [], chunks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await getDocument("doc/1");
    await updateDocument("doc/1", { title: "Encoded" });
    await listDocumentRevisions("doc/1");
    await getRevisionDiff("doc/1", 2);
    await listDocumentChunks("doc/1");
    await reindexDocument("doc/1");
    await exportDocument("doc/1");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/web/api/documents/doc%2F1",
      "/web/api/documents/doc%2F1",
      "/web/api/documents/doc%2F1/revisions",
      "/web/api/documents/doc%2F1/revisions/2/diff",
      "/web/api/documents/doc%2F1/chunks",
      "/web/api/documents/doc%2F1/reindex",
      "/web/api/documents/doc%2F1/export",
    ]);
  });

  it("sends the stored admin API key on protected document actions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "doc-1", title: "Updated", content: "Body" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    setStoredAdminApiKey("test-admin-key");

    await updateDocument("doc-1", { title: "Updated" });
    await reindexDocument("doc-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/web/api/documents/doc-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-OpenBrain-Admin-Key": "test-admin-key",
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/web/api/documents/doc-1/reindex",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-OpenBrain-Admin-Key": "test-admin-key",
        }),
      })
    );
  });

});

describe("document export API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
  });

  it("sends the stored admin API key for document export helpers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/export-all")) {
        return new Response(JSON.stringify({ version: 1, exported_at: "2026-06-20T00:00:00Z", documents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("# Exported", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
    });
    setStoredAdminApiKey("test-admin-key");

    await exportDocument("doc-1");
    await exportAllDocuments();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/web/api/documents/doc-1/export",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-OpenBrain-Admin-Key": "test-admin-key" }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/web/api/documents/export-all",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-OpenBrain-Admin-Key": "test-admin-key" }),
      })
    );
  });

});

describe("reflect API helper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
  });

  it("POSTs reflect requests to /reflect without admin credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          query: "what changed?",
          bank_id: "openbrain",
          evidence_count: 0,
          model_used: "gemma4:31b:cloud",
          answer: null,
          reflect_telemetry: {
            model: "gemma4:31b:cloud",
            bank_id: "openbrain",
            mental_model_count: 0,
            observation_count: 0,
            raw_fact_count: 0,
            stale_mental_models: [],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    setStoredAdminApiKey("test-admin-key");

    const payload = {
      query: "what changed?",
      bank_id: "openbrain",
      include_sources: false,
      model_hint: "gemma4:31b:cloud",
    };
    const result = await reflect(payload);

    expect(result.answer).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/web/api/reflect",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty("X-OpenBrain-Admin-Key");
  });
});

describe("provenance graph API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
  });

  it("serializes read-only graph list filters without admin credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    setStoredAdminApiKey("test-admin-key");

    await listMemoryLinks({ bank_id: "openbrain", source_type: "thought", relationship: "evidence_for", inferred: true, limit: 10 });
    await listExperiences({ bank_id: "openbrain", event_type: "decide", project: "one-brain", limit: 5 });
    await listMentalModels({ bank_id: "openbrain", trigger_tag: "privacy", include_inactive: true, limit: 5 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/web/api/memory-links?limit=10&bank_id=openbrain&source_type=thought&relationship=evidence_for&inferred=true", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/web/api/experiences?limit=5&bank_id=openbrain&event_type=decide&project=one-brain", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/web/api/mental-models?limit=5&bank_id=openbrain&trigger_tag=privacy&include_inactive=true", undefined);
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.headers ?? {}).not.toHaveProperty("X-OpenBrain-Admin-Key");
    }
  });

  it("POSTs graph expansion and observation search as read-only JSON requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    setStoredAdminApiKey("test-admin-key");

    const expandPayload = {
      bank_id: "openbrain",
      seeds: [{ source_type: "thought", source_id: "thought-1" }],
      direction: "both" as const,
      relationship: "evidence_for",
      limit: 5,
    };
    const searchPayload = { query: "privacy constraints", bank_id: "openbrain", project: "one-brain", limit: 3, threshold: 0.1 };

    await expandMemoryLinks(expandPayload);
    await searchConsolidatedObservations(searchPayload);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/web/api/memory-links/expand",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expandPayload),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/web/api/consolidated-observations/search",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchPayload),
      })
    );
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.headers).not.toHaveProperty("X-OpenBrain-Admin-Key");
    }
  });
});

describe("memory bank directive API helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
  });

  it("lists directives with filters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ count: 0, directives: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await listMemoryBankDirectives({ bank_id: "openbrain", active: true, applies_to: "reflect", limit: 25 });

    expect(fetchMock).toHaveBeenCalledWith("/web/api/memory-bank-directives?limit=25&bank_id=openbrain&active=true&applies_to=reflect", undefined);
  });

  it("sends admin key for mutating directive helpers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "dir-1", name: "source_boundary" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    setStoredAdminApiKey("test-admin-key");

    await createMemoryBankDirective({ name: "source_boundary", rule_text: "Preserve source boundaries." });
    await updateMemoryBankDirective("dir/1", { priority: 2 });
    await deleteMemoryBankDirective("dir/1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/web/api/memory-bank-directives",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-OpenBrain-Admin-Key": "test-admin-key",
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/web/api/memory-bank-directives/dir%2F1",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-OpenBrain-Admin-Key": "test-admin-key",
        }),
        body: JSON.stringify({ priority: 2 }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/web/api/memory-bank-directives/dir%2F1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-OpenBrain-Admin-Key": "test-admin-key" }),
      })
    );
  });
});
