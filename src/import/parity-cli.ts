import { spawn } from "node:child_process";
import { loadParityQueries, createLocalRyelMarkdownSearch, runParityReport, writeParityReport, shellQuote } from "./parity.js";
import type { ParitySearchResult } from "./markdown.js";

interface CliOptions {
  queriesPath: string;
  outputPath?: string;
  apiBaseUrl: string;
  project?: string;
  sourceType?: string;
  ryelRoot?: string;
  ryelCommand?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    queriesPath: "",
    apiBaseUrl: "http://127.0.0.1:8000",
    sourceType: "ryel_markdown",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (arg === "--queries") opts.queriesPath = next();
    else if (arg === "--output") opts.outputPath = next();
    else if (arg === "--api") opts.apiBaseUrl = next();
    else if (arg === "--project") opts.project = next();
    else if (arg === "--source-type") opts.sourceType = next();
    else if (arg === "--ryel-root") opts.ryelRoot = next();
    else if (arg === "--ryel-command") opts.ryelCommand = next();
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node dist/import/parity-cli.js --queries queries.json [--output report.json] [--project NAME] [--source-type TYPE] [--ryel-root PATH | --ryel-command CMD]\n\nQuery file may be a JSON string array or { "queries": [...] }. Default Ry-El adapter is local Markdown lexical search over --ryel-root.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!opts.queriesPath) throw new Error("--queries is required");
  if (!opts.ryelRoot && !opts.ryelCommand) throw new Error("Either --ryel-root or --ryel-command is required");
  return opts;
}

function createCommandSearch(command: string): (query: string) => Promise<ParitySearchResult[]> {
  return async (query: string) => new Promise((resolve, reject) => {
    const child = spawn(`${command} ${shellQuote(query)}`, { stdio: ["ignore", "pipe", "pipe"], shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Ry-El command failed (${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as ParitySearchResult[] | { results?: ParitySearchResult[] };
        resolve(Array.isArray(parsed) ? parsed : parsed.results ?? []);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const queries = await loadParityQueries(opts.queriesPath);
  const ryelSearch = opts.ryelCommand
    ? createCommandSearch(opts.ryelCommand)
    : createLocalRyelMarkdownSearch({ root: opts.ryelRoot! });
  const report = await runParityReport({
    queries,
    apiBaseUrl: opts.apiBaseUrl,
    project: opts.project,
    sourceType: opts.sourceType,
    ryelSearch,
  });
  const output = JSON.stringify(report, null, 2);
  if (opts.outputPath) await writeParityReport(opts.outputPath, report);
  console.log(output);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
