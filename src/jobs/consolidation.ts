import type pg from "pg";

import { synthesizeObservation, type SynthesisOptions } from "../api/synthesize.js";
import type { Embedder } from "../embedder/types.js";
import {
  startConsolidationJob,
  getThoughtsByIds,
  getDocument,
  getDocumentBySourceUri,
  insertConsolidatedObservation,
  insertExperience,
  insertMemoryLink,
  completeConsolidationJob,
  failConsolidationJob,
  getMemoryBankContext,
  type ConsolidationJobRow,
  type ConsolidationJobInputPayload,
  type ConsolidatedObservationRow,
} from "../db/queries.js";

interface SourceItem {
  id: string;
  kind: "thought" | "document";
  title?: string | null;
  content: string;
  project?: string | null;
  created_by?: string | null;
  source_uri?: string | null;
}

export interface RunConsolidationJobOptions {
  embedder: Embedder;
  synthesis: SynthesisOptions;
}

export interface RunConsolidationJobResult {
  job: ConsolidationJobRow;
  observation?: ConsolidatedObservationRow;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourceQuote(source: SourceItem): string {
  if (source.kind === "document" && source.title) {
    return `${source.title}\n\n${source.content}`;
  }
  return source.content;
}

async function loadThoughtSources(pool: pg.Pool, input: ConsolidationJobInputPayload): Promise<SourceItem[]> {
  const thoughtIds = asStringArray(input.thought_ids);
  if (thoughtIds.length === 0) return [];
  const thoughts = await getThoughtsByIds(pool, thoughtIds);
  const byId = new Map(thoughts.map((thought) => [thought.id, thought]));
  return thoughtIds
    .map((id) => byId.get(id))
    .filter((thought): thought is NonNullable<typeof thought> => Boolean(thought))
    .map((thought) => ({
      id: thought.id,
      kind: "thought" as const,
      content: thought.content,
      project: thought.project ?? null,
      created_by: thought.created_by ?? null,
    }));
}

async function loadDocumentSources(pool: pg.Pool, input: ConsolidationJobInputPayload): Promise<SourceItem[]> {
  const documentIds = asStringArray(input.document_ids);
  const sourceUris = asStringArray(input.source_uris);
  const sources: SourceItem[] = [];
  const seen = new Set<string>();

  for (const id of documentIds) {
    const doc = await getDocument(pool, id);
    if (!doc || doc.status !== "active" || seen.has(doc.id)) continue;
    seen.add(doc.id);
    sources.push({
      id: doc.id,
      kind: "document",
      title: doc.title,
      content: doc.content,
      project: doc.project ?? null,
      created_by: doc.created_by ?? null,
      source_uri: doc.source_uri ?? null,
    });
  }

  for (const uri of sourceUris) {
    const doc = await getDocumentBySourceUri(pool, uri);
    if (!doc || doc.status !== "active" || seen.has(doc.id)) continue;
    seen.add(doc.id);
    sources.push({
      id: doc.id,
      kind: "document",
      title: doc.title,
      content: doc.content,
      project: doc.project ?? null,
      created_by: doc.created_by ?? null,
      source_uri: doc.source_uri ?? null,
    });
  }

  return sources;
}

function outputEnvelope(
  sourceKind: "thought" | "document",
  sources: SourceItem[],
  observationId?: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...(observationId ? { observation_id: observationId } : {}),
    source_kind: sourceKind,
    source_count: sources.length,
    source_ids: sources.map((source) => source.id),
    ...extra,
  };
}

function consolidationExperienceContent(job: ConsolidationJobRow, observationId: string, sourceCount: number): string {
  return `Consolidation job ${job.id} materialized observation ${observationId} from ${sourceCount} explicit ${job.job_type} sources.`;
}

export async function runConsolidationJob(
  pool: pg.Pool,
  jobIdOrPreclaimed: string | ConsolidationJobRow,
  options: RunConsolidationJobOptions
): Promise<RunConsolidationJobResult> {
  // When the worker claims a job via claimNextQueuedJob(), it already sets
  // status='running'.  Calling startConsolidationJob() again would fail
  // because it requires status IN ('queued', 'error').  Accept either a
  // raw job ID (existing API path) or an already-claimed row (worker path).
  const job = typeof jobIdOrPreclaimed === "string"
    ? await startConsolidationJob(pool, jobIdOrPreclaimed)
    : jobIdOrPreclaimed;
  if (!job) {
    throw new Error(`Consolidation job is not queued or does not exist: ${typeof jobIdOrPreclaimed === "string" ? jobIdOrPreclaimed : jobIdOrPreclaimed.id}`);
  }

  const input = job.input ?? {};
  const sourceKind = job.job_type === "observe_documents" ? "document" : "thought";
  const sources = sourceKind === "document"
    ? await loadDocumentSources(pool, input)
    : await loadThoughtSources(pool, input);

  try {
    if (sources.length === 0) {
      throw new Error(`no active ${sourceKind} sources found`);
    }
    if (sourceKind === "thought" && sources.length < 2) {
      throw new Error("observe_thoughts requires at least 2 active source thoughts");
    }

    const memoryBank = await getMemoryBankContext(pool, job.bank_id, "reflect");
    const directiveIds = memoryBank?.directives.map((directive) => directive.id) ?? [];

    const synthesis = await synthesizeObservation(
      sources.map((source) => source.content),
      {
        ...options.synthesis,
        ...(memoryBank ? { memoryBank } : {}),
      }
    );
    if (!synthesis) {
      throw new Error("synthesis quality gate failed");
    }

    const [embedding, metadata] = await Promise.all([
      options.embedder.generateEmbedding(synthesis),
      options.embedder.extractMetadata(synthesis),
    ]);

    const observation = await insertConsolidatedObservation(pool, {
      bank_id: job.bank_id,
      content: synthesis,
      embedding,
      proof_count: sources.length,
      source_memory_ids: sources.map((source) => source.id),
      source_quotes: Object.fromEntries(sources.map((source) => [source.id, sourceQuote(source)])),
      tags: metadata.topics ?? [],
      history: [{
        consolidation_job_id: job.id,
        job_type: job.job_type,
        source_kind: sourceKind,
        directive_ids: directiveIds,
      }],
      trend: null,
      trend_computed_at: null,
      project: typeof input.project === "string" ? input.project : sources[0]?.project ?? undefined,
      created_by: typeof input.created_by === "string" ? input.created_by : undefined,
      archived: false,
    });

    const evidenceLinks = [];
    for (const source of sources) {
      evidenceLinks.push(await insertMemoryLink(pool, {
        bank_id: job.bank_id,
        source_type: source.kind,
        source_id: source.id,
        target_type: "consolidated_observation",
        target_id: observation.id,
        relationship: "evidence_for",
        weight: 1,
        inferred: true,
      }));
    }
    const evidenceLinkIds = evidenceLinks.map((link) => link.id);
    const experienceContent = consolidationExperienceContent(job, observation.id, sources.length);
    const experience = await insertExperience(pool, {
      bank_id: job.bank_id,
      session_id: `consolidation:${job.id}`,
      agent_id: "openbrain-system",
      event_type: "decide",
      content: experienceContent,
      embedding: await options.embedder.generateEmbedding(experienceContent),
      refs: {
        event: "consolidation_completed",
        consolidation_job_id: job.id,
        observation_id: observation.id,
        source_kind: sourceKind,
        source_ids: sources.map((source) => source.id),
        evidence_link_ids: evidenceLinkIds,
        directive_ids: directiveIds,
      },
      project: typeof input.project === "string" ? input.project : sources[0]?.project ?? undefined,
      created_by: "openbrain-system",
    });

    const completed = await completeConsolidationJob(
      pool,
      job.id,
      {
        ...outputEnvelope(sourceKind, sources, observation.id, {
          evidence_link_ids: evidenceLinkIds,
          experience_id: experience.id,
        }),
        directive_ids: directiveIds,
      }
    );
    return { job: completed, observation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await failConsolidationJob(
      pool,
      job.id,
      message,
      outputEnvelope(sourceKind, sources)
    );
    return { job: failed };
  }
}
