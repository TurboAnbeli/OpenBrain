import { readFile } from "node:fs/promises";
import { applyMarkdownImport, type MarkdownSourceFile } from "./markdown.js";

interface CliOptions {
  files: string[];
  apiBaseUrl: string;
  project?: string;
  sourceType: string;
  createdBy: string;
  apply: boolean;
  maxChars?: number;
  overlapChars?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    files: [],
    apiBaseUrl: "http://127.0.0.1:8000",
    sourceType: "ryel_markdown",
    createdBy: "hermes",
    apply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--apply") opts.apply = true;
    else if (arg === "--api") opts.apiBaseUrl = next();
    else if (arg === "--project") opts.project = next();
    else if (arg === "--source-type") opts.sourceType = next();
    else if (arg === "--created-by") opts.createdBy = next();
    else if (arg === "--max-chars") opts.maxChars = Number(next());
    else if (arg === "--overlap-chars") opts.overlapChars = Number(next());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node dist/import/markdown-cli.js [--apply] [--api URL] [--project NAME] [--source-type TYPE] <file.md>...\n\nDefault is dry-run. Use --apply to POST documents and chunks.`);
      process.exit(0);
    } else {
      opts.files.push(arg);
    }
  }

  if (opts.files.length === 0) {
    throw new Error("At least one markdown file path is required");
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const files: MarkdownSourceFile[] = await Promise.all(
    opts.files.map(async (filePath) => ({
      path: filePath,
      content: await readFile(filePath, "utf8"),
    }))
  );

  const plan = await applyMarkdownImport({
    files,
    apiBaseUrl: opts.apiBaseUrl,
    project: opts.project,
    sourceType: opts.sourceType,
    createdBy: opts.createdBy,
    apply: opts.apply,
    maxChars: opts.maxChars,
    overlapChars: opts.overlapChars,
  });

  console.log(JSON.stringify({
    apply: plan.apply,
    apiBaseUrl: plan.apiBaseUrl,
    documents: plan.documents.map((doc) => ({
      title: doc.title,
      source_uri: doc.source_uri,
      source_type: doc.source_type,
      project: doc.project,
      chunks: doc.chunks.length,
      document_id: doc.document_id,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
