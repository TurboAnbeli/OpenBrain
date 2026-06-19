import type { MemoryBankDirective, MemoryBankDirectiveInput, MemoryBankDirectiveUpdateInput } from "./api";

export const DIRECTIVE_BANK_ID = "openbrain";
export const DEFAULT_DIRECTIVE_SEVERITY = "required";

export interface DirectiveDraft {
  name: string;
  ruleText: string;
  appliesTo: string;
  severity: string;
  priority: string;
  active: boolean;
}

export function createEmptyDirectiveDraft(): DirectiveDraft {
  return {
    name: "",
    ruleText: "",
    appliesTo: "",
    severity: DEFAULT_DIRECTIVE_SEVERITY,
    priority: "0",
    active: true,
  };
}

export function createDirectiveDraft(directive: MemoryBankDirective): DirectiveDraft {
  return {
    name: directive.name,
    ruleText: directive.rule_text,
    appliesTo: directive.applies_to.join(", "),
    severity: directive.severity,
    priority: String(directive.priority),
    active: directive.active,
  };
}

export function parseDirectiveAppliesTo(value: string): string[] {
  const seen = new Set<string>();
  const appliesTo: string[] = [];

  for (const rawTarget of value.split(/[,\n]/)) {
    const target = rawTarget.trim().toLowerCase();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    appliesTo.push(target);
  }

  return appliesTo;
}

function parseDirectivePriority(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return /^[-+]?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function validateDirectiveDraft(draft: DirectiveDraft): string[] {
  const errors: string[] = [];

  if (!draft.name.trim()) errors.push("Name is required.");
  if (!draft.ruleText.trim()) errors.push("Rule text is required.");
  if (parseDirectiveAppliesTo(draft.appliesTo).length === 0) errors.push("At least one applies_to target is required.");
  if (!Number.isInteger(parseDirectivePriority(draft.priority))) errors.push("Priority must be an integer.");

  return errors;
}

export function buildDirectivePayload(draft: DirectiveDraft): MemoryBankDirectiveInput {
  const priority = parseDirectivePriority(draft.priority);

  return {
    bank_id: DIRECTIVE_BANK_ID,
    name: draft.name.trim(),
    rule_text: draft.ruleText.trim(),
    applies_to: parseDirectiveAppliesTo(draft.appliesTo),
    severity: draft.severity.trim() || DEFAULT_DIRECTIVE_SEVERITY,
    active: draft.active,
    priority: Number.isInteger(priority) ? priority : 0,
  };
}

export function buildDirectiveUpdatePayload(draft: DirectiveDraft): MemoryBankDirectiveUpdateInput {
  const payload = buildDirectivePayload(draft);
  const { bank_id: _bankId, ...updatePayload } = payload;
  return updatePayload;
}

export function isDirectiveDraftDirty(directive: MemoryBankDirective, draft: DirectiveDraft): boolean {
  const payload = buildDirectivePayload(draft);

  return (
    directive.name !== payload.name ||
    directive.rule_text !== payload.rule_text ||
    !arraysEqual(directive.applies_to, payload.applies_to ?? []) ||
    directive.severity !== payload.severity ||
    directive.active !== payload.active ||
    directive.priority !== payload.priority
  );
}

export function directiveAffectsReflect(directive: Pick<MemoryBankDirective, "active" | "applies_to">): boolean {
  return directive.active && directive.applies_to.includes("reflect");
}
