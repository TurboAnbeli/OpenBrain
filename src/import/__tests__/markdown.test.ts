import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  applyMarkdownImport,
  buildMarkdownImportPlan,
  buildMarkdownImportManifest,
  evaluateImportParity,
  expandMarkdownInputs,
  chunkMarkdown,
  parseMarkdownDocument,
  type MarkdownImportChunk,
} from "../markdown.js";

describe("markdown document import", () => {
  const source = `---
title: One Brain Architecture
tags:
  - ai
  - retrieval
project: one-brain
---

# One Brain Architecture

OpenBrain should become the canonical database-first memory store.

## Details

Ry-El markdown remains transitional while documents and chunks move into PostgreSQL.
`;

  it("parses markdown frontmatter, title, tags, and body", () => {
    const parsed = parseMarkdownDocument(source, "/vault/wiki/one_brain.md");

    expect(parsed.title).toBe("One Brain Architecture");
    expect(parsed.project).toBe("one-brain");
    expect(parsed.metadata.tags).toEqual(["ai", "retrieval"]);
    expect(parsed.source_uri).toBe("file:///vault/wiki/one_brain.md");
    expect(parsed.content).toContain("OpenBrain should become");
    expect(parsed.content).not.toContain("title: One Brain Architecture");
  });

  it("falls back to first heading or filename when frontmatter title is absent", () => {
    expect(parseMarkdownDocument("# Heading Title\n\nBody", "/tmp/note.md").title).toBe("Heading Title");
    expect(parseMarkdownDocument("Body only", "/tmp/file_name.md").title).toBe("file name");
  });

  it("chunks markdown into bounded chunks with offsets and metadata", () => {
    const chunks = chunkMarkdown("Alpha beta gamma.\n\n## Section\n\nDelta epsilon zeta eta theta.", {
      maxChars: 32,
      overlapChars: 6,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.content.length).toBeLessThanOrEqual(32);
    expect(chunks[0]!.char_start).toBe(0);
    expect(chunks[0]!.metadata.heading).toBe("root");
    expect(chunks.some((chunk: MarkdownImportChunk) => chunk.metadata.heading === "Section")).toBe(true);
  });

  it("builds a dry-run import plan without calling HTTP endpoints", async () => {
    const fetcher = vi.fn();
    const plan = await buildMarkdownImportPlan({
      files: [{ path: "/vault/wiki/one_brain.md", content: source }],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      createdBy: "hermes",
      fetcher,
    });

    expect(plan.apply).toBe(false);
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]!.title).toBe("One Brain Architecture");
    expect(plan.documents[0]!.chunks.length).toBeGreaterThan(0);
    expect(fetcher).not.toHaveBeenCalled();
  });



  it("expands directories and globs into sorted markdown files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-import-"));
    try {
      await mkdir(join(dir, "nested"));
      await writeFile(join(dir, "b.md"), "# B\n\nBody B");
      await writeFile(join(dir, "a.md"), "# A\n\nBody A");
      await writeFile(join(dir, "nested", "c.md"), "# C\n\nBody C");
      await writeFile(join(dir, "ignore.txt"), "ignore");

      const files = await expandMarkdownInputs([dir]);
      expect(files.map((file) => file.path)).toEqual([
        join(dir, "a.md"),
        join(dir, "b.md"),
        join(dir, "nested", "c.md"),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a batch manifest and skips already imported source_uri entries", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes("already.md")) {
        return new Response(JSON.stringify({ id: "existing-doc", source_uri: "file:///vault/wiki/already.md" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    const manifest = await buildMarkdownImportManifest({
      files: [
        { path: "/vault/wiki/already.md", content: "# Already\n\nImported" },
        { path: "/vault/wiki/new.md", content: "# New\n\nFresh" },
      ],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      fetcher,
      skipExisting: true,
    });

    expect(manifest.summary.total).toBe(2);
    expect(manifest.summary.skipped_existing).toBe(1);
    expect(manifest.summary.planned).toBe(1);
    expect(manifest.documents.map((doc) => doc.status)).toEqual(["skipped_existing", "planned"]);
    expect(manifest.documents[0]!.existing_document_id).toBe("existing-doc");
  });

  it("classifies operational, journal, and transitional markdown sources into document semantics", async () => {
    const manifest = await buildMarkdownImportManifest({
      files: [
        {
          path: "/home/ryan/workspace/ryel/agent-notes/general/handoff_20260613_onebrain_complete.md",
          content: "# One Brain Handoff\n\nComplete.",
        },
        {
          path: "/home/ryan/workspace/ryel/journal/2026-04-28.md",
          content: "---\ndate: 2026-04-28\ntype: journal\n---\n\n# Session Log\n\nBody.",
        },
        {
          path: "/home/ryan/workspace/ryel/raw/processed/Hindsight.md",
          content: "# Hindsight\n\nBody.",
        },
      ],
      apiBaseUrl: "http://127.0.0.1:8000",
    });

    expect(manifest.documents[0]).toMatchObject({
      bank_id: "openbrain",
      document_kind: "handoff",
      intent: "operational_log",
    });
    expect(manifest.documents[1]).toMatchObject({
      bank_id: "openbrain",
      document_kind: "journal",
      intent: "operational_log",
      event_started_at: "2026-04-28T00:00:00.000Z",
    });
    expect(manifest.documents[2]).toMatchObject({
      bank_id: "openbrain",
      document_kind: "article",
      intent: "transitional_archive",
    });
  });

  it("apply mode imports only non-skipped manifest entries", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url);
      calls.push(`${init?.method ?? "GET"} ${text}`);
      if (text.includes("already.md")) {
        return new Response(JSON.stringify({ id: "existing-doc", source_uri: "file:///vault/wiki/already.md" }), { status: 200 });
      }
      if (init?.method === "GET") {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      if (text.endsWith("/documents")) {
        return new Response(JSON.stringify({ id: "new-doc" }), { status: 200 });
      }
      return new Response(JSON.stringify({ count: 1 }), { status: 200 });
    });

    const result = await applyMarkdownImport({
      files: [
        { path: "/vault/wiki/already.md", content: "# Already\n\nImported" },
        { path: "/vault/wiki/new.md", content: "# New\n\nFresh" },
      ],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      apply: true,
      skipExisting: true,
      fetcher,
    });

    expect(result.summary.skipped_existing).toBe(1);
    expect(result.summary.applied).toBe(1);
    expect(calls.filter((call) => call === "POST http://127.0.0.1:8000/documents")).toHaveLength(1);
    expect(result.documents.find((doc) => doc.status === "applied")!.document_id).toBe("new-doc");
  });

  it("skips empty markdown files instead of posting invalid documents", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url);
      calls.push(`${init?.method ?? "GET"} ${text}`);
      if (text.endsWith("/documents")) {
        return new Response(JSON.stringify({ id: "new-doc" }), { status: 200 });
      }
      return new Response(JSON.stringify({ count: 1 }), { status: 200 });
    });

    const result = await applyMarkdownImport({
      files: [
        { path: "/vault/wiki/empty.md", content: "---\ntitle: Empty\n---\n\n" },
        { path: "/vault/wiki/new.md", content: "# New\n\nFresh" },
      ],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      apply: true,
      fetcher,
    });

    expect(result.summary.total).toBe(2);
    expect(result.summary.skipped_empty).toBe(1);
    expect(result.summary.applied).toBe(1);
    expect(result.documents.map((doc) => doc.status)).toEqual(["skipped_empty", "applied"]);
    expect(calls.filter((call) => call === "POST http://127.0.0.1:8000/documents")).toHaveLength(1);
  });

  it("evaluates parity between OpenBrain document search and Ry-El search results", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { document_title: "One Brain Architecture", source_uri: "file:///vault/wiki/one_brain.md", score: 0.9 },
      ],
    }), { status: 200 }));
    const ryelSearch = vi.fn(async () => [
      { title: "One Brain Architecture", path: "/vault/wiki/one_brain.md", score: 0.8 },
    ]);

    const report = await evaluateImportParity({
      queries: ["one brain architecture"],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      fetcher,
      ryelSearch,
    });

    expect(report.queries).toHaveLength(1);
    expect(report.summary.overlap_at_5).toBe(1);
    expect(report.queries[0]!.overlap).toBe(1);
  });

  it("applies a plan by posting documents then replacing chunks", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (String(url).endsWith("/documents")) {
        return new Response(JSON.stringify({ id: "doc-123", title: "One Brain Architecture" }), { status: 200 });
      }
      return new Response(JSON.stringify({ count: 1, chunks: [] }), { status: 200 });
    });

    const result = await applyMarkdownImport({
      files: [{ path: "/vault/wiki/one_brain.md", content: source }],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain",
      sourceType: "ryel_markdown",
      createdBy: "hermes",
      apply: true,
      fetcher,
    });

    expect(result.documents[0]!.document_id).toBe("doc-123");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/documents");
    expect(calls[0]!.body).toMatchObject({
      title: "One Brain Architecture",
      source_type: "ryel_markdown",
      project: "one-brain",
      created_by: "hermes",
    });
    expect(calls[1]!.url).toBe("http://127.0.0.1:8000/documents/doc-123/chunks");
    expect(calls[1]!.body).toHaveProperty("chunks");
  });

  it("posts derived document semantics during apply mode", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (String(url).endsWith("/documents")) {
        return new Response(JSON.stringify({ id: "doc-456", title: "One Brain Handoff" }), { status: 200 });
      }
      return new Response(JSON.stringify({ count: 1, chunks: [] }), { status: 200 });
    });

    await applyMarkdownImport({
      files: [{
        path: "/home/ryan/workspace/ryel/agent-notes/general/handoff_20260613_onebrain_complete.md",
        content: "# One Brain Handoff\n\nBody.",
      }],
      apiBaseUrl: "http://127.0.0.1:8000",
      sourceType: "ryel_markdown",
      createdBy: "hermes",
      apply: true,
      fetcher,
    });

    expect(calls[0]!.url).toBe("http://127.0.0.1:8000/documents");
    expect(calls[0]!.body).toMatchObject({
      bank_id: "openbrain",
      document_kind: "handoff",
      intent: "operational_log",
    });
  });
});
