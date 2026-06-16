import { closePool, getPool, initializeDatabase } from "../db/connection.js";
import { getEmbedder } from "../embedder/index.js";
import {
  DEFAULT_MENTAL_MODEL_SEED_CREATED_BY,
  DEFAULT_MENTAL_MODEL_SEED_PROJECT,
  seedMentalModels,
} from "./mental_models.js";

interface CliOptions {
  dry_run: boolean;
  bank_id: string;
  project: string;
  created_by: string;
}

function readArgValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function parseCliOptions(args = process.argv.slice(2)): CliOptions {
  return {
    dry_run: args.includes("--dry-run"),
    bank_id: readArgValue(args, "--bank-id") ?? "openbrain",
    project: readArgValue(args, "--project") ?? DEFAULT_MENTAL_MODEL_SEED_PROJECT,
    created_by: readArgValue(args, "--created-by") ?? DEFAULT_MENTAL_MODEL_SEED_CREATED_BY,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  await initializeDatabase();
  const summary = await seedMentalModels({
    pool: getPool(),
    embedder: getEmbedder(),
    bank_id: options.bank_id,
    project: options.project,
    created_by: options.created_by,
    dry_run: options.dry_run,
  });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error("[seed:mental-models] failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
