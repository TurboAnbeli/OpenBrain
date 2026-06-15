import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DocumentIntent, DocumentKind } from "../db/queries.js";

export interface MarkdownSourceFile {
  path: string;
  content: string;
}

export interface ParsedMarkdownDocument {
  title: string;
  content: string;
  source_uri: string;
  metadata: Record<string, unknown>;
  project?: string;
}

export interface MarkdownChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export interface MarkdownImportChunk {
  content: string;
  metadata: Record<string, unknown>;
  token_count: number;
  char_start: number;
  char_end: number;
}

export interface MarkdownImportOptions {
  files: MarkdownSourceFile[];
  apiBaseUrl: string;
  project?: string;
  sourceType?: string;
  createdBy?: string;
  apply?: boolean;
  maxChars?: number;
  overlapChars?: number;
  skipExisting?: boolean;
  fetcher?: typeof fetch;
}

export type MarkdownImportStatus = "planned" | "skipped_existing" | "skipped_empty" | "applied";

export interface MarkdownImportDocumentPlan extends ParsedMarkdownDocument {
  source_type: string;
  created_by: string;
  bank_id: string;
  document_kind: DocumentKind;
  session_id?: string;
  task_id?: string;
  intent: DocumentIntent;
  event_started_at?: string;
  event_ended_at?: string;
  chunks: MarkdownImportChunk[];
  status: MarkdownImportStatus;
  document_id?: string;
  existing_document_id?: string;
}

export interface MarkdownImportSummary {
  total: number;
  planned: number;
  skipped_existing: number;
  skipped_empty: number;
  applied: number;
}

export interface MarkdownImportPlan {
  apply: boolean;
  apiBaseUrl: string;
  summary: MarkdownImportSummary;
  documents: MarkdownImportDocumentPlan[];
}

export interface ParitySearchResult {
  title?: string;
  document_title?: string;
  path?: string;
  source_uri?: string;
  document_source_uri?: string;
  score?: number;
}

export interface ParityQueryResult {
  query: string;
  openbrain: ParitySearchResult[];
  ryel: ParitySearchResult[];
  overlap: number;
}

export interface ParityReport {
  summary: { query_count: number; overlap_at_5: number };
  queries: ParityQueryResult[];
}

function fileUri(filePath: string): string {
  return `file://${filePath}`;
}

const DOCUMENT_KIND_VALUES: DocumentKind[] = [
  "article",
  "handoff",
  "decision",
  "reflection",
  "research",
  "postmortem",
  "reference",
  "project_note",
  "journal",
  "clipping",
];
const DOCUMENT_INTENT_VALUES: DocumentIntent[] = [
  "durable_knowledge",
  "operational_log",
  "transitional_archive",
];
const DOCUMENT_KIND_SET = new Set<string>(DOCUMENT_KIND_VALUES);
const DOCUMENT_INTENT_SET = new Set<string>(DOCUMENT_INTENT_VALUES);

function optionalString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalDocumentKind(metadata: Record<string, unknown>, key: string): DocumentKind | undefined {
  const value = optionalString(metadata, key);
  return value && DOCUMENT_KIND_SET.has(value) ? value as DocumentKind : undefined;
}

function optionalDocumentIntent(metadata: Record<string, unknown>, key: string): DocumentIntent | undefined {
  const value = optionalString(metadata, key);
  return value && DOCUMENT_INTENT_SET.has(value) ? value as DocumentIntent : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeDateOnly(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return normalizeTimestamp(`${value}T00:00:00.000Z`);
}

function deriveDocumentKind(filePath: string, metadata: Record<string, unknown>): DocumentKind {
  const explicitKind = optionalDocumentKind(metadata, "document_kind") ?? optionalDocumentKind(metadata, "type");
  if (explicitKind) return explicitKind;

  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalizedPath);

  if (normalizedPath.includes("/agent-notes/general/") && basename.includes("handoff")) return "handoff";
  if (normalizedPath.includes("/agent-notes/decision/")) return "decision";
  if (normalizedPath.includes("/agent-notes/reflections/")) return "reflection";
  if (normalizedPath.includes("/agent-notes/research/")) return "research";
  if (normalizedPath.includes("/agent-notes/postmortem/")) return "postmortem";
  if (normalizedPath.includes("/agent-notes/reference/")) return "reference";
  if (normalizedPath.includes("/journal/")) return "journal";
  if (normalizedPath.includes("/clippings/")) return "clipping";
  if (normalizedPath.includes("/projects/")) return "project_note";
  if (normalizedPath.includes("/raw/processed/")) return "article";
  if (normalizedPath.includes("/agent-notes/general/")) return "project_note";
  return "article";
}

function deriveDocumentIntent(
  filePath: string,
  metadata: Record<string, unknown>,
  documentKind: DocumentKind
): DocumentIntent {
  const explicitIntent = optionalDocumentIntent(metadata, "intent");
  if (explicitIntent) return explicitIntent;

  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  if (normalizedPath.includes("/clippings/") || normalizedPath.includes("/raw/processed/")) {
    return "transitional_archive";
  }
  if (documentKind === "handoff" || documentKind === "journal" || normalizedPath.includes("/agent-notes/general/")) {
    return "operational_log";
  }
  return "durable_knowledge";
}

function deriveEventStartedAt(filePath: string, metadata: Record<string, unknown>): string | undefined {
  const explicit = normalizeTimestamp(metadata.event_started_at);
  if (explicit) return explicit;

  const dateField = optionalString(metadata, "date");
  if (dateField) {
    const normalized = normalizeDateOnly(dateField) ?? normalizeTimestamp(dateField);
    if (normalized) return normalized;
  }

  const basenameDate = path.basename(filePath).match(/(20\d{2}-\d{2}-\d{2})/);
  if (basenameDate?.[1]) {
    return normalizeDateOnly(basenameDate[1]);
  }
  return undefined;
}

function deriveDocumentSemantics(filePath: string, metadata: Record<string, unknown>) {
  const document_kind = deriveDocumentKind(filePath, metadata);
  return {
    bank_id: optionalString(metadata, "bank_id") ?? "openbrain",
    document_kind,
    session_id: optionalString(metadata, "session_id"),
    task_id: optionalString(metadata, "task_id"),
    intent: deriveDocumentIntent(filePath, metadata, document_kind),
    event_started_at: deriveEventStartedAt(filePath, metadata),
    event_ended_at: normalizeTimestamp(metadata.event_ended_at),
  };
}

async function walkMarkdownFiles(input: string): Promise<string[]> {
  const info = await stat(input);
  if (info.isFile()) {
    return input.endsWith(".md") ? [input] : [];
  }
  if (!info.isDirectory()) return [];
  const entries = await readdir(input, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(input, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(child));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(child);
    }
  }
  return files;
}

export async function expandMarkdownInputs(inputs: string[]): Promise<MarkdownSourceFile[]> {
  const paths = new Set<string>();
  for (const input of inputs) {
    if (input.includes("*")) {
      const dir = input.slice(0, input.indexOf("*")).replace(/\/$/, "") || ".";
      const suffix = input.slice(input.lastIndexOf("*") + 1);
      for (const file of await walkMarkdownFiles(dir)) {
        if (file.endsWith(suffix)) paths.add(file);
      }
    } else {
      for (const file of await walkMarkdownFiles(input)) paths.add(file);
    }
  }
  return Promise.all(
    [...paths].sort().map(async (filePath) => ({
      path: filePath,
      content: await readFile(filePath, "utf8"),
    }))
  );
}

function slugTitleFromFilename(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['\"]|['\"]$/g, "");
}

function parseSimpleFrontmatter(raw: string): { metadata: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---\n")) {
    return { metadata: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 4);
  if (end === -1) {
    return { metadata: {}, body: raw };
  }

  const metadata: Record<string, unknown> = {};
  const lines = raw.slice(4, end).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2] ?? "";
    if (value === "") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]!)) {
        i += 1;
        items.push(lines[i]!.replace(/^\s+-\s+/, "").trim());
      }
      metadata[key] = items;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      metadata[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim().replace(/^['\"]|['\"]$/g, ""))
        .filter(Boolean);
    } else {
      metadata[key] = parseScalar(value);
    }
  }

  const bodyStart = raw.indexOf("\n", end + 4);
  return { metadata, body: bodyStart === -1 ? "" : raw.slice(bodyStart + 1) };
}

export function parseMarkdownDocument(raw: string, filePath: string): ParsedMarkdownDocument {
  const { metadata, body } = parseSimpleFrontmatter(raw);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const frontmatterTitle = typeof metadata.title === "string" ? metadata.title : undefined;
  const title = frontmatterTitle || heading || slugTitleFromFilename(filePath);
  const project = typeof metadata.project === "string" ? metadata.project : undefined;

  return {
    title,
    content: body.trim(),
    source_uri: fileUri(filePath),
    metadata,
    project,
  };
}

function headingForOffset(content: string, offset: number): string {
  const before = content.slice(0, offset);
  const headings = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)];
  return headings.at(-1)?.[1]?.trim() || "root";
}

function estimateTokens(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

export function chunkMarkdown(content: string, options: MarkdownChunkOptions = {}): MarkdownImportChunk[] {
  const maxChars = options.maxChars ?? 1600;
  const overlapChars = Math.min(options.overlapChars ?? 160, Math.max(0, maxChars - 1));
  const normalized = content.trim();
  if (!normalized) return [];

  const chunks: MarkdownImportChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const breakAt = Math.max(
        normalized.lastIndexOf("\n\n", end),
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf(" ", end)
      );
      if (breakAt > start + Math.floor(maxChars * 0.5)) {
        end = breakAt + (normalized[breakAt] === "." ? 1 : 0);
      }
    }

    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        content: chunkText,
        metadata: { heading: headingForOffset(normalized, start) },
        token_count: estimateTokens(chunkText),
        char_start: start,
        char_end: end,
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

function summarize(documents: MarkdownImportDocumentPlan[]): MarkdownImportSummary {
  return {
    total: documents.length,
    planned: documents.filter((doc) => doc.status === "planned").length,
    skipped_existing: documents.filter((doc) => doc.status === "skipped_existing").length,
    skipped_empty: documents.filter((doc) => doc.status === "skipped_empty").length,
    applied: documents.filter((doc) => doc.status === "applied").length,
  };
}

async function lookupExistingDocument(
  apiBaseUrl: string,
  sourceUri: string,
  fetcher: typeof fetch
): Promise<{ id: string } | null> {
  const url = `${apiBaseUrl}/documents/by-source-uri?source_uri=${encodeURIComponent(sourceUri)}`;
  const response = await fetcher(url, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json() as { id: string };
}

export async function buildMarkdownImportManifest(options: MarkdownImportOptions): Promise<MarkdownImportPlan> {
  const sourceType = options.sourceType ?? "markdown";
  const createdBy = options.createdBy ?? "hermes";
  const apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const documents: MarkdownImportDocumentPlan[] = [];

  for (const file of options.files) {
    const parsed = parseMarkdownDocument(file.content, file.path);
    const semantics = deriveDocumentSemantics(file.path, parsed.metadata);
    const chunks = chunkMarkdown(parsed.content, {
      maxChars: options.maxChars,
      overlapChars: options.overlapChars,
    });
    const doc: MarkdownImportDocumentPlan = {
      ...parsed,
      project: options.project ?? parsed.project,
      source_type: sourceType,
      created_by: createdBy,
      ...semantics,
      chunks,
      status: chunks.length === 0 ? "skipped_empty" : "planned",
    };

    if (doc.status === "skipped_empty") {
      documents.push(doc);
      continue;
    }

    if (options.skipExisting) {
      const existing = await lookupExistingDocument(apiBaseUrl, doc.source_uri, fetcher);
      if (existing) {
        doc.status = "skipped_existing";
        doc.existing_document_id = existing.id;
      }
    }
    documents.push(doc);
  }

  return {
    apply: options.apply === true,
    apiBaseUrl,
    summary: summarize(documents),
    documents,
  };
}

export async function buildMarkdownImportPlan(options: MarkdownImportOptions): Promise<MarkdownImportPlan> {
  return buildMarkdownImportManifest(options);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return parsed as T;
}

export async function applyMarkdownImport(options: MarkdownImportOptions): Promise<MarkdownImportPlan> {
  const plan = await buildMarkdownImportManifest(options);
  if (!options.apply) {
    return plan;
  }

  const fetcher = options.fetcher ?? fetch;
  for (const doc of plan.documents) {
    if (doc.status !== "planned") continue;
    const documentResponse = await fetcher(`${plan.apiBaseUrl}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: doc.title,
        source_type: doc.source_type,
        source_uri: doc.source_uri,
        content: doc.content,
        metadata: doc.metadata,
        project: doc.project,
        created_by: doc.created_by,
        bank_id: doc.bank_id,
        document_kind: doc.document_kind,
        session_id: doc.session_id,
        task_id: doc.task_id,
        intent: doc.intent,
        event_started_at: doc.event_started_at,
        event_ended_at: doc.event_ended_at,
      }),
    });
    const created = await parseJsonResponse<{ id: string }>(documentResponse);
    doc.document_id = created.id;
    doc.status = "applied";

    await parseJsonResponse(
      await fetcher(`${plan.apiBaseUrl}/documents/${created.id}/chunks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: doc.chunks }),
      })
    );
  }
  plan.summary = summarize(plan.documents);

  return plan;
}

function resultKey(result: ParitySearchResult): string {
  const uri = result.source_uri ?? result.document_source_uri;
  if (uri) return uri.replace(/^file:\/\//, "");
  if (result.path) return result.path;
  return result.document_title ?? result.title ?? "";
}

export async function evaluateImportParity(options: {
  queries: string[];
  apiBaseUrl: string;
  project?: string;
  sourceType?: string;
  fetcher?: typeof fetch;
  ryelSearch: (query: string) => Promise<ParitySearchResult[]>;
}): Promise<ParityReport> {
  const fetcher = options.fetcher ?? fetch;
  const apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
  const queries: ParityQueryResult[] = [];

  for (const query of options.queries) {
    const response = await fetcher(`${apiBaseUrl}/documents/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        mode: "hybrid",
        limit: 5,
        project: options.project,
        source_type: options.sourceType,
      }),
    });
    const openBrainPayload = await parseJsonResponse<{ results: ParitySearchResult[] }>(response);
    const ryel = await options.ryelSearch(query);
    const openKeys = new Set(openBrainPayload.results.slice(0, 5).map(resultKey));
    const overlap = ryel.slice(0, 5).filter((result) => openKeys.has(resultKey(result))).length;
    queries.push({ query, openbrain: openBrainPayload.results, ryel, overlap });
  }

  return {
    summary: {
      query_count: queries.length,
      overlap_at_5: queries.reduce((sum, item) => sum + item.overlap, 0),
    },
    queries,
  };
}
