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

const SYNTHESIS_PROMPT = (contents: string[]): string => {
  const numbered = contents.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return (
    `You are a knowledge consolidation system. Synthesize these related observations into ` +
    `one comprehensive but concise note. Output only the synthesized text, no preamble, ` +
    `no explanation, no lists — just a single coherent paragraph.\n\n` +
    `Observations:\n${numbered}\n\nSynthesis:`
  );
};

export interface SynthesisOptions {
  endpoint: string;
  model: string;
  timeoutMs?: number;
}

export async function synthesizeObservation(
  contents: string[],
  opts: SynthesisOptions
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const response = await fetch(`${opts.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: SYNTHESIS_PROMPT(contents),
        stream: false,
        think: false,
        options: { num_predict: 300, temperature: 0.2, seed: 42 },
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
