/**
 * CircuitBreaker + ResilientEmbedder tests
 * RED phase: these tests define the desired behavior before implementation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── CircuitBreaker ────────────────────────────────────────────────

describe("CircuitBreaker", () => {
  // We'll import after implementation; for now define expected behavior
  // and let the import fail to confirm RED state.

  it("starts in CLOSED state", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.getFailureCount()).toBe(0);
  });

  it("transitions to OPEN after reaching failure threshold", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("OPEN");
  });

  it("stays CLOSED below failure threshold", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("CLOSED");
  });

  it("transitions to HALF_OPEN after reset timeout", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("OPEN");
    vi.advanceTimersByTime(5001);
    expect(cb.getState()).toBe("HALF_OPEN");
    vi.useRealTimers();
  });

  it("closes circuit on success in HALF_OPEN state", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5001);
    expect(cb.getState()).toBe("HALF_OPEN");
    cb.recordSuccess();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.getFailureCount()).toBe(0);
    vi.useRealTimers();
  });

  it("reopens circuit on failure in HALF_OPEN state", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    vi.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(5001);
    expect(cb.getState()).toBe("HALF_OPEN");
    cb.recordFailure();
    expect(cb.getState()).toBe("OPEN");
    vi.useRealTimers();
  });

  it("resets failure count on success in CLOSED state", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
  });

  it("trip() forces OPEN state regardless of threshold", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 10, resetTimeoutMs: 5000 });
    cb.trip();
    expect(cb.getState()).toBe("OPEN");
  });

  it("reset() forces CLOSED state and clears failures", async () => {
    const { CircuitBreaker } = await import("../circuit-breaker.js");
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.reset();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.getFailureCount()).toBe(0);
  });
});

// ─── ResilientEmbedder ────────────────────────────────────────────

describe("ResilientEmbedder", () => {
  const makeEmbedder = (succeed: boolean, version = "test-v1") => ({
    generateEmbedding: vi.fn(succeed
      ? async () => [0.1, 0.2, 0.3]
      : async () => { throw new Error("Embedder unavailable"); }
    ),
    extractMetadata: vi.fn(succeed
      ? async () => ({ type: "observation" as const, topics: ["test"], people: [], action_items: [], dates: [] })
      : async () => { throw new Error("Metadata unavailable"); }
    ),
    getVersion: () => version,
  });

  it("uses primary embedder when healthy", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(true, "primary-v1");
    const fallback = makeEmbedder(true, "fallback-v1");
    const re = new ResilientEmbedder(primary, [fallback]);
    const result = await re.generateEmbedding("hello");
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(primary.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(fallback.generateEmbedding).not.toHaveBeenCalled();
  });

  it("falls back to next embedder when primary fails", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(false, "primary-v1");
    const fallback = makeEmbedder(true, "fallback-v1");
    const re = new ResilientEmbedder(primary, [fallback]);
    const result = await re.generateEmbedding("hello");
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(primary.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(fallback.generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("tries all fallbacks before throwing", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(false, "p");
    const fb1 = makeEmbedder(false, "f1");
    const fb2 = makeEmbedder(false, "f2");
    const re = new ResilientEmbedder(primary, [fb1, fb2]);
    await expect(re.generateEmbedding("hello")).rejects.toThrow("All embedders failed");
    expect(primary.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(fb1.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(fb2.generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("skips embedders with open circuit breakers", async () => {
    const { ResilientEmbedder, CircuitBreaker } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(false, "p");
    const fb1 = makeEmbedder(true, "f1");
    // Trip the primary's circuit so it's skipped entirely
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });
    cb.recordFailure(); // trip it open
    const re = new ResilientEmbedder(primary, [fb1], { primaryBreaker: cb });
    const result = await re.generateEmbedding("hello");
    // Primary should be skipped (circuit open), fallback used
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(primary.generateEmbedding).not.toHaveBeenCalled();
    expect(fb1.generateEmbedding).toHaveBeenCalledTimes(1);
  });

  it("extractMetadata falls back on failure", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(true, "p");
    // Override extractMetadata to fail on primary
    primary.extractMetadata = vi.fn(async () => { throw new Error("Metadata unavailable"); });
    const fallback = makeEmbedder(true, "f1");
    const re = new ResilientEmbedder(primary, [fallback]);
    const result = await re.extractMetadata("some content");
    expect(result.type).toBe("observation");
    expect(primary.extractMetadata).toHaveBeenCalledTimes(1);
    expect(fallback.extractMetadata).toHaveBeenCalledTimes(1);
  });

  it("getVersion returns primary version when circuit is closed", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(true, "primary-v1");
    const fallback = makeEmbedder(true, "fallback-v1");
    const re = new ResilientEmbedder(primary, [fallback]);
    expect(re.getVersion()).toBe("primary-v1");
  });

  it("returns circuit breaker states via getCircuitStates()", async () => {
    const { ResilientEmbedder } = await import("../circuit-breaker.js");
    const primary = makeEmbedder(true, "p");
    const fallback = makeEmbedder(true, "f1");
    const re = new ResilientEmbedder(primary, [fallback]);
    const states = re.getCircuitStates();
    expect(states.primary).toBe("CLOSED");
    expect(states.fallbacks).toHaveLength(1);
    expect(states.fallbacks[0]).toBe("CLOSED");
  });
});
