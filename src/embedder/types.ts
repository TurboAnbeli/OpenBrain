/**
 * Shared types and interface for embedding providers.
 */

export type ThoughtType =
  | "observation"
  | "task"
  | "idea"
  | "reference"
  | "person_note"
  | "decision"
  | "meeting"
  | "architecture"
  | "pattern"
  | "postmortem"
  | "requirement"
  | "bug"
  | "convention";

export interface ThoughtMetadataExtracted {
  type: ThoughtType;
  topics: string[];
  people: string[];
  action_items: string[];
  dates: string[];
}

export const DEFAULT_METADATA: ThoughtMetadataExtracted = {
  type: "observation",
  topics: [],
  people: [],
  action_items: [],
  dates: [],
};

export interface Embedder {
  /** Convert text to a vector embedding. */
  generateEmbedding(text: string): Promise<number[]>;

  /** Use an LLM to extract structured metadata from content. */
  extractMetadata(content: string): Promise<ThoughtMetadataExtracted>;

  /**
   * Stable identifier of the embedding model behind this embedder.
   * Stamped into thought metadata at write time so future migrations can
   * identify which thoughts need re-embedding when the model changes.
   * Examples: "nomic-embed-text", "text-embedding-3-small".
   */
  getVersion(): string;
}

export const METADATA_PROMPT = `Extract metadata from the following thought. Return JSON with:
- type: one of the following:
  - "observation" — General observations, notes, or musings
  - "task" — Action items, things to do
  - "idea" — Creative ideas, proposals, brainstorms
  - "reference" — Links, resources, documentation pointers
  - "person_note" — Notes about or from a specific person
  - "decision" — Choices made, options evaluated
  - "meeting" — Meeting notes, agendas, outcomes
  - "architecture" — System design decisions, layer choices, technology selection
  - "pattern" — Reusable code patterns, conventions, approaches
  - "postmortem" — Lessons learned, what went wrong, what to repeat
  - "requirement" — Functional or non-functional requirements
  - "bug" — Bug discoveries, root causes, fixes
  - "convention" — Naming, formatting, workflow conventions
- topics: array of 1-3 topic tags (lowercase, hyphenated)
- people: array of people mentioned (proper names)
- action_items: array of implied action items
- dates: array of dates mentioned (YYYY-MM-DD format)
Return ONLY valid JSON, no explanation.`;

const THOUGHT_TYPES = new Set<ThoughtType>([
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
  "decision",
  "meeting",
  "architecture",
  "pattern",
  "postmortem",
  "requirement",
  "bug",
  "convention",
]);

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeMetadataPayload(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const candidates = [objectStart, arrayStart].filter((index) => index >= 0);
  if (candidates.length === 0) {
    return trimmed;
  }

  const start = Math.min(...candidates);
  const lastObject = trimmed.lastIndexOf("}");
  const lastArray = trimmed.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  return end >= start ? trimmed.slice(start, end + 1).trim() : trimmed;
}

export function parseThoughtMetadata(content: string): ThoughtMetadataExtracted {
  const parsed = JSON.parse(normalizeMetadataPayload(content)) as Partial<ThoughtMetadataExtracted> | Array<Partial<ThoughtMetadataExtracted>>;
  const metadata = Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
  const type = typeof metadata.type === "string" && THOUGHT_TYPES.has(metadata.type as ThoughtType)
    ? metadata.type as ThoughtType
    : "observation";

  return {
    type,
    topics: stringArray(metadata.topics),
    people: stringArray(metadata.people),
    action_items: stringArray(metadata.action_items),
    dates: stringArray(metadata.dates),
  };
}
