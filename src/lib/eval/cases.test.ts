import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeArchSpecText } from "@/lib/arch/normalize";
import { faithfulness } from "@/lib/arch/quality";
import { faithfulnessExpect, type CaseExpect } from "./aggregate";

interface EvalCase {
  id: string;
  title: string;
  prompt: string;
  expect: CaseExpect;
}

const read = (file: string) => JSON.parse(readFileSync(path.join(process.cwd(), "evals", file), "utf8")) as EvalCase[];
const tuned = read("cases.json");
const heldOut = read("held-out.json");
const aliasGroup = (group: unknown) => Array.isArray(group) && group.length > 0 && group.every((alias) => typeof alias === "string" && alias.trim().length > 0);

describe("eval cases", () => {
  it.each([["cases.json", tuned], ["held-out.json", heldOut]] as const)("keeps %s well-formed", (_file, cases) => {
    for (const testCase of cases) {
      expect(testCase.prompt.length, testCase.id).toBeGreaterThan(40);
      expect(testCase.expect.keywords.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.expect.minNodes, testCase.id).toBeGreaterThan(0);
      for (const group of [...(testCase.expect.components ?? []), ...(testCase.expect.boundaries ?? []), ...(testCase.expect.overlays ?? [])]) expect(aliasGroup(group), testCase.id).toBe(true);
      for (const flow of testCase.expect.flows ?? []) expect(flow.length === 2 && aliasGroup(flow[0]) && aliasGroup(flow[1]), testCase.id).toBe(true);
    }
  });

  it("never reuses a case id, so the held-out set stays separate from tuning", () => {
    const ids = [...tuned, ...heldOut].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds the hand-built zone-redundant fixture structurally faithful to its case", () => {
    const testCase = tuned.find((c) => c.id === "azure-zone-redundant-web")!;
    const fixture = readFileSync(path.join(process.cwd(), "src", "test", "fixtures", "architecture", "azure-zone-redundant-web.json"), "utf8");
    const report = faithfulness(normalizeArchSpecText(fixture).spec, testCase.prompt, faithfulnessExpect(testCase.expect));
    expect({ components: report.missingComponents, boundaries: report.missingBoundaries, flows: report.missingFlows, prohibited: report.prohibitedFound }).toEqual({ components: [], boundaries: [], flows: [], prohibited: [] });
  });
});
