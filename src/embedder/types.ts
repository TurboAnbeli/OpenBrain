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
