import { describe, expect, it } from "vitest";
import { discloseProposedFacts, PROPOSED_PREFIX } from "./disclose";
import { normalizeArchSpecText } from "./normalize";
import { faithfulness, GENERIC_TECH_TERMS } from "./quality";
import { ARCH_LIMITS } from "./spec";

const spec = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Web app",
    platform: "azure",
    items: [
      {
        type: "group",
        kind: "vnet",
        id: "vnet",
        name: "Spoke VNet",
        facts: "10.20.0.0/16",
        items: [{ type: "group", kind: "subnet", id: "app-subnet", name: "App subnet", facts: "10.20.1.0/24", items: [{ id: "app", name: "Web app", detail: "P1v3 · 3 instances" }] }],
      },
      { id: "sql", name: "Azure SQL", detail: "Business Critical" },
      { id: "fw", name: "Firewall" },
    ],
    connections: [
      { from: "app", to: "sql", label: "TDS 1433" },
      { from: "app", to: "fw", label: "0.0.0.0/0" },
    ],
    assumptions: ["Greenfield design"],
    ...extra,
  });
const assumptionsOf = (code: string) => normalizeArchSpecText(code).spec.assumptions;
const request = "A web app on App Service with Azure SQL in a spoke VNet, egress through a firewall";

describe("discloseProposedFacts", () => {
  it("lists what nothing the user said backs up, after the model's own assumptions", () => {
    const out = discloseProposedFacts(spec(), [request]);
    // The /24 sits inside the listed /16; TDS 1433 restates the protocol; 0.0.0.0/0 is a generic term.
    expect(assumptionsOf(out)).toEqual(["Greenfield design", `${PROPOSED_PREFIX}10.20.0.0/16, 3 instances, P1v3, Business Critical`]);
    const { spec: disclosed } = normalizeArchSpecText(out);
    expect(faithfulness(disclosed, request, { allowedFacts: [...GENERIC_TECH_TERMS] }).ungroundedFacts).toEqual([]);
  });

  it("leaves a spec alone when the request, an earlier request or the edited spec states its facts", () => {
    const code = spec();
    expect(discloseProposedFacts(code, [`${request}. Use P1v3 with 3 instances and a Business Critical database in 10.20.0.0/16.`])).toBe(code);
    // Hand edits live in the spec being edited.
    expect(discloseProposedFacts(code, ["add a cache", code])).toBe(code);
  });

  it("wraps many facts into lines within the assumption limit", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `svc-${i}`, name: `Service ${i}`, detail: `SKU${100 + i}X` }));
    const out = discloseProposedFacts(JSON.stringify({ title: "Many", items, connections: [] }), ["some services"]);
    const lines = assumptionsOf(out);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.startsWith(PROPOSED_PREFIX)).toBe(true);
      expect(line.length).toBeLessThanOrEqual(ARCH_LIMITS.assumptionChars);
    }
    expect(lines.join(" ")).toContain("SKU111X");
  });

  it("merges the assumed alias, and adds its lines on top of six assumptions of the model's own", () => {
    const merged = JSON.parse(discloseProposedFacts(spec({ assumptions: undefined, assumed: ["Illustrative ranges"] }), [request])) as Record<string, unknown>;
    expect(merged.assumed).toBeUndefined();
    expect(merged.assumptions).toEqual(["Illustrative ranges", `${PROPOSED_PREFIX}10.20.0.0/16, 3 instances, P1v3, Business Critical`]);
    const full = discloseProposedFacts(spec({ assumptions: ["a", "b", "c", "d", "e", "f"] }), [request]);
    expect(assumptionsOf(full)).toEqual(["a", "b", "c", "d", "e", "f", `${PROPOSED_PREFIX}10.20.0.0/16, 3 instances, P1v3, Business Critical`]);
    expect(normalizeArchSpecText(full).warnings).toEqual([]);
  });

  it("recomputes its lines on every candidate, never grounding a fact in the last run's", () => {
    const first = discloseProposedFacts(spec(), [request]);
    // Idempotent: the same spec and sources give the same text.
    expect(discloseProposedFacts(first, [request])).toBe(first);
    // A chat edit: the edited spec carries the last disclosure, which must not ground the facts it lists.
    expect(assumptionsOf(discloseProposedFacts(first, ["add a cache", first]))).toEqual(assumptionsOf(first));
    // A later request that states one of them does.
    expect(assumptionsOf(discloseProposedFacts(first, ["use P1v3 for the web tier", first]))).toEqual(["Greenfield design", `${PROPOSED_PREFIX}10.20.0.0/16, 3 instances, Business Critical`]);
    // The model drops P1v3 and the instance count: the line follows.
    const edited = first.replace("P1v3 · 3 instances", "Web tier");
    expect(assumptionsOf(discloseProposedFacts(edited, [request]))).toEqual(["Greenfield design", `${PROPOSED_PREFIX}10.20.0.0/16, Business Critical`]);
    // Every fact stated after all: the stale line goes.
    const stated = discloseProposedFacts(first, [`${request}, P1v3 with 3 instances, Business Critical, 10.20.0.0/16`]);
    expect(assumptionsOf(stated)).toEqual(["Greenfield design"]);
  });

  it("returns text it can't read unchanged", () => {
    expect(discloseProposedFacts("not json", [request])).toBe("not json");
    expect(discloseProposedFacts('{"title": "No items"}', [request])).toBe('{"title": "No items"}');
  });
});
