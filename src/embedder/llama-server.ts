/**
 * Llama-server embedder — local OpenAI-compatible endpoint.
 * Uses a llama.cpp server for embeddings; Ollama fallback for LLM metadata extraction.
 */

import {
  type Embedder,
  type ThoughtMetadataExtracted,
  DEFAULT_METADATA,
  METADATA_PROMPT,
  parseThoughtMetadata,
} from "./types.js";

export class LlamaServerEmbedder implements Embedder {
  private readonly endpoint: string;
  private readonly embedModel: string;
  private readonly apiKey: string;
  private readonly llmEndpoint: string;
  private readonly llmModel: string;

  constructor() {
    this.endpoint = process.env.LLAMA_SERVER_ENDPOINT ?? "http://127.0.0.1:8089";
    this.embedModel = process.env.LLAMA_SERVER_EMBED_MODEL ?? "harrier-oss-v1-0.6B-BF16.gguf";
    this.apiKey = process.env.LLAMA_SERVER_API_KEY ?? "";
    // Fallback to Ollama for metadata extraction (llama-server may be embedding-only)
    this.llmEndpoint = process.env.LLAMA_SERVER_LLM_ENDPOINT
      ?? process.env.OPENBRAIN_LLM_CONSOLIDATION_ENDPOINT
      ?? process.env.OPENBRAIN_SYNTHESIS_ENDPOINT
      ?? process.env.OLLAMA_ENDPOINT
      ?? "http://127.0.0.1:11434";
    this.llmModel = process.env.LLAMA_SERVER_LLM_MODEL
      ?? process.env.OPENBRAIN_LLM_CONSOLIDATION_MODEL
      ?? process.env.OPENBRAIN_SYNTHESIS_MODEL
      ?? process.env.CONSOLIDATION_MODEL
      ?? process.env.SYNTHESIS_MODEL
      ?? process.env.OLLAMA_LLM_MODEL
      ?? "llama3.2";

    console.error(
      "[embedder] LlamaServer -> " + this.endpoint + " (embed: " + this.embedModel + ", llm fallback: " + this.llmEndpoint + "/" + this.llmModel + ")"    );
  }

  getVersion(): string {
    return this.embedModel;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const url = this.endpoint + "/v1/embeddings";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: "Bearer " + this.apiKey } : {}),
      },
      body: JSON.stringify({ model: this.embedModel, input: text }),
    });

    if (!response.ok) {
      const msg = "LlamaServer embed failed: " + response.status + " " + response.statusText;
      throw new Error(msg);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const embedding = data.data[0]?.embedding;

    if (!embedding) {
      throw new Error("LlamaServer returned empty embedding");
    }

    return embedding;
  }

  async extractMetadata(content: string): Promise<ThoughtMetadataExtracted> {
    const url = this.llmEndpoint + "/api/chat";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.llmModel,
        messages: [
          { role: "system", content: METADATA_PROMPT },
          { role: "user", content },
        ],
        format: "json",
        stream: false,
      }),
    });

    if (!response.ok) {
      console.warn("[embedder] Ollama metadata extraction failed: " + response.status);
      return DEFAULT_METADATA;
    }

    const data = (await response.json()) as { message: { content: string } };

    try {
      return parseThoughtMetadata(data.message.content);
    } catch (e) {
      console.warn("[embedder] Failed to parse metadata JSON:", e);
      return DEFAULT_METADATA;
    }
  }
}
