import { describe, expect, it } from "vitest";
import { SpecError } from "./spec";
import { iconUrl, normalizeSpec, normalizeSpecText, parseSpecText } from "./normalize";

describe("parseSpecText", () => {
  it("extracts fenced JSON with prose, comments and trailing commas", () => {
    const raw = parseSpecText(`before\n\`\`\`json\n{\n // ok\n "title": "Demo",\n "columns": [{"title":"A","items":[{"title":"B",},],}],\n}\n\`\`\`\nafter`);
    expect(raw).toEqual({ title: "Demo", columns: [{ title: "A", items: [{ title: "B" }] }] });
  });

  it("throws SpecError for invalid JSON", () => {
    expect(() => parseSpecText("not json")).toThrow(SpecError);
    expect(() => parseSpecText("{ nope }")).toThrow(/The spec is not valid JSON:/);
  });
});

describe("normalizeSpec", () => {
  it("accepts aliases and fills defaults", () => {
    const { spec } = normalizeSpec({
      title: "Alias demo",
      sections: [
        {
          title: "Services",
          zones: [],
          items: [
            { type: "service", name: "API", description: "Handles requests", colour: "grey", icon: "Azure Key Vault" },
            { type: "strip", label: "Hosted in Azure", body: "Private network" },
            { type: "pipeline", title: "Sign in", trigger: "POST /login", steps: [{ name: "Validate" }] },
          ],
        },
      ],
      links: [{ source: "API", target: "Sign in", type: "calls" }],
      footer: "Users can authenticate",
    });

    expect(spec.columns[0].size).toBe("wide");
    expect(spec.columns[0].items[0]).toMatchObject({ type: "card", title: "API", lines: ["Handles requests"], tone: "gray", icon: "azure-key-vault" });
    expect(spec.columns[0].items[1]).toMatchObject({ type: "banner", title: "Hosted in Azure", text: "Private network" });
    expect(spec.columns[0].items[2]).toMatchObject({ type: "flow", label: "A", subtitle: "POST /login" });
    expect(spec.connectors).toEqual([{ from: "services.api", to: "services.sign-in", kind: "call" }]);
    expect(spec.footer).toEqual({ title: "Outcome", text: "Users can authenticate" });
    expect(iconUrl("azure-key-vault")).toBe("/icons/azure-key-vault.svg");
    expect(iconUrl("missing")).toBeUndefined();
  });

  it("derives globally unique ids and renames reserved column ids", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Ids",
      columns: [
        {
          id: "header",
          title: "Header",
          items: [
            { title: "API" },
            { title: "API" },
            { type: "flow", title: "API", steps: [{ title: "API" }, { title: "API" }] },
          ],
        },
      ],
    });
    const ids = [
      spec.columns[0].id,
      ...spec.columns[0].items.flatMap((item) => (item.type === "flow" ? [item.id, ...item.steps.map((step) => step.id)] : [item.id])),
    ];
    expect(spec.columns[0].id).not.toBe("header");
    expect(new Set(ids).size).toBe(ids.length);
    expect(warnings.some((warning) => warning.includes("reserved column id"))).toBe(true);
  });

  it("resolves connectors by model id, flow.step, flow letter, title and drops unresolved/self loops", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Refs",
      columns: [
        {
          id: "entry",
          title: "Entry",
          items: [
            { id: "caller", title: "Caller" },
            { id: "checkout", type: "flow", label: "C", title: "Checkout", steps: [{ id: "start", title: "Start" }, { id: "finish", title: "Finish" }] },
            { id: "worker", type: "flow", title: "Worker", steps: [{ id: "run", title: "Run" }] },
          ],
        },
      ],
      connectors: [
        { from: "entry.caller", to: "checkout.start" },
        { from: "C.finish", to: "Worker", type: "dependency" },
        { from: "Caller", to: "Run" },
        { from: "missing", to: "Caller" },
        { from: "Caller", to: "Caller" },
      ],
    });
    expect(spec.connectors).toEqual([
      { from: "entry.caller", to: "entry.checkout.start", kind: "flow" },
      { from: "entry.checkout.finish", to: "entry.worker", kind: "call" },
      { from: "entry.caller", to: "entry.worker.run", kind: "flow" },
    ]);
    expect(warnings.filter((warning) => warning.includes("Dropped")).length).toBeGreaterThanOrEqual(2);
  });

  it("resolves connectors by plain item, flow and step ids", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Plain ids",
      columns: [
        { id: "left", title: "Left", items: [{ id: "caller", title: "Caller" }] },
        { id: "mid", title: "Mid", items: [{ id: "checkout", type: "flow", title: "Checkout", steps: [{ id: "pay", title: "Pay" }, { id: "ship", title: "Ship" }] }] },
      ],
      connectors: [
        { from: "caller", to: "checkout" },
        { from: "pay", to: "caller", kind: "call" },
      ],
    });
    expect(spec.connectors).toEqual([
      { from: "left.caller", to: "mid.checkout", kind: "flow" },
      { from: "mid.checkout.pay", to: "left.caller", kind: "call" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("resolves usedBy by flow title in document order", () => {
    const { spec } = normalizeSpec({
      title: "Used by",
      columns: [
        {
          title: "Work",
          items: [
            { type: "flow", title: "Login", steps: ["Start"] },
            { type: "flow", title: "Refresh", steps: ["Renew"] },
            { title: "Identity", usedBy: ["Refresh", "Login", "Unknown"] },
          ],
        },
      ],
    });
    const card = spec.columns[0].items[2];
    expect(card).toMatchObject({ type: "card", usedBy: ["A", "B"] });
  });

  it("normalizes tone aliases, clamps limits and records warnings", () => {
    const long = "x".repeat(120);
    const { spec, warnings } = normalizeSpec({
      title: "Limits",
      columns: [
        {
          title: "Many",
          items: [
            ...Array.from({ length: 11 }, (_, i) => ({ title: `Card ${i}`, lines: [long, long, long, long, long, long], color: i === 0 ? "amber" : "unknown" })),
            { type: "flow", title: "Too late", steps: Array.from({ length: 7 }, (_, i) => ({ title: `Step ${i}`, lines: [long, long, long, long] })) },
          ],
        },
      ],
    });
    expect(spec.columns[0].items).toHaveLength(10);
    expect(spec.columns[0].items[0]).toMatchObject({ tone: "orange" });
    expect(warnings.some((warning) => warning.includes("Dropped items beyond"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Trimmed long card lines"))).toBe(true);
  });

  it("wraps top-level items, converts flows without steps and rejects empty specs", () => {
    const { spec, warnings } = normalizeSpec({ items: [{ type: "flow", title: "No steps" }] });
    expect(spec.title).toBe("Architecture overview");
    expect(spec.columns[0]).toMatchObject({ title: "Architecture" });
    expect(spec.columns[0].items[0]).toMatchObject({ type: "card", title: "No steps" });
    expect(warnings.some((warning) => warning.includes("Converted flow"))).toBe(true);
    expect(() => normalizeSpec({})).toThrow(SpecError);
  });

  it("is deterministic", () => {
    const input = { title: "Stable", items: [{ title: "A" }, { title: "A" }] };
    expect(normalizeSpec(input)).toEqual(normalizeSpec(input));
    expect(normalizeSpecText(JSON.stringify(input))).toEqual(normalizeSpec(input));
  });
});
