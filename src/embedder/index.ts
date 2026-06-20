import type { Embedder } from "./types.js";
import { OllamaEmbedder } from "./ollama.js";
import { OpenRouterEmbedder } from "./openrouter.js";
import { AzureOpenAIEmbedder } from "./azure-openai.js";
import { LlamaServerEmbedder } from "./llama-server.js";
import { ResilientEmbedder, type CircuitStates } from "./circuit-breaker.js";

export type { Embedder, ThoughtMetadataExtracted } from "./types.js";
export { CircuitBreaker, ResilientEmbedder, type CircuitBreakerOptions, type CircuitState } from "./circuit-breaker.js";

let _embedder: Embedder | null = null;

/** Resolve fallback provider names from environment (comma-separated EMBEDDER_FALLBACKS). */
function resolveFallbackProviders(): string[] {
  const raw = process.env.EMBEDDER_FALLBACKS ?? "";
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Instantiate an embedder by provider name. */
function createEmbedder(provider: string): Embedder {
  switch (provider) {
    case "ollama":
      return new OllamaEmbedder();
    case "openrouter":
      return new OpenRouterEmbedder();
    case "azure-openai":
      return new AzureOpenAIEmbedder();
    case "llama-server":
      return new LlamaServerEmbedder();
    default:
      throw new Error(
        'Unknown embedder provider: "' + provider + '". Use "ollama", "openrouter", "azure-openai", or "llama-server".'
      );
  }
}

export function getEmbedder(): Embedder {
  if (!_embedder) {
    const provider = (process.env.EMBEDDER_PROVIDER ?? "ollama").toLowerCase();
    const primary = createEmbedder(provider);
    const fallbackProviders = resolveFallbackProviders();

    // Filter out the primary from fallbacks to avoid circular self-reference
    const distinctFallbacks = fallbackProviders.filter((p) => p !== provider);
    const fallbacks = distinctFallbacks.map((p) => createEmbedder(p));

    if (fallbacks.length > 0) {
      _embedder = new ResilientEmbedder(primary, fallbacks);
      console.error(
        `[embedder] ResilientEmbedder: primary=${provider}, fallbacks=${distinctFallbacks.join(",")}`
      );
    } else {
      _embedder = primary;
      console.error(`[embedder] Single embedder: ${provider} (no fallbacks configured)`);
    }
  }

  return _embedder;
}

/** Get circuit breaker states for monitoring. Returns null if not using ResilientEmbedder. */
export function getEmbedderCircuitStates(): CircuitStates | null {
  if (_embedder instanceof ResilientEmbedder) {
    return _embedder.getCircuitStates();
  }
  return null;
}

/** Reset all circuit breakers (e.g., after embedder switch). */
export function resetAllCircuits(): void {
  if (_embedder instanceof ResilientEmbedder) {
    _embedder.resetAllCircuits();
  }
}

export function resetEmbedder(): void {
  _embedder = null;
}

export function getEmbedderProviders(): string[] {
  return ["ollama", "openrouter", "azure-openai", "llama-server"];
}
