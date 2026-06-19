import type { Embedder } from "./types.js";
import { OllamaEmbedder } from "./ollama.js";
import { OpenRouterEmbedder } from "./openrouter.js";
import { AzureOpenAIEmbedder } from "./azure-openai.js";
import { LlamaServerEmbedder } from "./llama-server.js";

export type { Embedder, ThoughtMetadataExtracted } from "./types.js";

let _embedder: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (!_embedder) {
    const provider = (process.env.EMBEDDER_PROVIDER ?? "ollama").toLowerCase();

    switch (provider) {
      case "ollama":
        _embedder = new OllamaEmbedder();
        break;
      case "openrouter":
        _embedder = new OpenRouterEmbedder();
        break;
      case "azure-openai":
        _embedder = new AzureOpenAIEmbedder();
        break;
      case "llama-server":
        _embedder = new LlamaServerEmbedder();
        break;
      default:
        throw new Error(
          'Unknown embedder provider: "' + provider + '". Use "ollama", "openrouter", "azure-openai", or "llama-server".'
        );
    }
  }

  return _embedder;
}

export function resetEmbedder(): void {
  _embedder = null;
}

export function getEmbedderProviders(): string[] {
  return ["ollama", "openrouter", "azure-openai", "llama-server"];
}
