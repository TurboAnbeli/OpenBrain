import { describe, it, expect } from "vitest";

import { guardExperienceRetainDirectives } from "../experience_guard.js";

describe("guardExperienceRetainDirectives", () => {
  const memoryBank = {
    id: "openbrain",
    name: "OpenBrain",
    mission: null,
    disposition: {},
    project: null,
    directives: [
      {
        id: "741a9339-ceb3-468b-81ac-616567382122",
        bank_id: "openbrain",
        name: "no_pii_verbatim",
        rule_text: "Never store MRN, PHIN, DOB, SIN, patient names, or identifying medical details verbatim.",
        applies_to: ["retain"],
        severity: "hard",
        active: true,
        priority: 100,
        revision: 1,
      },
    ],
  };

  it("blocks obvious medical/person identifiers when the hard retain PII directive is active", () => {
    const result = guardExperienceRetainDirectives("Patient name: Jane Smith, MRN 123456", memoryBank);

    expect(result.allowed).toBe(false);
    expect(result.applied_directive_ids).toEqual(["741a9339-ceb3-468b-81ac-616567382122"]);
    expect(result.violations.join(" ")).toContain("MRN");
  });

  it("allows ordinary operational summaries and returns applied directive ids", () => {
    const result = guardExperienceRetainDirectives("Ran Slice D smoke tests and archived the temporary experience rows.", memoryBank);

    expect(result.allowed).toBe(true);
    expect(result.applied_directive_ids).toEqual(["741a9339-ceb3-468b-81ac-616567382122"]);
  });
});
