/**
 * Reflect engine — agentic answer over the Hindsight 3-tier cascade.
 *
 * Calls the local LLM with bank mission/disposition/directives as binding
 * constraints, plus the cascade evidence (mental models → consolidated
 * observations → raw facts). Returns the LLM's answer or null if the response
 * fails the refusal/length quality gate.
 *
 * The LLM call shape matches src/api/synthesize.ts so consolidation,
 * mental-model refresh, and reflect all use the same Ollama-compatible
 * /api/generate endpoint.
 */

import { qualityGate } from "./quality-gate.js";
import type { SynthesisMemoryBankContext } from "./synthesize.js";



export interface ReflectCascadeEntry {
  id: string;
  label?: string | null;
  content: string;
}

export interface ReflectCascadeContext {
  mental_models: ReflectCascadeEntry[];
  consolidated_observations: ReflectCascadeEntry[];
  raw_facts: ReflectCascadeEntry[];
}

export interface ReflectOptions {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  memoryBank?: SynthesisMemoryBankContext;
}

function renderMemoryBankContext(memoryBank?: SynthesisMemoryBankContext): string {
  if (!memoryBank) return "";
  const lines = [`Memory bank: ${memoryBank.name}`];
  if (memoryBank.mission) lines.push(`Mission: ${memoryBank.mission}`);
  const directives = memoryBank.directives ?? [];
  if (directives.length > 0) {
    lines.push(
      "These directives are binding constraints for this reflection. Follow hard directives even if cascade evidence conflicts with them."
    );
    for (const directive of directives) {
      lines.push(`${directive.severity.toUpperCase()} directive ${directive.name}: ${directive.rule_text}`);
    }
  }
  return `${lines.join("\n")}\n\n`;
}

function renderTier(label: string, entries: ReflectCascadeEntry[]): string {
  if (entries.length === 0) return `${label}: (none)\n`;
  const lines = entries.map((entry, index) => {
    const heading = entry.label ? `[${entry.id}; ${entry.label}]` : `[${entry.id}]`;
    return `${index + 1}. ${heading} ${entry.content}`;
  });
  return `${label}:\n${lines.join("\n")}\n`;
}

export function buildReflectPrompt(
  query: string,
  cascade: ReflectCascadeContext,
  memoryBank?: SynthesisMemoryBankContext
): string {
  return (
    `You are an agent reflecting over a personal memory system. Answer the user's question ` +
    `using only the cascade evidence below. Cascade priority is binding: prefer mental models, ` +
    `then consolidated observations, then raw facts. Cite the rows that ground your answer by ` +
    `including their bracketed ids inline. Output one concise paragraph. Do not invent facts and ` +
    `do not average conflicting evidence.\n\n` +
    renderMemoryBankContext(memoryBank) +
    `Question: ${query}\n\n` +
    `Tier 1 — Mental models (highest priority):\n${renderTier("Tier 1", cascade.mental_models)}\n` +
    `Tier 2 — Consolidated observations:\n${renderTier("Tier 2", cascade.consolidated_observations)}\n` +
    `Tier 3 — Raw facts:\n${renderTier("Tier 3", cascade.raw_facts)}\n` +
    `Reflection:`
  );
}

export async function reflectAnswer(
  query: string,
  cascade: ReflectCascadeContext,
  opts: ReflectOptions
): Promise<string | null> {
  const prompt = buildReflectPrompt(query, cascade, opts.memoryBank);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const response = await fetch(`${opts.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt,
        stream: false,
        think: false,
        options: { num_predict: 400, temperature: 0.2, seed: 42 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    const text = (data.response ?? "").trim();
    return qualityGate(text, 4000) ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
