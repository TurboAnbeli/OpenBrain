import type { DocumentDetail, UpdateDocumentInput } from "./types";

export interface DocumentDraft {
  title: string;
  content: string;
  editReason: string;
}

export type LineDiffKind = "unchanged" | "added" | "removed";

export interface LineDiffRow {
  kind: LineDiffKind;
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export function createDocumentDraft(document: DocumentDetail): DocumentDraft {
  return {
    title: document.title,
    content: document.content,
    editReason: "",
  };
}

export function isDocumentDraftDirty(document: DocumentDetail, draft: DocumentDraft): boolean {
  return document.title !== draft.title || document.content !== draft.content;
}

export function buildDocumentUpdatePayload(draft: DocumentDraft, updatedBy = "openbrain-web"): UpdateDocumentInput {
  return {
    title: draft.title.trim(),
    content: draft.content,
    edit_reason: draft.editReason.trim() || "Updated from OpenBrain web editor",
    updated_by: updatedBy,
  };
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.split(/\r?\n/);
}

export function buildLineDiffRows(previousContent: string, currentContent: string): LineDiffRow[] {
  const previous = splitLines(previousContent);
  const current = splitLines(currentContent);
  const lcs: number[][] = Array.from({ length: previous.length + 1 }, () => new Array<number>(current.length + 1).fill(0));

  for (let i = previous.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      lcs[i]![j] = previous[i] === current[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
    }
  }

  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < previous.length && j < current.length) {
    const previousLine = previous[i] ?? "";
    const currentLine = current[j] ?? "";
    if (previousLine === currentLine) {
      rows.push({ kind: "unchanged", text: previousLine, oldLineNumber: i + 1, newLineNumber: j + 1 });
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      rows.push({ kind: "removed", text: previousLine, oldLineNumber: i + 1, newLineNumber: null });
      i += 1;
    } else {
      rows.push({ kind: "added", text: currentLine, oldLineNumber: null, newLineNumber: j + 1 });
      j += 1;
    }
  }
  while (i < previous.length) {
    rows.push({ kind: "removed", text: previous[i] ?? "", oldLineNumber: i + 1, newLineNumber: null });
    i += 1;
  }
  while (j < current.length) {
    rows.push({ kind: "added", text: current[j] ?? "", oldLineNumber: null, newLineNumber: j + 1 });
    j += 1;
  }

  return rows;
}
