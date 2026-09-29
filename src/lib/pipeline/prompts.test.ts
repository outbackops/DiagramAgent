import { describe, expect, it } from "vitest";
import { CLARIFY_SYSTEM_PROMPT } from "@/lib/pipeline/prompts";

describe("CLARIFY_SYSTEM_PROMPT", () => {
  it("keeps the clarify contract while adding architecture trust policy fields", () => {
    expect(CLARIFY_SYSTEM_PROMPT).toContain('"analysis"');
    expect(CLARIFY_SYSTEM_PROMPT).toContain('"skipClarification"');
    expect(CLARIFY_SYSTEM_PROMPT).toContain('"questions"');
    expect(CLARIFY_SYSTEM_PROMPT).toContain('"situation": "existing"');
    expect(CLARIFY_SYSTEM_PROMPT).toContain("greenfield");
    expect(CLARIFY_SYSTEM_PROMPT).toContain("proposed_assumptions");
    expect(CLARIFY_SYSTEM_PROMPT).toContain("never list inferred components as stated facts");
    expect(CLARIFY_SYSTEM_PROMPT).toContain("For existing systems, the inference rule does not apply");
  });
});
