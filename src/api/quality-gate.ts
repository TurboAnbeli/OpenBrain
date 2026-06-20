/**
 * Shared quality gate for LLM-generated text.
 * Extracted from synthesize.ts and reflect.ts to eliminate duplication.
 */

export const REFUSE_PATTERNS = [
  /as an ai/i,
  /i (cannot|can't|don'?t know|am unable)/i,
  /i do not have (access|information|context)/i,
  /i('m| am) sorry/i,
  /please provide/i,
  /insufficient (information|context|data)/i,
];

/**
 * Returns true if the text passes quality checks:
 * - Length within [minLen, maxLen]
 * - No refusal patterns detected
 */
export function qualityGate(text: string, maxLen = 2000, minLen = 20): boolean {
  if (text.length < minLen || text.length > maxLen) return false;
  return !REFUSE_PATTERNS.some((p) => p.test(text));
}
