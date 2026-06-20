import type { DocumentChunk, DocumentDetail, DocumentRevision, DocumentSummary, RevisionDiff, UpdateDocumentInput } from "./types";

const API_BASE = import.meta.env.VITE_OPENBRAIN_API_URL ?? "/web/api";

const ADMIN_API_KEY_STORAGE_KEY = "openbrain.admin_api_key";
const LEGACY_ADMIN_API_KEY_STORAGE_KEYS = ["openbrain" + "_admin_api_" + "key"];
let adminApiKeyFallback: string | undefined;

export function getStoredAdminApiKey(): string | undefined {
  try {
    const storage = globalThis.sessionStorage;
    const stored = storage?.getItem(ADMIN_API_KEY_STORAGE_KEY)?.trim();
    if (stored) return stored;
    for (const legacyKey of LEGACY_ADMIN_API_KEY_STORAGE_KEYS) {
      const legacy = storage?.getItem(legacyKey)?.trim();
      if (legacy) {
        storage?.setItem(ADMIN_API_KEY_STORAGE_KEY, legacy);
        storage?.removeItem(legacyKey);
        return legacy;
      }
    }
  } catch {
    // sessionStorage may be unavailable in tests, SSR, or hardened browser contexts.
  }
  return adminApiKeyFallback;
}

export function setStoredAdminApiKey(key: string): void {
  const trimmed = key.trim();
  adminApiKeyFallback = trimmed || undefined;
  try {
    const storage = globalThis.sessionStorage;
    for (const legacyKey of LEGACY_ADMIN_API_KEY_STORAGE_KEYS) storage?.removeItem(legacyKey);
    if (trimmed) {
      storage?.setItem(ADMIN_API_KEY_STORAGE_KEY, trimmed);
    } else {
      storage?.removeItem(ADMIN_API_KEY_STORAGE_KEY);
    }
  } catch {
    // Keep the in-memory fallback so non-browser tests still exercise header wiring.
  }
}

function adminHeaders(base: Record<string, string> = {}): Record<string, string> {
  const key = getStoredAdminApiKey();
  return key ? { ...base, "X-OpenBrain-Admin-Key": key } : base;
}

function pathId(id: string): string {
  return encodeURIComponent(id);
}


export async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  return new Error(response.status + " " + response.statusText + ": " + text);
}

export async function assertOkResponse(response: Response): Promise<void> {
  if (!response.ok) throw await responseError(response);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API_BASE + path, init);
  await assertOkResponse(response);
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
  return requestJson<DocumentDetail>("/documents/" + pathId(id));
}

export function updateDocument(id: string, payload: UpdateDocumentInput) {
  return requestJson<DocumentDetail>("/documents/" + pathId(id), {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

export function listDocumentRevisions(id: string) {
  return requestJson<{ document_id: string; count: number; revisions: DocumentRevision[] }>("/documents/" + pathId(id) + "/revisions");
}

export function getRevisionDiff(id: string, revisionNumber: number) {
  return requestJson<{ document_id: string; revision_number: number; revision: DocumentRevision; current: DocumentDetail; diff: RevisionDiff }>(
    "/documents/" + pathId(id) + "/revisions/" + revisionNumber + "/diff"
  );
}

export function listDocumentChunks(id: string) {
  return requestJson<{ document_id: string; count: number; chunks: DocumentChunk[] }>("/documents/" + pathId(id) + "/chunks");
}

export interface ReindexResult {
  reindexed: boolean;
  chunk_count?: number;
  id: string;
  title: string;
  updated_at: string;
}

export function reindexDocument(id: string) {
  return requestJson<ReindexResult>("/documents/" + pathId(id) + "/reindex", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
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
  return requestJson<UploadResult>("/documents/upload", { method: "POST", headers: adminHeaders(), body: formData });
}

export function importUrlDocument(url: string, title?: string, project?: string, createdBy?: string) {
  return requestJson<UploadResult>("/documents/import-url", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url, title, project, created_by: createdBy }),
  });
}

export interface ReflectRequest {
  query: string;
  bank_id?: string;
  project?: string;
  created_by?: string;
  model_hint?: string;
  top_k?: number;
  threshold?: number;
  include_sources?: boolean;
}

export interface ReflectTelemetry {
  model: string;
  bank_id: string;
  embedding_ms?: number;
  search_ms?: number;
  llm_ms?: number;
  total_ms?: number;
  mental_model_count: number;
  observation_count: number;
  raw_fact_count: number;
  stale_mental_models: string[];
  [key: string]: unknown;
}

export interface ReflectMemoryBankDirective {
  id: string;
  name: string;
  severity: string;
  priority: number;
}

export interface ReflectMemoryBank {
  id: string;
  name: string;
  mission: string | null;
  disposition: unknown;
  directives: ReflectMemoryBankDirective[];
}

export interface ReflectMentalModel {
  id: string;
  name?: string;
  query?: string;
  content: string;
  structured?: unknown;
  tags?: string[];
  trigger_tags?: string[];
  priority?: number;
  refresh_meta?: unknown;
  stale?: boolean;
  project?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  similarity?: number;
}

export interface ReflectObservation {
  id: string;
  content: string;
  proof_count?: number;
  tags?: string[];
  trend?: string | null;
  project?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  similarity?: number;
  stale?: boolean;
}

export interface ReflectRawFact {
  id: string;
  content: string;
  type?: string;
  topics?: string[];
  project?: string | null;
  created_at?: string | null;
  similarity?: number;
  stale?: boolean;
}

export interface ReflectCascadeItem {
  id: string;
  label?: string | null;
  content: string;
}

export interface ReflectResponse {
  query: string;
  bank_id: string;
  evidence_count: number;
  model_used: string;
  answer: string | null;
  reflect_telemetry: ReflectTelemetry;
  cascade?: {
    mental_models: ReflectCascadeItem[];
    consolidated_observations: ReflectCascadeItem[];
    raw_facts: ReflectCascadeItem[];
  };
  mental_models?: ReflectMentalModel[];
  observations?: ReflectObservation[];
  raw_facts?: ReflectRawFact[];
  memory_bank?: ReflectMemoryBank | null;
}

export function reflect(payload: ReflectRequest) {
  return requestJson<ReflectResponse>("/reflect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface MemoryLink {
  id: string;
  bank_id: string;
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship: string;
  weight: number;
  inferred: boolean;
  created_at: string | null;
}

export interface MemoryLinkFilters {
  bank_id?: string;
  source_type?: string;
  source_id?: string;
  target_type?: string;
  target_id?: string;
  relationship?: string;
  inferred?: boolean;
  limit?: number;
}

export interface Experience {
  id: string;
  bank_id: string;
  session_id: string | null;
  agent_id: string | null;
  occurred_at: string | null;
  event_type: string;
  content: string;
  refs: Record<string, unknown>;
  project: string | null;
  created_by: string | null;
  created_at: string | null;
  similarity?: number;
  stale?: boolean;
}

export interface ExperienceFilters {
  bank_id?: string;
  session_id?: string;
  agent_id?: string;
  event_type?: string;
  project?: string;
  created_by?: string;
  limit?: number;
}

export interface MentalModel {
  id: string;
  bank_id: string;
  name: string;
  query: string;
  content: string;
  structured: unknown;
  tags: string[];
  trigger_tags: string[];
  priority: number;
  refresh_meta: unknown;
  history: unknown[];
  active: boolean;
  project: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  similarity?: number;
  stale?: boolean;
}

export interface MentalModelFilters {
  bank_id?: string;
  project?: string;
  created_by?: string;
  trigger_tag?: string;
  include_inactive?: boolean;
  limit?: number;
}

export interface ConsolidatedObservationSourceQuote {
  source_id?: string;
  source_type?: string;
  quote?: string;
  [key: string]: unknown;
}

export interface ConsolidatedObservation {
  id: string;
  bank_id: string;
  content: string;
  proof_count: number;
  source_memory_ids: string[];
  source_quotes: ConsolidatedObservationSourceQuote[];
  tags: string[];
  history: unknown[];
  trend: string | null;
  trend_computed_at: string | null;
  project: string | null;
  created_by: string | null;
  archived: boolean;
  created_at: string | null;
  updated_at: string | null;
  similarity?: number;
  stale?: boolean;
}

export interface ObservationSearchPayload {
  query: string;
  bank_id?: string;
  project?: string;
  created_by?: string;
  limit?: number;
  threshold?: number;
}

export interface MemorySeed {
  source_type: string;
  source_id: string;
}

export interface MemoryLinkExpansionPayload {
  bank_id?: string;
  seeds: MemorySeed[];
  direction?: "incoming" | "outgoing" | "both";
  relationship?: string;
  include_archived?: boolean;
  limit?: number;
}

export interface LinkedMemorySummary {
  source_type: string;
  id: string;
  content: string | null;
  title: string | null;
  metadata: Record<string, unknown>;
  project: string | null;
  created_at: string | null;
}

export interface MemoryLinkExpansionResult {
  link: MemoryLink;
  seed: MemorySeed;
  direction: "incoming" | "outgoing" | "both";
  linked_memory: LinkedMemorySummary | null;
}

function appendDefined(params: URLSearchParams, key: string, value: string | number | boolean | undefined): void {
  if (value !== undefined && value !== "") params.set(key, String(value));
}

export function listMemoryLinks(filters: MemoryLinkFilters = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 25));
  appendDefined(params, "bank_id", filters.bank_id);
  appendDefined(params, "source_type", filters.source_type);
  appendDefined(params, "source_id", filters.source_id);
  appendDefined(params, "target_type", filters.target_type);
  appendDefined(params, "target_id", filters.target_id);
  appendDefined(params, "relationship", filters.relationship);
  appendDefined(params, "inferred", filters.inferred);
  return requestJson<{ count: number; results: MemoryLink[] }>(`/memory-links?${params.toString()}`);
}

export function expandMemoryLinks(payload: MemoryLinkExpansionPayload) {
  return requestJson<{ count: number; results: MemoryLinkExpansionResult[] }>("/memory-links/expand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listExperiences(filters: ExperienceFilters = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 25));
  appendDefined(params, "bank_id", filters.bank_id);
  appendDefined(params, "session_id", filters.session_id);
  appendDefined(params, "agent_id", filters.agent_id);
  appendDefined(params, "event_type", filters.event_type);
  appendDefined(params, "project", filters.project);
  appendDefined(params, "created_by", filters.created_by);
  return requestJson<{ count: number; results: Experience[] }>(`/experiences?${params.toString()}`);
}

export function listMentalModels(filters: MentalModelFilters = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 25));
  appendDefined(params, "bank_id", filters.bank_id);
  appendDefined(params, "project", filters.project);
  appendDefined(params, "created_by", filters.created_by);
  appendDefined(params, "trigger_tag", filters.trigger_tag);
  appendDefined(params, "include_inactive", filters.include_inactive);
  return requestJson<{ count: number; results: MentalModel[] }>(`/mental-models?${params.toString()}`);
}

export function searchConsolidatedObservations(payload: ObservationSearchPayload) {
  return requestJson<{ count: number; results: ConsolidatedObservation[] }>("/consolidated-observations/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface MemoryBankDirective {
  id: string;
  bank_id: string;
  name: string;
  rule_text: string;
  applies_to: string[];
  severity: string;
  active: boolean;
  priority: number;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface MemoryBankDirectiveFilters {
  bank_id?: string;
  active?: boolean;
  applies_to?: string;
  severity?: string;
  limit?: number;
}

export interface MemoryBankDirectiveInput {
  bank_id?: string;
  name: string;
  rule_text: string;
  applies_to?: string[];
  severity?: string;
  active?: boolean;
  priority?: number;
  revision?: number;
}

export interface MemoryBankDirectiveUpdateInput {
  bank_id?: string;
  name?: string;
  rule_text?: string;
  applies_to?: string[];
  severity?: string;
  active?: boolean;
  priority?: number;
}

export function listMemoryBankDirectives(filters: MemoryBankDirectiveFilters = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? 50));
  if (filters.bank_id) params.set("bank_id", filters.bank_id);
  if (filters.active !== undefined) params.set("active", String(filters.active));
  if (filters.applies_to) params.set("applies_to", filters.applies_to);
  if (filters.severity) params.set("severity", filters.severity);
  return requestJson<{ count: number; directives: MemoryBankDirective[] }>(`/memory-bank-directives?${params.toString()}`);
}

export function getMemoryBankDirective(id: string) {
  return requestJson<MemoryBankDirective>(`/memory-bank-directives/${encodeURIComponent(id)}`);
}

export function createMemoryBankDirective(payload: MemoryBankDirectiveInput) {
  return requestJson<MemoryBankDirective>("/memory-bank-directives", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

export function updateMemoryBankDirective(id: string, payload: MemoryBankDirectiveUpdateInput) {
  return requestJson<MemoryBankDirective>(`/memory-bank-directives/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

export function deleteMemoryBankDirective(id: string) {
  return requestJson<MemoryBankDirective>(`/memory-bank-directives/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
}

export interface MentalModelUpdateInput {
  name?: string;
  query?: string;
  content?: string;
  structured?: Record<string, unknown>;
  tags?: string[];
  trigger_tags?: string[];
  priority?: number;
  refresh_meta?: Record<string, unknown>;
  history?: unknown[];
  active?: boolean;
  project?: string | null;
  created_by?: string | null;
}

export function updateMentalModel(id: string, payload: MentalModelUpdateInput) {
  return requestJson<MentalModel>(`/mental-models/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

export interface ConsolidatedObservationUpdateInput {
  content?: string;
  proof_count?: number;
  source_memory_ids?: string[];
  source_quotes?: Record<string, string>;
  tags?: string[];
  history?: unknown[];
  trend?: string | null;
  trend_computed_at?: string | null;
  project?: string | null;
  archived?: boolean;
  edit_reason?: string;
}

export function updateConsolidatedObservation(id: string, payload: ConsolidatedObservationUpdateInput) {
  return requestJson<ConsolidatedObservation>(`/consolidated-observations/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
}

export interface EmbedderInfo {
  provider: string;
  model: string;
  dimension: number;
  reindex_required: boolean;
  total_chunks: number;
  chunks_with_known_version: number;
  chunks_with_unknown_version: number;
}

export function getEmbedderInfo() {
  return requestJson<EmbedderInfo>("/embedder/info");
}

export interface ExportAllBundle {
  version: number;
  exported_at: string;
  documents: DocumentSummary[];
}

export function exportDocument(id: string): Promise<Response> {
  return fetch(API_BASE + "/documents/" + pathId(id) + "/export", { headers: adminHeaders() });
}

export function exportAllDocuments(): Promise<ExportAllBundle> {
  return requestJson<ExportAllBundle>("/documents/export-all", { headers: adminHeaders() });
}
