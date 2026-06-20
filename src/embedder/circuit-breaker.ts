/**
 * CircuitBreaker and ResilientEmbedder for self-healing embedder resilience.
 *
 * CircuitBreaker tracks consecutive failures and transitions through
 * CLOSED → OPEN → HALF_OPEN states to prevent thundering-herd retries
 * against a downed embedder service.
 *
 * ResilientEmbedder wraps a primary Embedder with zero or more fallback
 * Embedders, each guarded by its own CircuitBreaker. When the primary
 * fails (or its circuit is open), it tries fallbacks in order. When
 * all fail, it throws an aggregate error.
 */

import type { Embedder } from "./types.js";

// ─── CircuitBreaker ────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before tripping OPEN. Default: 3 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN before transitioning to HALF_OPEN. Default: 30000 */
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  }

  getState(): CircuitState {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      }
    }
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === "HALF_OPEN") {
      // Single failure in half-open reopens the circuit
      this.state = "OPEN";
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  /** Force the circuit open regardless of threshold (e.g., on explicit health check failure). */
  trip(): void {
    this.state = "OPEN";
    this.lastFailureTime = Date.now();
  }

  /** Force the circuit closed and clear failure count (e.g., on manual reset). */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
  }

  /** Returns true if the circuit allows a request through (CLOSED or HALF_OPEN). */
  allowsRequest(): boolean {
    const state = this.getState();
    return state === "CLOSED" || state === "HALF_OPEN";
  }
}

// ─── ResilientEmbedder ─────────────────────────────────────────────

export interface ResilientEmbedderOptions {
  /** Override the primary embedder's circuit breaker (useful for testing or shared state). */
  primaryBreaker?: CircuitBreaker;
  /** Override circuit breaker options for fallback embedders. */
  fallbackBreakerOptions?: CircuitBreakerOptions;
}

export interface CircuitStates {
  primary: CircuitState;
  fallbacks: CircuitState[];
}

export class ResilientEmbedder implements Embedder {
  private readonly primary: Embedder;
  private readonly fallbacks: Embedder[];
  private readonly primaryBreaker: CircuitBreaker;
  private readonly fallbackBreakers: CircuitBreaker[];

  constructor(primary: Embedder, fallbacks: Embedder[] = [], options: ResilientEmbedderOptions = {}) {
    this.primary = primary;
    this.fallbacks = fallbacks;
    this.primaryBreaker = options.primaryBreaker ?? new CircuitBreaker(options.fallbackBreakerOptions);
    this.fallbackBreakers = fallbacks.map(
      () => new CircuitBreaker(options.fallbackBreakerOptions ?? {
        failureThreshold: 3,
        resetTimeoutMs: 30_000,
      })
    );
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const errors: Error[] = [];

    // Try primary if circuit allows
    if (this.primaryBreaker.allowsRequest()) {
      try {
        const result = await this.primary.generateEmbedding(text);
        this.primaryBreaker.recordSuccess();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        this.primaryBreaker.recordFailure();
      }
    }

    // Try fallbacks in order
    for (let i = 0; i < this.fallbacks.length; i++) {
      const breaker = this.fallbackBreakers[i]!;
      if (!breaker.allowsRequest()) continue;

      try {
        const result = await this.fallbacks[i]!.generateEmbedding(text);
        breaker.recordSuccess();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        breaker.recordFailure();
      }
    }

    throw new Error(
      `All embedders failed: ${errors.map((e, i) => `[${i}] ${e.message}`).join("; ")}`
    );
  }

  async extractMetadata(content: string): Promise<import("./types.js").ThoughtMetadataExtracted> {
    const errors: Error[] = [];

    // Try primary if circuit allows
    if (this.primaryBreaker.allowsRequest()) {
      try {
        const result = await this.primary.extractMetadata(content);
        this.primaryBreaker.recordSuccess();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        this.primaryBreaker.recordFailure();
      }
    }

    // Try fallbacks in order
    for (let i = 0; i < this.fallbacks.length; i++) {
      const breaker = this.fallbackBreakers[i]!;
      if (!breaker.allowsRequest()) continue;

      try {
        const result = await this.fallbacks[i]!.extractMetadata(content);
        breaker.recordSuccess();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push(error);
        breaker.recordFailure();
      }
    }

    // If all embedders fail for metadata, return defaults rather than throwing
    // Metadata extraction is non-critical — we can still store the thought
    // with default metadata and re-extract later.
    console.warn(
      `[embedder] All metadata extractors failed: ${errors.map((e) => e.message).join("; ")}. Returning defaults.`
    );
    return {
      type: "observation",
      topics: [],
      people: [],
      action_items: [],
      dates: [],
    };
  }

  getVersion(): string {
    // Return the primary version when circuit is healthy, otherwise first available fallback
    if (this.primaryBreaker.allowsRequest()) {
      return this.primary.getVersion();
    }
    for (let i = 0; i < this.fallbacks.length; i++) {
      if (this.fallbackBreakers[i]!.allowsRequest()) {
        return this.fallbacks[i]!.getVersion();
      }
    }
    // All circuits open — still return primary version as canonical identifier
    return this.primary.getVersion();
  }

  /** Inspect circuit breaker states for monitoring/diagnostics. */
  getCircuitStates(): CircuitStates {
    return {
      primary: this.primaryBreaker.getState(),
      fallbacks: this.fallbackBreakers.map((cb) => cb.getState()),
    };
  }

  /** Reset all circuit breakers (useful after embedder switch). */
  resetAllCircuits(): void {
    this.primaryBreaker.reset();
    for (const cb of this.fallbackBreakers) {
      cb.reset();
    }
  }
}
