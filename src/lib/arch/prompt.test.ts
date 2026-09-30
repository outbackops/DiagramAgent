import { describe, expect, it } from "vitest";
import { getIconKeys } from "@/lib/icon-registry";
import { normalizeArchSpec } from "@/lib/arch/normalize";
import {
  ARCHITECTURE_EXAMPLES,
  ARCHITECTURE_LANGUAGE,
  ARCH_ASSESSMENT_ADDENDUM,
  archEditPrompt,
  buildArchitectSystemPrompt,
  cleanArchOutput,
} from "@/lib/arch/prompt";

describe("Architecture prompt", () => {
  it("contains the trust policy, grammar summary and provider icon keys", () => {
    const prompt = buildArchitectSystemPrompt(getIconKeys());
    expect(prompt).toContain("TRUST POLICY");
    expect(prompt).toContain("Facts the user did not give are never presented as facts");
    expect(prompt).toContain("items:");
    expect(prompt).toContain("connections?:");
    expect(prompt).toContain("sequences?:");
    expect(prompt).toContain("overlays?:");
    expect(prompt).toContain("assumptions?:");
    expect(prompt).toMatch(/AZURE:[\s\S]*azure-/);
    expect(prompt).toMatch(/AWS:[\s\S]*aws-/);
    expect(prompt).toMatch(/GCP:[\s\S]*gcp-/);
    expect(prompt).toMatch(/KUBERNETES:[\s\S]*k8s-/);
  });

  it("normalises every example with no warnings", () => {
    const results = ARCHITECTURE_EXAMPLES.map((example) => normalizeArchSpec(example));
    expect(results.map((result) => result.warnings)).toEqual(ARCHITECTURE_EXAMPLES.map(() => []));
  });

  it("keeps the AWS existing-system example free of invented CIDR or SKU facts", () => {
    const aws = JSON.stringify(ARCHITECTURE_EXAMPLES[1]);
    expect(aws).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/);
    expect(aws).not.toMatch(/\b(?:t\d|m\d|c\d|r\d|Standard|Premium|Business Critical|Basic|P\d|S\d)\b/i);
  });

  it("asks edits to keep stable ids", () => {
    expect(archEditPrompt("add monitoring")).toContain("Keep ids stable");
  });

  it("cleans fenced or prefaced JSON output", () => {
    expect(cleanArchOutput('Here is the spec:\n```json\n{"title":"X","items":["A"]}\n```\nDone')).toBe('{\n  "title": "X",\n  "items": [\n    "A"\n  ]\n}');
    expect(cleanArchOutput('{"title":"X"}\n```')).toBe('{\n  "title": "X"\n}');
  });

  it("exposes architecture assessment and repair language", () => {
    expect(ARCH_ASSESSMENT_ADDENDUM).toContain("platform conventions");
    expect(ARCHITECTURE_LANGUAGE.renderFixPrompt("bad endpoint")).toContain("bad endpoint");
    expect(
      ARCHITECTURE_LANGUAGE.structuralFixPrompt({
        score: 72,
        checks: [{ id: "x", label: "Missing protocol label", status: "fail" }],
      } as never),
    ).toContain("Missing protocol label");
    expect(ARCHITECTURE_LANGUAGE.reviewFixPrompt({ score: 6, pass: false, layout_issues: ["wrong boundary"] }, null)).toContain("wrong boundary");
  });
});
