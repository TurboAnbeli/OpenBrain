import { describe, expect, it } from "vitest";

import { buildDocumentUpdatePayload, buildLineDiffRows, createDocumentDraft, isDocumentDraftDirty } from "./editorState";
import type { DocumentDetail } from "./types";

const document: DocumentDetail = {
  id: "doc-1",
  title: "Original title",
  source_type: "note",
  source_uri: null,
  content: "alpha\nbeta",
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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("document editor state", () => {
  it("creates a clean draft and detects title/content edits", () => {
    const draft = createDocumentDraft(document);
    expect(draft).toEqual({ title: "Original title", content: "alpha\nbeta", editReason: "" });
    expect(isDocumentDraftDirty(document, draft)).toBe(false);

    expect(isDocumentDraftDirty(document, { ...draft, content: "alpha\nbeta\ngamma" })).toBe(true);
    expect(isDocumentDraftDirty(document, { ...draft, title: "Renamed" })).toBe(true);
  });

  it("builds a PATCH payload with trimmed title and default edit reason", () => {
    const payload = buildDocumentUpdatePayload({ title: "  Renamed  ", content: "alpha\nbeta\ngamma", editReason: "" });

    expect(payload).toEqual({
      title: "Renamed",
      content: "alpha\nbeta\ngamma",
      edit_reason: "Updated from OpenBrain web editor",
      updated_by: "openbrain-web",
    });
  });

  it("builds line-level diff rows for revision preview", () => {
    const rows = buildLineDiffRows("alpha\nbeta\ndelta", "alpha\nbeta\ngamma");

    expect(rows.map((row) => [row.kind, row.text])).toEqual([
      ["unchanged", "alpha"],
      ["unchanged", "beta"],
      ["removed", "delta"],
      ["added", "gamma"],
    ]);
  });
});
