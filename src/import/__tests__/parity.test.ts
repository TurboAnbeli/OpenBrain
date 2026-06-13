import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  loadParityQueries,
  createLocalRyelMarkdownSearch,
  runParityReport,
  writeParityReport,
} from "../parity.js";

describe("import parity reporting", () => {
  it("loads parity queries from either an array or an object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-parity-"));
    try {
      const arrayPath = join(dir, "array.json");
      const objectPath = join(dir, "object.json");
      await writeFile(arrayPath, JSON.stringify(["hybrid memory", "model routing"]));
      await writeFile(objectPath, JSON.stringify({ queries: ["agent harness"] }));

      await expect(loadParityQueries(arrayPath)).resolves.toEqual(["hybrid memory", "model routing"]);
      await expect(loadParityQueries(objectPath)).resolves.toEqual(["agent harness"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("local Ry-El Markdown adapter ranks matching wiki files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-ryel-"));
    try {
      await writeFile(join(dir, "hybrid_memory.md"), "# Hybrid Memory\n\nOpenBrain wiki hybrid memory architecture.");
      await writeFile(join(dir, "qwen.md"), "# Qwen\n\nLow VRAM llama.cpp optimization notes.");

      const search = createLocalRyelMarkdownSearch({ root: dir, limit: 2 });
      const results = await search("hybrid memory architecture");

      expect(results[0]).toMatchObject({
        title: "Hybrid Memory",
        path: join(dir, "hybrid_memory.md"),
      });
      expect(results[0]!.score).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs a parity report using OpenBrain search and a Ry-El adapter", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { document_title: "Hybrid Memory", source_uri: "file:///vault/hybrid_memory.md", score: 0.8 },
      ],
    }), { status: 200 }));
    const ryelSearch = vi.fn(async () => [
      { title: "Hybrid Memory", path: "/vault/hybrid_memory.md", score: 0.7 },
    ]);

    const report = await runParityReport({
      queries: ["hybrid memory"],
      apiBaseUrl: "http://127.0.0.1:8000",
      project: "one-brain-pilot",
      sourceType: "ryel_markdown",
      fetcher,
      ryelSearch,
    });

    expect(report.summary).toMatchObject({ query_count: 1, overlap_at_5: 1 });
    expect(report.queries[0]!.query).toBe("hybrid memory");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8000/documents/search", expect.objectContaining({ method: "POST" }));
  });



  it("counts overlap when OpenBrain returns document_source_uri", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { document_title: "Hybrid Memory", document_source_uri: "file:///vault/hybrid_memory.md", score: 0.8 },
      ],
    }), { status: 200 }));
    const ryelSearch = vi.fn(async () => [
      { title: "Hybrid Memory", path: "/vault/hybrid_memory.md", score: 0.7 },
    ]);

    const report = await runParityReport({
      queries: ["hybrid memory"],
      apiBaseUrl: "http://127.0.0.1:8000",
      fetcher,
      ryelSearch,
    });

    expect(report.summary.overlap_at_5).toBe(1);
  });

  it("writes a parity report JSON artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-parity-out-"));
    try {
      const out = join(dir, "report.json");
      await writeParityReport(out, {
        summary: { query_count: 1, overlap_at_5: 1 },
        queries: [{ query: "hybrid", openbrain: [], ryel: [], overlap: 1 }],
      });
      const parsed = JSON.parse(await readFile(out, "utf8"));
      expect(parsed.summary.query_count).toBe(1);
      expect(parsed.queries[0].query).toBe("hybrid");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
