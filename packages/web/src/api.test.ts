import { afterEach, describe, expect, it, vi } from "vitest";

import { reindexDocument, setStoredAdminApiKey, updateDocument } from "./api";

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
