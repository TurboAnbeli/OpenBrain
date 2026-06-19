import type { DocumentChunk, DocumentDetail, DocumentRevision, DocumentSummary, RevisionDiff, UpdateDocumentInput } from "./types";

const API_BASE = import.meta.env.VITE_OPENBRAIN_API_URL ?? "/web/api";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
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

export function updateDocument(id: string, payload: UpdateDocumentInput) {
  return requestJson<DocumentDetail>(`/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

export interface ReindexResult {
  reindexed: boolean;
  chunk_count?: number;
  id: string;
  title: string;
  updated_at: string;
}

export function reindexDocument(id: string) {
  return requestJson<ReindexResult>(`/documents/${id}/reindex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export interface UploadResult {
  reindexed: boolean;
  chunk_count?: number;
  id: string;
  title: string;
  source_uri: string | null;
  content: string;
  updated_at: string;
}

export function uploadDocument(file: File, project?: string, createdBy?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (project) formData.append("project", project);
  if (createdBy) formData.append("created_by", createdBy);
  return requestJson<UploadResult>("/documents/upload", { method: "POST", body: formData });
}

export function importUrlDocument(url: string, title?: string, project?: string, createdBy?: string) {
  return requestJson<UploadResult>("/documents/import-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title, project, created_by: createdBy }),
  });
}
