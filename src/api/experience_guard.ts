import type { MemoryBankContext, MemoryBankDirectiveContext } from "../db/queries.js";

export interface ExperienceGuardResult {
  allowed: boolean;
  applied_directive_ids: string[];
  violations: string[];
}

function isPiiDirective(directive: MemoryBankDirectiveContext): boolean {
  const haystack = `${directive.name} ${directive.rule_text}`.toLowerCase();
  return (
    directive.severity === "hard" &&
    (haystack.includes("pii") ||
      haystack.includes("mrn") ||
      haystack.includes("phin") ||
      haystack.includes("dob") ||
      haystack.includes("sin") ||
      haystack.includes("patient name") ||
      haystack.includes("identifying medical"))
  );
}

export function detectExperienceSensitiveIdentifiers(content: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["MRN", /\bMRN\s*[:#-]?\s*[A-Z0-9-]{3,}\b/i],
    ["PHIN", /\bPHIN\s*[:#-]?\s*[A-Z0-9-]{3,}\b/i],
    ["DOB", /\bDOB\s*[:#-]?\s*\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/i],
    ["SIN", /\bSIN\s*[:#-]?\s*\d{3}[- ]?\d{3}[- ]?\d{3}\b/i],
    ["patient_name", /\bpatient\s+name\s*[:=-]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/],
    ["nine_digit_identifier", /\b(?:\d{3}[- ]?){2}\d{3}\b/],
  ];

  const seen = new Set<string>();
  for (const [label, pattern] of checks) {
    if (pattern.test(content)) seen.add(label);
  }
  return Array.from(seen);
}

export function guardExperienceRetainDirectives(
  content: string,
  memoryBank: MemoryBankContext | null | undefined
): ExperienceGuardResult {
  const piiDirectives = (memoryBank?.directives ?? []).filter(isPiiDirective);
  const appliedDirectiveIds = piiDirectives.map((directive) => directive.id);
  if (piiDirectives.length === 0) {
    return { allowed: true, applied_directive_ids: [], violations: [] };
  }

  const violations = detectExperienceSensitiveIdentifiers(content);
  return {
    allowed: violations.length === 0,
    applied_directive_ids: appliedDirectiveIds,
    violations,
  };
}
