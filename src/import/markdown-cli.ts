import { writeFile } from "node:fs/promises";
import { applyMarkdownImport, expandMarkdownInputs } from "./markdown.js";

interface CliOptions {
  files: string[];
  manifestPath?: string;
  skipExisting: boolean;
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
    skipExisting: false,
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
    else if (arg === "--manifest") opts.manifestPath = next();
    else if (arg === "--skip-existing") opts.skipExisting = true;
    else if (arg === "--overlap-chars") opts.overlapChars = Number(next());
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node dist/import/markdown-cli.js [--apply] [--skip-existing] [--manifest out.json] [--api URL] [--project NAME] [--source-type TYPE] <file-or-dir-or-glob>...\n\nDefault is dry-run. Use --apply to POST documents and chunks.`);
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
  const files = await expandMarkdownInputs(opts.files);

  const plan = await applyMarkdownImport({
    files,
    apiBaseUrl: opts.apiBaseUrl,
    project: opts.project,
    sourceType: opts.sourceType,
    createdBy: opts.createdBy,
    apply: opts.apply,
    skipExisting: opts.skipExisting,
    maxChars: opts.maxChars,
    overlapChars: opts.overlapChars,
  });

  const output = JSON.stringify({
    apply: plan.apply,
    apiBaseUrl: plan.apiBaseUrl,
    summary: plan.summary,
    documents: plan.documents.map((doc) => ({
      title: doc.title,
      source_uri: doc.source_uri,
      source_type: doc.source_type,
      project: doc.project,
      chunks: doc.chunks.length,
      status: doc.status,
      document_id: doc.document_id,
      existing_document_id: doc.existing_document_id,
    })),
  }, null, 2);
  if (opts.manifestPath) {
    await writeFile(opts.manifestPath, output + "\n");
  }
  console.log(output);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
