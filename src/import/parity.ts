import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateImportParity, type ParityReport, type ParitySearchResult } from "./markdown.js";

export interface LocalRyelMarkdownSearchOptions {
  root: string;
  limit?: number;
}

export interface ParityRunOptions {
  queries: string[];
  apiBaseUrl: string;
  project?: string;
  sourceType?: string;
  fetcher?: typeof fetch;
  ryelSearch: (query: string) => Promise<ParitySearchResult[]>;
}

export function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&").replace(/\n/g, "\\n")}"`;
}


export async function loadParityQueries(filePath: string): Promise<string[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const queries = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { queries?: unknown }).queries)
      ? (parsed as { queries: unknown[] }).queries
      : null;
  if (!queries) {
    throw new Error("Query file must be a JSON array of strings or an object with a queries array");
  }
  return queries.map((query) => String(query).trim()).filter(Boolean);
}

async function walkMarkdown(root: string): Promise<string[]> {
  const info = await stat(root);
  if (info.isFile()) return root.endsWith(".md") ? [root] : [];
  if (!info.isDirectory()) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(child));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(child);
  }
  return files;
}

function titleFromMarkdown(content: string, filePath: string): string {
  const frontmatterTitle = content.match(/^---\n[\s\S]*?^title:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
  if (frontmatterTitle) return frontmatterTitle;
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(filePath, path.extname(filePath)).replace(/[_-]+/g, " ");
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_.-]+/g) ?? [];
}

function lexicalScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const textTokens = new Set(tokenize(text));
  const hits = queryTokens.filter((token) => textTokens.has(token)).length;
  const phraseBoost = text.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
  return (hits / queryTokens.length) + phraseBoost;
}

export function createLocalRyelMarkdownSearch(options: LocalRyelMarkdownSearchOptions): (query: string) => Promise<ParitySearchResult[]> {
  const limit = options.limit ?? 5;
  return async (query: string): Promise<ParitySearchResult[]> => {
    const files = await walkMarkdown(options.root);
    const scored: ParitySearchResult[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const score = lexicalScore(query, `${file}\n${content}`);
      if (score <= 0) continue;
      scored.push({
        title: titleFromMarkdown(content, file),
        path: file,
        source_uri: `file://${file}`,
        score,
      });
    }
    return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
  };
}

export async function runParityReport(options: ParityRunOptions): Promise<ParityReport> {
  return evaluateImportParity(options);
}

export async function writeParityReport(filePath: string, report: ParityReport): Promise<void> {
  await writeFile(filePath, JSON.stringify(report, null, 2) + "\n");
}
