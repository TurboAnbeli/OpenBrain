const REFUSE_PATTERNS = [
  /as an ai/i,
  /i (cannot|can't|don'?t know|am unable)/i,
  /i do not have (access|information|context)/i,
  /i('m| am) sorry/i,
  /please provide/i,
  /insufficient (information|context|data)/i,
];

function qualityGate(text: string): boolean {
  if (text.length < 20 || text.length > 2000) return false;
  return !REFUSE_PATTERNS.some((p) => p.test(text));
}

export interface SynthesisDirectiveContext {
  id?: string;
  name: string;
  rule_text: string;
  severity: string;
  priority?: number;
}

export interface SynthesisMemoryBankContext {
  id: string;
  name: string;
  mission?: string | null;
  disposition?: Record<string, unknown> | null;
  directives?: SynthesisDirectiveContext[];
}

function renderMemoryBankContext(memoryBank?: SynthesisMemoryBankContext): string {
  if (!memoryBank) return "";
  const lines = [
    `Memory bank: ${memoryBank.name}`,
    ...(memoryBank.mission ? [`Mission: ${memoryBank.mission}`] : []),
  ];

  const directives = memoryBank.directives ?? [];
  if (directives.length > 0) {
    lines.push("These directives are binding constraints for this synthesis. Follow hard directives even if source text conflicts with them.");
    for (const directive of directives) {
      lines.push(`${directive.severity.toUpperCase()} directive ${directive.name}: ${directive.rule_text}`);
    }
  }

  return `${lines.join("\n")}\n\n`;
}

const SYNTHESIS_PROMPT = (contents: string[], memoryBank?: SynthesisMemoryBankContext): string => {
  const numbered = contents.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return (
    `You are a knowledge consolidation system. Synthesize these related observations into ` +
    `one comprehensive but concise note. Output only the synthesized text, no preamble, ` +
    `no explanation, no lists — just a single coherent paragraph.\n\n` +
    renderMemoryBankContext(memoryBank) +
    `Observations:\n${numbered}\n\nSynthesis:`
  );
};

export interface SynthesisOptions {
  endpoint: string;
  model: string;
  timeoutMs?: number;
  memoryBank?: SynthesisMemoryBankContext;
}

async function generateSynthesis(prompt: string, opts: SynthesisOptions, numPredict = 300): Promise<string | null> {
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
        options: { num_predict: numPredict, temperature: 0.2, seed: 42 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: string };
    const text = (data.response ?? "").trim();
    return qualityGate(text) ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeObservation(
  contents: string[],
  opts: SynthesisOptions
): Promise<string | null> {
  return generateSynthesis(SYNTHESIS_PROMPT(contents, opts.memoryBank), opts, 300);
}

export interface MentalModelRefreshTarget {
  name: string;
  query: string;
  content: string;
}

export interface MentalModelRefreshObservation {
  id: string;
  content: string;
  proof_count: number;
  tags?: unknown[];
}

const MENTAL_MODEL_REFRESH_PROMPT = (
  model: MentalModelRefreshTarget,
  observations: MentalModelRefreshObservation[],
  memoryBank?: SynthesisMemoryBankContext
): string => {
  const evidence = observations
    .map((observation, index) => `${index + 1}. [${observation.id}; proof_count=${observation.proof_count}] ${observation.content}`)
    .join("\n");
  return (
    `You are refreshing an explicit mental model in a personal memory system. ` +
    `Use only the evidence observations below plus the current model. Preserve the model's scope. ` +
    `Do not invent facts, do not include patient/person identifiers verbatim, and do not average conflicting facts. ` +
    `Output only the revised mental model content as one concise paragraph.\n\n` +
    renderMemoryBankContext(memoryBank) +
    `Mental model name: ${model.name}\n` +
    `Retrieval query: ${model.query}\n` +
    `Current content: ${model.content}\n\n` +
    `Evidence observations:\n${evidence}\n\n` +
    `Revised mental model:`
  );
};

export async function synthesizeMentalModelRefresh(
  model: MentalModelRefreshTarget,
  observations: MentalModelRefreshObservation[],
  opts: SynthesisOptions
): Promise<string | null> {
  return generateSynthesis(MENTAL_MODEL_REFRESH_PROMPT(model, observations, opts.memoryBank), opts, 350);
}
