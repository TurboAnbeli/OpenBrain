import { describe, expect, it } from "vitest";

import type { MemoryBankDirective } from "./api";
import {
  buildDirectivePayload,
  createDirectiveDraft,
  directiveAffectsReflect,
  isDirectiveDraftDirty,
  validateDirectiveDraft,
  type DirectiveDraft,
} from "./directiveEditorState";

const directive: MemoryBankDirective = {
  id: "dir-1",
  bank_id: "openbrain",
  name: "Reflect source guard",
  rule_text: "Preserve explicit source boundaries.",
  applies_to: ["reflect", "capture"],
  severity: "required",
  active: true,
  priority: 10,
  revision: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const baseDraft: DirectiveDraft = {
  name: "Reflect source guard",
  ruleText: "Preserve explicit source boundaries.",
  appliesTo: "reflect, capture",
  severity: "required",
  priority: "10",
  active: true,
};

describe("directive editor state", () => {
  it("creates a clean draft from a directive and detects reflect impact", () => {
    const draft = createDirectiveDraft(directive);

    expect(draft).toEqual(baseDraft);
    expect(isDirectiveDraftDirty(directive, draft)).toBe(false);
    expect(isDirectiveDraftDirty(directive, { ...draft, ruleText: "Updated rule." })).toBe(true);
    expect(directiveAffectsReflect(directive)).toBe(true);
    expect(directiveAffectsReflect({ ...directive, active: false })).toBe(false);
    expect(directiveAffectsReflect({ ...directive, applies_to: ["capture"] })).toBe(false);
    expect(directiveAffectsReflect({ ...directive, applies_to: ["Reflect"] })).toBe(false);
  });

  it("builds a payload with trimmed fields, deduped applies_to, and integer priority", () => {
    const payload = buildDirectivePayload({
      name: "  Reflect policy  ",
      ruleText: "  Cite the source document.  ",
      appliesTo: " Reflect, capture\nREFLECT , Summarize ",
      severity: " required ",
      priority: " 7 ",
      active: true,
    });

    expect(payload).toEqual({
      bank_id: "openbrain",
      name: "Reflect policy",
      rule_text: "Cite the source document.",
      applies_to: ["reflect", "capture", "summarize"],
      severity: "required",
      active: true,
      priority: 7,
    });
  });

  it("builds payloads for the selected bank and falls back to openbrain", () => {
    expect(buildDirectivePayload(baseDraft, " research ")).toEqual({
      bank_id: "research",
      name: "Reflect source guard",
      rule_text: "Preserve explicit source boundaries.",
      applies_to: ["reflect", "capture"],
      severity: "required",
      active: true,
      priority: 10,
    });

    expect(buildDirectivePayload(baseDraft, "   ").bank_id).toBe("openbrain");
  });

  it("validates required name, rule, applies_to, and integer priority", () => {
    expect(
      validateDirectiveDraft({
        name: " ",
        ruleText: " ",
        appliesTo: " , \n ",
        severity: "required",
        priority: "1",
        active: true,
      })
    ).toEqual(["Name is required.", "Rule text is required.", "At least one applies_to target is required."]);

    expect(validateDirectiveDraft({ ...baseDraft, priority: "1.5" })).toEqual(["Priority must be an integer."]);
    expect(validateDirectiveDraft({ ...baseDraft, priority: "abc" })).toEqual(["Priority must be an integer."]);
  });
});
