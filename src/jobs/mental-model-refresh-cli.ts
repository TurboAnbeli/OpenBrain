import { closePool, getPool, initializeDatabase } from "../db/connection.js";
import { getEmbedder } from "../embedder/index.js";
import { refreshMentalModelFromObservations } from "./mental_model_refresh.js";

interface CliOptions {
  model_id?: string;
  observation_ids: string[];
  dry_run: boolean;
  endpoint: string;
  synthesis_model: string;
}

function readArgValue(args: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function readRepeated(args: string[], name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === name && args[index + 1]) {
      values.push(args[index + 1]!);
      index += 1;
    }
  }
  return values;
}

function parseCliOptions(args = process.argv.slice(2)): CliOptions {
  return {
    model_id: readArgValue(args, "--model-id"),
    observation_ids: readRepeated(args, "--observation-id"),
    dry_run: args.includes("--dry-run"),
    endpoint: readArgValue(args, "--endpoint") ?? process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434",
    synthesis_model: readArgValue(args, "--synthesis-model") ?? process.env.OPENBRAIN_SYNTHESIS_MODEL ?? "qwen3:1.7b",
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  if (!options.model_id) {
    throw new Error("--model-id is required");
  }
  if (options.observation_ids.length === 0) {
    throw new Error("At least one --observation-id is required");
  }

  await initializeDatabase();
  const result = await refreshMentalModelFromObservations(getPool(), options.model_id, {
    observation_ids: options.observation_ids,
    embedder: getEmbedder(),
    synthesis: {
      endpoint: options.endpoint,
      model: options.synthesis_model,
    },
    dry_run: options.dry_run,
  });

  console.log(JSON.stringify({
    dry_run: result.dry_run,
    model_id: result.model.id,
    evidence_observation_ids: result.evidence_observations.map((observation) => observation.id),
    ...(result.proposed_content ? { proposed_content: result.proposed_content } : {}),
    updated_content: result.dry_run ? undefined : result.model.content,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[refresh:mental-model] failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
