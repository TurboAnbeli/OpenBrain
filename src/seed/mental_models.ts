import type pg from "pg";

import type { Embedder } from "../embedder/types.js";
import {
  insertMentalModel,
  listMentalModels,
  updateMentalModel,
  type MentalModelRow,
} from "../db/queries.js";

export const MENTAL_MODEL_SEED_VERSION = "2026-06-15-slice-k-v1";
export const DEFAULT_MENTAL_MODEL_SEED_PROJECT = "openbrain";
export const DEFAULT_MENTAL_MODEL_SEED_CREATED_BY = "openbrain-seed:slice-k";

export interface MentalModelSeedEvidenceRef {
  type: "openbrain_thought" | "ryel_note" | "repo_doc" | "directive" | "skill_reference";
  ref: string;
  note?: string;
}

export interface MentalModelSeed {
  key: string;
  name: string;
  query: string;
  content: string;
  structured: Record<string, unknown> & {
    seed_key: string;
    seed_version: string;
    evidence_refs: MentalModelSeedEvidenceRef[];
  };
  tags: string[];
  trigger_tags: string[];
  priority: number;
  refresh_meta: Record<string, unknown>;
}

export interface SeedMentalModelsOptions {
  pool: pg.Pool;
  embedder: Embedder;
  bank_id?: string;
  project?: string;
  created_by?: string;
  dry_run?: boolean;
}

export interface SeedMentalModelResult {
  seed_key: string;
  trigger_tag: string;
  action: "created" | "updated";
  id?: string;
}

export interface SeedMentalModelsSummary {
  seed_version: string;
  dry_run: boolean;
  created: number;
  updated: number;
  unchanged: number;
  results: SeedMentalModelResult[];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function seedTriggerTag(key: string): string {
  return `seed:${key}`;
}

function makeSeed(
  seed: Omit<MentalModelSeed, "structured" | "tags" | "trigger_tags" | "refresh_meta"> & {
    evidence_refs: MentalModelSeedEvidenceRef[];
    topics: string[];
    trigger_tags?: string[];
    refresh_meta?: Record<string, unknown>;
    structured?: Record<string, unknown>;
  }
): MentalModelSeed {
  return {
    key: seed.key,
    name: seed.name,
    query: seed.query,
    content: seed.content,
    priority: seed.priority,
    structured: {
      ...(seed.structured ?? {}),
      seed_key: seed.key,
      seed_version: MENTAL_MODEL_SEED_VERSION,
      evidence_refs: seed.evidence_refs,
      seeded_by: "src/seed/mental_models.ts",
    },
    tags: uniqueStrings(["mental-model", "seeded", "hindsight", ...seed.topics]),
    trigger_tags: uniqueStrings([seedTriggerTag(seed.key), ...seed.topics, ...(seed.trigger_tags ?? [])]),
    refresh_meta: {
      source: "slice-k-seed",
      seed_version: MENTAL_MODEL_SEED_VERSION,
      refresh_policy: "manual_or_gated_refresh_only",
      ...(seed.refresh_meta ?? {}),
    },
  };
}

export const MENTAL_MODEL_SEEDS: MentalModelSeed[] = [
  makeSeed({
    key: "one-brain-canonical-direction",
    name: "One Brain canonical direction",
    query: "What is the One Brain architecture direction and source-of-truth model?",
    content:
      "OpenBrain is the canonical editable memory database for durable source documents, decisions, observations, experiences, links, directives, and mental models. Ry-El, Obsidian, Markdown, and wiki exports are transitional interfaces, archives, or UI surfaces, not the long-term canonical source of truth. Prefer provenance-rich OpenBrain rows with explicit revisions/audit trails over scattered note layers.",
    priority: 90,
    topics: ["one-brain", "architecture", "canonical-db"],
    evidence_refs: [
      {
        type: "repo_doc",
        ref: "docs/plans/2026-06-15_hindsight-phases-next-steps.md",
        note: "Adjusted order and Hindsight-class memory target for OpenBrain.",
      },
      {
        type: "ryel_note",
        ref: "agent-notes/general/2026-06-15_openbrain_slice_j_explicit_mental_model_runtime_completed_2026-06-15.md",
        note: "Slice J completed explicit mental-model runtime while leaving generation for later slices.",
      },
    ],
  }),
  makeSeed({
    key: "retrieval-before-graph-discipline",
    name: "Measure retrieval before enabling graph ranking",
    query: "When should graph, entity, temporal, or link-aware ranking become default in OpenBrain recall?",
    content:
      "Do not enable graph/entity/temporal/link ranking globally just because the tables exist. First measure default document-source reachability and prove that a new lane improves a specific query class without degrading the baseline. Keep graph expansion and mental-model recall explicit or query-class gated until an evaluation checkpoint proves default blending is safe.",
    priority: 85,
    topics: ["retrieval", "graph", "evaluation"],
    evidence_refs: [
      {
        type: "openbrain_thought",
        ref: "6c84f47c-5065-482a-83ca-53465b260ab4",
        note: "Checkpoint Eval B: default recall did not degrade documents; do not enable graph/entity ranking globally.",
      },
      {
        type: "skill_reference",
        ref: "openbrain-retrieval-eval/references/2026-06-15-checkpoint-eval-b-recall-vs-documents.md",
        note: "Measured recall-vs-documents comparator and decision record.",
      },
    ],
  }),
  makeSeed({
    key: "privacy-and-evidence-constraints",
    name: "Privacy and evidence constraints",
    query: "What constraints govern OpenBrain memory synthesis and retained experiences?",
    content:
      "OpenBrain memory generation must preserve privacy and evidence boundaries: do not retain verbatim patient/person identifiers, do not average conflicting facts into unsupported claims, and keep provenance/evidence references attached to synthesized observations and mental models. Hard directives override source text when they conflict with privacy or evidence constraints.",
    priority: 100,
    topics: ["privacy", "directives", "evidence"],
    evidence_refs: [
      {
        type: "directive",
        ref: "no_pii_verbatim",
        note: "Hard retain/reflect directive forbidding verbatim identifiers.",
      },
      {
        type: "directive",
        ref: "no_fact_averaging",
        note: "Hard synthesis directive forbidding unsupported averaging of conflicting facts.",
      },
      {
        type: "ryel_note",
        ref: "agent-notes/general/2026-06-15_openbrain_slice_c_directives_integration_completed_2026-06-15.md",
        note: "Directive-conditioned consolidation records applied directive IDs in prompts and audit rows.",
      },
    ],
  }),
  makeSeed({
    key: "explicit-recall-lane-discipline",
    name: "Explicit recall lane discipline",
    query: "How should OpenBrain expose graph expansion and mental-model recall safely?",
    content:
      "Default recall should stay stable and document-safe. Link expansion is one-hop and explicit through seed nodes; mental-model recall is opt-in through include_mental_models; temporal recall activates only when a time window is supplied. New lanes should expose lane scores and metadata, remain bounded, and avoid hidden semantic/entity inference unless separately gated and evaluated.",
    priority: 80,
    topics: ["recall", "mental-models", "memory-links"],
    evidence_refs: [
      {
        type: "openbrain_thought",
        ref: "e68def09-4297-4e1a-8886-faeeb5e0cfff",
        note: "Slice H added explicit recall facade with opt-in link expansion.",
      },
      {
        type: "openbrain_thought",
        ref: "4e489f0a-bf53-4b5b-9eec-e7474fe69a03",
        note: "Slice J added opt-in mental-model recall lane.",
      },
      {
        type: "skill_reference",
        ref: "openbrain-retrieval-eval/references/2026-06-15-slice-j-mental-model-runtime.md",
        note: "Slice J implementation and live-smoke pattern.",
      },
    ],
  }),
];

export function mentalModelSeedEmbeddingText(seed: Pick<MentalModelSeed, "name" | "query" | "content">): string {
  return `${seed.name}\n${seed.query}\n${seed.content}`;
}

function toInput(seed: MentalModelSeed, embedding: number[], options: Required<Pick<SeedMentalModelsOptions, "bank_id" | "project" | "created_by">>) {
  return {
    bank_id: options.bank_id,
    name: seed.name,
    query: seed.query,
    content: seed.content,
    embedding,
    structured: seed.structured,
    tags: seed.tags,
    trigger_tags: seed.trigger_tags,
    priority: seed.priority,
    refresh_meta: seed.refresh_meta,
    history: [
      {
        event: "seeded_or_refreshed",
        seed_key: seed.key,
        seed_version: MENTAL_MODEL_SEED_VERSION,
        source: "src/seed/mental_models.ts",
      },
    ],
    active: true,
    project: options.project,
    created_by: options.created_by,
  };
}

export async function seedMentalModels(options: SeedMentalModelsOptions): Promise<SeedMentalModelsSummary> {
  const resolved = {
    bank_id: options.bank_id ?? "openbrain",
    project: options.project ?? DEFAULT_MENTAL_MODEL_SEED_PROJECT,
    created_by: options.created_by ?? DEFAULT_MENTAL_MODEL_SEED_CREATED_BY,
  };
  const summary: SeedMentalModelsSummary = {
    seed_version: MENTAL_MODEL_SEED_VERSION,
    dry_run: options.dry_run ?? false,
    created: 0,
    updated: 0,
    unchanged: 0,
    results: [],
  };

  for (const seed of MENTAL_MODEL_SEEDS) {
    const triggerTag = seedTriggerTag(seed.key);
    const existing = await listMentalModels(options.pool, {
      bank_id: resolved.bank_id,
      trigger_tag: triggerTag,
      include_inactive: true,
      limit: 10,
    });
    const existingModel = existing[0] as MentalModelRow | undefined;
    const action: "created" | "updated" = existingModel ? "updated" : "created";

    if (options.dry_run) {
      summary[action] += 1;
      summary.results.push({ seed_key: seed.key, trigger_tag: triggerTag, action, id: existingModel?.id });
      continue;
    }

    const embedding = await options.embedder.generateEmbedding(mentalModelSeedEmbeddingText(seed));
    const input = toInput(seed, embedding, resolved);

    if (existingModel) {
      const updated = await updateMentalModel(options.pool, existingModel.id, input);
      summary.updated += 1;
      summary.results.push({ seed_key: seed.key, trigger_tag: triggerTag, action: "updated", id: updated.id });
    } else {
      const created = await insertMentalModel(options.pool, input);
      summary.created += 1;
      summary.results.push({ seed_key: seed.key, trigger_tag: triggerTag, action: "created", id: created.id });
    }
  }

  return summary;
}
