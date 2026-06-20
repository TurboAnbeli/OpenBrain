import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryBankDirective, deleteMemoryBankDirective, listMemoryBankDirectives, reflect, reindexDocument, setStoredAdminApiKey, updateDocument, updateMemoryBankDirective } from "./api";

describe("updateDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setStoredAdminApiKey("");
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
