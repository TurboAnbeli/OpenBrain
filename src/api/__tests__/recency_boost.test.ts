import { describe, it, expect } from "vitest";
import {
  hasSpecificityMarker,
  applyRecencyBoost,
  getEffectiveDate,
  RECENCY_WEIGHT,
  RECENCY_HORIZON_DAYS,
} from "../recency_boost.js";

describe("hasSpecificityMarker", () => {
  it.each([
    ["current Hermes orchestrator model production", true],
    ["which LLM runs the agent control loop on the home server now", true],
    ["latest model version", true],
    ["today's standup notes", true],
    ["software in use right now", true],
    ["copper structural supply deficit thesis", false],
    ["Hormuz export crude oil chokepoint", false],
    ["narrative smoothing buries contradictions", false],
  ])("query %p → %p", (q, expected) => {
    expect(hasSpecificityMarker(q)).toBe(expected);
  });
});

describe("applyRecencyBoost", () => {
  const NOW_MS = new Date("2026-05-31T23:59:59Z").getTime();

  it("prefers the newer thought when distance is close", () => {
    const old = { similarity: 0.734, created_at: new Date("2026-05-04T00:00:00Z") };
    const fresh = { similarity: 0.705, created_at: new Date("2026-05-20T00:00:00Z") };
    const out = applyRecencyBoost([old, fresh], RECENCY_WEIGHT, NOW_MS);
    expect(out[0]).toBe(fresh);
  });

  it("preserves order when similarities differ widely", () => {
    const top = { similarity: 0.95, created_at: new Date("2026-05-04T00:00:00Z") };
    const lower = { similarity: 0.60, created_at: new Date("2026-05-31T00:00:00Z") };
    const out = applyRecencyBoost([top, lower], RECENCY_WEIGHT, NOW_MS);
    expect(out[0]).toBe(top);
  });

  it("caps age contribution at the horizon", () => {
    const a = {
      similarity: 0.70,
      created_at: new Date(NOW_MS - (RECENCY_HORIZON_DAYS + 30) * 86400 * 1000),
    };
    const b = {
      similarity: 0.70,
      created_at: new Date(NOW_MS - RECENCY_HORIZON_DAYS * 86400 * 1000),
    };
    const out = applyRecencyBoost([a, b], RECENCY_WEIGHT, NOW_MS);
    // Both at or beyond horizon -> identical age contribution; stable sort
    expect(out[0]).toBe(a);
  });

  it("does not mutate input order", () => {
    const a = { similarity: 0.70, created_at: new Date("2026-05-04T00:00:00Z") };
    const b = { similarity: 0.71, created_at: new Date("2026-05-20T00:00:00Z") };
    const input = [a, b];
    applyRecencyBoost(input, RECENCY_WEIGHT, NOW_MS);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });

  it("prefers occurrence date from metadata over later ingest time", () => {
    const canonical = {
      similarity: 0.647,
      created_at: new Date("2026-05-20T14:29:30.798Z"),
      content:
        "Current Hermes orchestrator model: moonshotai/kimi-k2.6 via OpenRouter (as of 2026-05-20 session).",
      metadata: { dates: [] },
    };
    const promoted = {
      similarity: 0.625,
      created_at: new Date("2026-06-01T04:27:11.745Z"),
      content:
        '[agent-notes/decision 2026-05-21] hermes model stack + security posture title: "Hermes model stack + security posture (2026-05-21)"',
      metadata: { dates: ["2026-05-21"] },
    };

    const out = applyRecencyBoost([promoted, canonical], RECENCY_WEIGHT, NOW_MS);
    expect(out[0]).toBe(canonical);
  });
});

describe("getEffectiveDate", () => {
  it("prefers metadata dates when present", () => {
    const result = getEffectiveDate({
      similarity: 0.7,
      created_at: new Date("2026-06-01T00:00:00Z"),
      metadata: { dates: ["2026-05-20", "2026-05-21"] },
      content: "Current stack as of 2026-05-19.",
    });
    expect(result.toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });

  it("falls back to latest ISO date in content when metadata dates are absent", () => {
    const result = getEffectiveDate({
      similarity: 0.7,
      created_at: new Date("2026-06-01T00:00:00Z"),
      content:
        "Current Hermes orchestrator model: moonshotai/kimi-k2.6 via OpenRouter (as of 2026-05-20 session). Supersedes prior minimax/minimax-m2.7 configuration from 2026-04-30.",
      metadata: { dates: [] },
    });
    expect(result.toISOString()).toBe("2026-05-20T00:00:00.000Z");
  });

  it("falls back to created_at when no occurrence date exists", () => {
    const createdAt = new Date("2026-06-01T00:00:00Z");
    const result = getEffectiveDate({
      similarity: 0.7,
      created_at: createdAt,
      content: "No explicit date here.",
      metadata: { dates: [] },
    });
    expect(result).toBe(createdAt);
  });
});
