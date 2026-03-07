/**
 * Shared types and interface for embedding providers.
 */

export interface ThoughtMetadataExtracted {
  type: string;
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
- type: one of "observation", "task", "idea", "reference", "person_note", "decision", "meeting"
- topics: array of 1-3 topic tags (lowercase, hyphenated)
- people: array of people mentioned (proper names)
- action_items: array of implied action items
- dates: array of dates mentioned (YYYY-MM-DD format)
Return ONLY valid JSON, no explanation.`;
