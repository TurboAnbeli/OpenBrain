import type { DocumentChunk, DocumentDetail, DocumentRevision, DocumentSummary, RevisionDiff } from "./types";

const API_BASE = import.meta.env.VITE_OPENBRAIN_API_URL ?? "/web/api";

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export interface DocumentListFilters {
  q?: string;
  project?: string;
  source_type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function listDocuments(filters: DocumentListFilters) {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 25));
  params.set("offset", String(filters.offset ?? 0));
  for (const key of ["q", "project", "source_type", "status"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return requestJson<{ count: number; limit: number; offset: number; documents: DocumentSummary[] }>(`/documents?${params.toString()}`);
}

export function getDocument(id: string) {
  return requestJson<DocumentDetail>(`/documents/${id}`);
}

export function listDocumentRevisions(id: string) {
  return requestJson<{ document_id: string; count: number; revisions: DocumentRevision[] }>(`/documents/${id}/revisions`);
}

export function getRevisionDiff(id: string, revisionNumber: number) {
  return requestJson<{ document_id: string; revision_number: number; revision: DocumentRevision; current: DocumentDetail; diff: RevisionDiff }>(
    `/documents/${id}/revisions/${revisionNumber}/diff`
  );
}

export function listDocumentChunks(id: string) {
  return requestJson<{ document_id: string; count: number; chunks: DocumentChunk[] }>(`/documents/${id}/chunks`);
}
