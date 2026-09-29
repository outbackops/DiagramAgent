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
          items: Array.from({ length: 11 }, (_, i) => ({ title: `Card ${i}`, lines: [long, long, long, long, long, long], color: i === 0 ? "amber" : "unknown" })),
        },
        {
          title: "Flows",
          items: [{ type: "flow", title: "Too long", steps: Array.from({ length: 7 }, (_, i) => ({ title: `Step ${i}`, lines: [long, long, long, long] })) }],
        },
      ],
    });
    expect(spec.columns[0].items).toHaveLength(10);
    expect(spec.columns[0].items[0]).toMatchObject({ tone: "orange" });
    const flow = spec.columns[1].items[0];
    if (flow.type !== "flow") throw new Error("expected a flow");
    expect(flow.steps).toHaveLength(6);
    expect(flow.steps.every((step) => step.lines.length === 3 && step.lines.every((line) => line.length <= 90))).toBe(true);
    expect(warnings).toContain("Dropped items beyond 10 in column Many");
    expect(warnings).toContain("Dropped steps beyond 6 in flow Too long");
    expect(warnings).toContain("Dropped step lines beyond 3");
    expect(warnings).toContain("Trimmed long card lines");
    expect(new Set(warnings).size).toBe(warnings.length);
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

describe("normalizeSpec: zones, letters and scoped references", () => {
  it("turns boundary-like items into zones and keeps untitled card groups as grids", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Zones",
      columns: [
        {
          title: "Network",
          items: [
            { type: "vnet", title: "Hub VNet", subtitle: "10.0.0.0/16", items: [{ title: "Firewall" }, { title: "Bastion" }] },
            { title: "Spoke", items: [{ title: "AKS" }] },
            { items: [{ title: "Cosmos DB" }, { title: "Key Vault" }] },
            { type: "subnet", title: "Empty subnet", text: "10.0.9.0/24" },
          ],
        },
      ],
    });
    const items = spec.columns[0].items;
    expect(items.map((i) => i.type)).toEqual(["zone", "zone", "grid", "banner"]);
    expect(items[0]).toMatchObject({ type: "zone", title: "Hub VNet", subtitle: "10.0.0.0/16", tone: "gray", columns: 2 });
    expect(items[3]).toMatchObject({ type: "banner", title: "Empty subnet", text: "10.0.9.0/24" });
    expect(warnings).toContain("Converted empty zone Empty subnet to a banner");
    expect(spec.columns[0].size).toBe("normal");
  });

  it("letters flows in reading order and remaps used-by chips", () => {
    const { spec } = normalizeSpec({
      title: "Letters",
      columns: [
        { title: "Flows", items: [{ type: "flow", label: "F", title: "First", steps: [{ title: "a" }] }, { type: "flow", label: "D", title: "Second", steps: [{ title: "b" }] }] },
        { title: "Services", items: [{ title: "Store", usedBy: ["D", "F"] }] },
      ],
    });
    const flows = spec.columns[0].items as Array<{ label: string; title: string }>;
    expect(flows.map((f) => `${f.label}:${f.title}`)).toEqual(["A:First", "B:Second"]);
    expect((spec.columns[1].items[0] as { usedBy: string[] }).usedBy).toEqual(["A", "B"]);
  });

  it("resolves flow.step references by the id the author wrote, even after deduplication", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Dedup",
      columns: [
        { id: "primary", title: "Primary", items: [{ type: "flow", id: "pri", title: "Primary", steps: [{ id: "gateway", title: "Gateway" }] }] },
        { id: "dr", title: "DR", items: [{ type: "flow", id: "dr-request", title: "DR", steps: [{ id: "gateway", title: "Gateway" }, { id: "app", title: "App" }] }] },
      ],
      connectors: [{ from: "pri.gateway", to: "dr-request.gateway", kind: "call" }],
    });
    expect(warnings).toEqual([]);
    expect(spec.connectors).toEqual([{ from: "primary.pri.gateway", to: "dr.dr-request.gateway-2", kind: "call" }]);
  });
});

describe("normalizeSpec: authoring mistakes", () => {
  it("keeps the letters the author wrote for references, then letters in reading order", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Letters",
      columns: [
        { title: "Flows", items: [{ type: "flow", title: "First", steps: [{ title: "a" }] }, { type: "flow", label: "A", title: "Second", steps: [{ title: "b" }] }] },
        { title: "Services", items: [{ title: "Store", usedBy: ["A"] }] },
      ],
      connectors: [{ from: "A", to: "Store", label: "writes" }],
    });
    expect(warnings).toEqual([]);
    const flows = spec.columns[0].items as Array<{ label: string; title: string }>;
    expect(flows.map((f) => `${f.label}:${f.title}`)).toEqual(["A:First", "B:Second"]);
    // "A" named the flow the author lettered A: Second, now lettered B.
    expect((spec.columns[1].items[0] as { usedBy: string[] }).usedBy).toEqual(["B"]);
    expect(spec.connectors).toEqual([{ from: "flows.second", to: "services.store", kind: "flow", label: "writes" }]);
  });

  it("warns about unknown fields, with a suggestion for likely typos", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Typos",
      conectors: [{ from: "a", to: "b" }],
      columns: [{ title: "Only", items: [{ title: "Card", colr: "red" }] }],
    });
    expect(spec.connectors).toEqual([]);
    expect(warnings).toContain('Ignored unknown spec field "conectors" (did you mean "connectors"?)');
    expect(warnings.some((warning) => warning.startsWith('Ignored unknown card field "colr"'))).toBe(true);
  });

  it("drops connectors to a grid and warns about ambiguous titles", () => {
    const { spec, warnings } = normalizeSpec({
      title: "Refs",
      columns: [
        { title: "Apps", items: [{ title: "API" }, { title: "Cache" }] },
        { title: "Data", items: [{ title: "Cache" }, { type: "grid", id: "stores", items: [{ title: "SQL" }, { title: "Blob" }] }] },
      ],
      connectors: [
        { from: "API", to: "stores" },
        { from: "API", to: "Cache" },
      ],
    });
    expect(warnings).toContain("Dropped connector to grid stores; connect to one of its cards");
    expect(warnings).toContain('Ambiguous reference "Cache" matches 2 items; used apps.cache (use an id or flow.step)');
    expect(spec.connectors).toEqual([{ from: "apps.api", to: "apps.cache", kind: "flow" }]);
  });

  it("never changes the caller's spec, even when merging extra columns", () => {
    const input = {
      title: "Wide",
      columns: Array.from({ length: 6 }, (_, i) => ({ title: `Column ${i}`, items: [{ title: `Card ${i}` }] })),
    };
    const before = JSON.stringify(input);
    const { spec, warnings } = normalizeSpec(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(spec.columns).toHaveLength(4);
    expect(spec.columns[3].items).toHaveLength(3);
    expect(warnings).toContain("Merged extra columns beyond 4");
  });

  it("drops author numbering from column titles but keeps words that start like numerals", () => {
    const { spec } = normalizeSpec({
      title: "Numbers",
      columns: [
        { title: "1. Ingest", items: [{ title: "a" }] },
        { title: "II) Process", items: [{ title: "b" }] },
        { title: "X-Ray", items: [{ title: "c" }] },
        { title: "3 - Serve", items: [{ title: "d" }] },
      ],
    });
    expect(spec.columns.map((column) => column.title)).toEqual(["Ingest", "Process", "X-Ray", "Serve"]);
  });

  it("explains truncated output and arrays", () => {
    expect(() => parseSpecText('{"title": "Cut", "columns": [{"title": "A"')).toThrow(/looks cut off/);
    expect(() => parseSpecText("[1, 2]")).toThrow(/must be a JSON object, but got an array/);
    expect(parseSpecText('{"a": "x, }", "b": [1, 2, ], }')).toEqual({ a: "x, }", b: [1, 2] });
  });
});