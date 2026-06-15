import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("markdown import CLI", () => {
  it("prints a one-line warning summary when empty markdown files are skipped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-markdown-cli-"));
    const manifestPath = join(dir, "manifest.json");
    const emptyPath = join(dir, "empty.md");
    const fullPath = join(dir, "full.md");

    try {
      await writeFile(emptyPath, "---\ntitle: Empty\n---\n\n");
      await writeFile(fullPath, "# Full\n\nBody");

      const { stdout, stderr } = await execFileAsync(
        "pnpm",
        ["exec", "tsx", "src/import/markdown-cli.ts", "--manifest", manifestPath, emptyPath, fullPath],
        {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const report = JSON.parse(stdout) as {
        summary: { skipped_empty: number };
        documents: Array<{ source_uri: string; status: string }>;
      };
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        summary: { skipped_empty: number };
      };

      expect(report.summary.skipped_empty).toBe(1);
      expect(manifest.summary.skipped_empty).toBe(1);
      expect(report.documents.find((doc) => doc.source_uri === `file://${emptyPath}`)?.status).toBe("skipped_empty");
      expect(stderr).toContain("Skipped 1 empty markdown file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints a one-line warning summary when existing markdown files are skipped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-markdown-cli-"));
    const manifestPath = join(dir, "manifest.json");
    const existingPath = join(dir, "existing.md");
    const newPath = join(dir, "new.md");
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/documents/by-source-uri" && req.method === "GET") {
        if (url.searchParams.get("source_uri") === `file://${existingPath}`) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "existing-doc", source_uri: `file://${existingPath}` }));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    try {
      await writeFile(existingPath, "# Existing\n\nBody");
      await writeFile(newPath, "# New\n\nBody");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind markdown CLI test server");
      }
      const apiBaseUrl = `http://127.0.0.1:${address.port}`;

      const { stdout, stderr } = await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "src/import/markdown-cli.ts",
          "--skip-existing",
          "--api",
          apiBaseUrl,
          "--manifest",
          manifestPath,
          existingPath,
          newPath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const report = JSON.parse(stdout) as {
        summary: { skipped_existing: number };
        documents: Array<{ source_uri: string; status: string; existing_document_id?: string }>;
      };
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        summary: { skipped_existing: number };
      };

      expect(report.summary.skipped_existing).toBe(1);
      expect(manifest.summary.skipped_existing).toBe(1);
      expect(report.documents.find((doc) => doc.source_uri === `file://${existingPath}`)?.status).toBe("skipped_existing");
      expect(report.documents.find((doc) => doc.source_uri === `file://${existingPath}`)?.existing_document_id).toBe("existing-doc");
      expect(stderr).toContain("Skipped 1 existing markdown file");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prints one compact summary line when both existing and empty markdown files are skipped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openbrain-markdown-cli-"));
    const manifestPath = join(dir, "manifest.json");
    const existingPath = join(dir, "existing.md");
    const emptyPath = join(dir, "empty.md");
    const newPath = join(dir, "new.md");
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/documents/by-source-uri" && req.method === "GET") {
        if (url.searchParams.get("source_uri") === `file://${existingPath}`) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "existing-doc", source_uri: `file://${existingPath}` }));
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    try {
      await writeFile(existingPath, "# Existing\n\nBody");
      await writeFile(emptyPath, "---\ntitle: Empty\n---\n\n");
      await writeFile(newPath, "# New\n\nBody");
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind markdown CLI test server");
      }
      const apiBaseUrl = `http://127.0.0.1:${address.port}`;

      const { stdout, stderr } = await execFileAsync(
        "pnpm",
        [
          "exec",
          "tsx",
          "src/import/markdown-cli.ts",
          "--skip-existing",
          "--api",
          apiBaseUrl,
          "--manifest",
          manifestPath,
          existingPath,
          emptyPath,
          newPath,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const report = JSON.parse(stdout) as {
        summary: { skipped_existing: number; skipped_empty: number };
      };
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        summary: { skipped_existing: number; skipped_empty: number };
      };

      expect(report.summary.skipped_existing).toBe(1);
      expect(report.summary.skipped_empty).toBe(1);
      expect(manifest.summary.skipped_existing).toBe(1);
      expect(manifest.summary.skipped_empty).toBe(1);
      expect(stderr.trim()).toBe("Skipped 1 existing markdown file; 1 empty markdown file");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
