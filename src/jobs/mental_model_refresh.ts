import type pg from "pg";

import { synthesizeMentalModelRefresh, type SynthesisOptions } from "../api/synthesize.js";
import type { Embedder } from "../embedder/types.js";
import {
  getConsolidatedObservation,
  getMemoryBankContext,
  getMentalModel,
  updateMentalModel,
  type ConsolidatedObservationRow,
  type MentalModelRow,
} from "../db/queries.js";

export interface RefreshMentalModelOptions {
  observation_ids: string[];
  embedder: Embedder;
  synthesis: SynthesisOptions;
  dry_run?: boolean;
}

export interface RefreshMentalModelResult {
  dry_run: boolean;
  model: MentalModelRow;
  evidence_observations: ConsolidatedObservationRow[];
  proposed_content?: string;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function mentalModelEmbeddingText(name: string, query: string, content: string): string {
  return `${name}\n${query}\n${content}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

async function loadActiveObservations(
  pool: pg.Pool,
  observationIds: string[]
): Promise<ConsolidatedObservationRow[]> {
  const observations: ConsolidatedObservationRow[] = [];
  const seen = new Set<string>();
  for (const id of observationIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const observation = await getConsolidatedObservation(pool, id);
    if (observation && !observation.archived) {
      observations.push(observation);
    }
  }
  return observations;
}

export async function refreshMentalModelFromObservations(
  pool: pg.Pool,
  modelId: string,
  options: RefreshMentalModelOptions
): Promise<RefreshMentalModelResult> {
  const observationIds = uniqueStrings(options.observation_ids ?? []);
  if (observationIds.length === 0) {
    throw new Error("At least one observation_id is required to refresh a mental model");
  }

  const model = await getMentalModel(pool, modelId);
  if (!model) {
    throw new Error(`Mental model not found: ${modelId}`);
  }

  const observations = await loadActiveObservations(pool, observationIds);
  if (observations.length === 0) {
    throw new Error("No active evidence observations found for mental model refresh");
  }

  const memoryBank = await getMemoryBankContext(pool, model.bank_id, "reflect");
  const directiveIds = memoryBank?.directives.map((directive) => directive.id).filter((id): id is string => Boolean(id)) ?? [];
  const proposed = await synthesizeMentalModelRefresh(model, observations, {
    ...options.synthesis,
    ...(memoryBank ? { memoryBank } : {}),
  });
  if (!proposed) {
    throw new Error("mental model refresh synthesis quality gate failed");
  }

  if (options.dry_run) {
    return {
      dry_run: true,
      model,
      evidence_observations: observations,
      proposed_content: proposed,
    };
  }

  const embedding = await options.embedder.generateEmbedding(
    mentalModelEmbeddingText(model.name, model.query, proposed)
  );
  const refreshedAt = isoNow();
  const evidenceObservationIds = observations.map((observation) => observation.id);
  const evidenceRefs = observations.map((observation) => ({
    type: "consolidated_observation",
    ref: observation.id,
    proof_count: observation.proof_count,
    tags: observation.tags ?? [],
  }));
  const nextStructured = {
    ...(model.structured ?? {}),
    refresh: {
      refreshed_at: refreshedAt,
      evidence_observation_ids: evidenceObservationIds,
      directive_ids: directiveIds,
      source: "mental_model_refresh",
    },
    evidence_refs: [
      ...((Array.isArray(model.structured?.evidence_refs) ? model.structured.evidence_refs : []) as unknown[]),
      ...evidenceRefs,
    ],
  };
  const nextRefreshMeta = {
    ...(model.refresh_meta ?? {}),
    last_refreshed_at: refreshedAt,
    last_refreshed_by: "mental_model_refresh",
    evidence_observation_ids: evidenceObservationIds,
    directive_ids: directiveIds,
  };
  const nextHistory = [
    ...((Array.isArray(model.history) ? model.history : []) as unknown[]),
    {
      event: "mental_model_refresh",
      refreshed_at: refreshedAt,
      previous_content: model.content,
      evidence_observation_ids: evidenceObservationIds,
      directive_ids: directiveIds,
    },
  ];

  const updated = await updateMentalModel(pool, model.id, {
    content: proposed,
    embedding,
    structured: nextStructured,
    refresh_meta: nextRefreshMeta,
    history: nextHistory,
    active: true,
    project: model.project ?? undefined,
    created_by: model.created_by ?? undefined,
  });

  return {
    dry_run: false,
    model: updated,
    evidence_observations: observations,
  };
}
