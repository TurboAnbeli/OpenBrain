import path from "node:path";

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
  fetcher?: typeof fetch;
}

export interface MarkdownImportDocumentPlan extends ParsedMarkdownDocument {
  source_type: string;
  created_by: string;
  chunks: MarkdownImportChunk[];
  document_id?: string;
}

export interface MarkdownImportPlan {
  apply: boolean;
  apiBaseUrl: string;
  documents: MarkdownImportDocumentPlan[];
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
    source_uri: `file://${filePath}`,
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

export async function buildMarkdownImportPlan(options: MarkdownImportOptions): Promise<MarkdownImportPlan> {
  const sourceType = options.sourceType ?? "markdown";
  const createdBy = options.createdBy ?? "hermes";
  const documents = options.files.map((file) => {
    const parsed = parseMarkdownDocument(file.content, file.path);
    return {
      ...parsed,
      project: options.project ?? parsed.project,
      source_type: sourceType,
      created_by: createdBy,
      chunks: chunkMarkdown(parsed.content, {
        maxChars: options.maxChars,
        overlapChars: options.overlapChars,
      }),
    };
  });

  return {
    apply: options.apply === true,
    apiBaseUrl: options.apiBaseUrl.replace(/\/$/, ""),
    documents,
  };
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
  const plan = await buildMarkdownImportPlan(options);
  if (!options.apply) {
    return plan;
  }

  const fetcher = options.fetcher ?? fetch;
  for (const doc of plan.documents) {
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
      }),
    });
    const created = await parseJsonResponse<{ id: string }>(documentResponse);
    doc.document_id = created.id;

    await parseJsonResponse(
      await fetcher(`${plan.apiBaseUrl}/documents/${created.id}/chunks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: doc.chunks }),
      })
    );
  }

  return plan;
}
