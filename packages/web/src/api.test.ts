import { afterEach, describe, expect, it, vi } from "vitest";

import { updateDocument } from "./api";

describe("updateDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
