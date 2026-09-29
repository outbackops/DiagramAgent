import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SpecError } from "@/lib/compose/spec";
import { isArchSpecShape, normalizeArchSpec, normalizeArchSpecText } from "./normalize";
import { allItems, isBoundary, type NBoundary, type NComponent } from "./spec";

const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
const fixture = (name: string) => readFileSync(path.join(fixtureDir, `${name}.json`), "utf8");
const byId = (items: ReturnType<typeof allItems>, id: string) => items.find((i) => i.id === id);

describe("normalizeArchSpec", () => {
  it("normalises every fixture without repairs, deterministically", () => {
    for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".json"))) {
      const text = readFileSync(path.join(fixtureDir, file), "utf8");
      const first = normalizeArchSpecText(text);
      expect(first.warnings, file).toEqual([]);
      expect(normalizeArchSpecText(text)).toEqual(first);
    }
  });

  it("keeps nesting, facts, details, icons, sequences and assumptions of a nested Azure spec", () => {
    const { spec } = normalizeArchSpecText(fixture("azure-zone-redundant-web"));
    const items = allItems(spec.items);
    const vnet = byId(items, "vnet") as NBoundary;
    expect(vnet).toMatchObject({ type: "boundary", kind: "vnet", name: "Spoke virtual network", facts: "10.20.0.0/16" });
    expect(vnet.items.map((i) => i.id)).toEqual(["gw-subnet", "int-subnet", "pe-subnet"]);
    expect(byId(items, "agw")).toMatchObject({ type: "component", icon: "azure-application-gateway", detail: "WAF_v2 · zone redundant" });
    expect(spec.sequences.map((s) => [s.id, s.badge, s.steps.length])).toEqual([["in", "circle", 3], ["out", "square", 2]]);
    expect(spec.connections[0]).toEqual({ from: "users", to: "agw", meaning: "request", label: "HTTPS 443", step: { sequence: "in", number: 1 } });
    expect(spec.assumptions).toHaveLength(2);
    expect(spec.platform).toBe("azure");
  });

  it("builds the same tree from the flat parent form as from nesting", () => {
    const nested = normalizeArchSpec({
      title: "Nested",
      items: [{ type: "group", id: "vnet", kind: "vnet", name: "VNet", items: [{ type: "group", id: "web", kind: "subnet", name: "Web", items: [{ id: "vm", name: "VM", icon: "azure-virtual-machine" }] }] }],
    });
    const flat = normalizeArchSpec({
      title: "Nested",
      items: [
        { id: "vm", name: "VM", icon: "azure-virtual-machine", parent: "web" },
        { type: "group", id: "vnet", kind: "vnet", name: "VNet", items: [{ type: "group", id: "web", kind: "subnet", name: "Web", items: [{ id: "placeholder", name: "Placeholder" }] }] },
      ],
    });
    const web = byId(allItems(flat.spec.items), "web") as NBoundary;
    expect(web.items.map((i) => i.id)).toEqual(["placeholder", "vm"]);
    expect(flat.spec.items.map((i) => i.id)).toEqual(["vnet"]);
    expect((byId(allItems(nested.spec.items), "web") as NBoundary).items.map((i) => i.id)).toEqual(["vm"]);
    expect(flat.warnings).toEqual([]);
  });

  it("keeps nesting when a parent alias disagrees with it, with a warning", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Conflict",
      items: [
        { type: "group", id: "a", name: "A", items: [{ id: "x", name: "X", parent: "b" }] },
        { type: "group", id: "b", name: "B", items: [{ id: "y", name: "Y" }] },
      ],
    });
    expect((byId(allItems(spec.items), "a") as NBoundary).items.map((i) => i.id)).toEqual(["x"]);
    expect(warnings).toContain("x is nested in a but names b as its parent; kept the nesting");
  });

  it("normalises kind, meaning, platform, view and icon aliases", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Aliases",
      platform: "Amazon Web Services",
      view: "infrastructure",
      items: [
        { type: "group", id: "vpc", kind: "AWS VPC", name: "VPC", items: [{ type: "group", id: "az", kind: "availability zone", name: "AZ", items: [{ id: "fn", name: "Worker", icon: "lambda" }] }] },
        { id: "db", name: "Table", icon: "DynamoDB" },
        { type: "group", id: "odd", kind: "blob of things", name: "Odd", items: [{ id: "gw", name: "Gateway", icon: "Application Gateway" }] },
      ],
      connections: [
        { from: "fn", to: "db", meaning: "sync" },
        { from: "db", to: "fn", meaning: "Event" },
        { from: "gw", to: "fn", meaning: "telepathy" },
      ],
    });
    const items = allItems(spec.items);
    expect(spec.platform).toBe("aws");
    expect(spec.view).toBe("deployment");
    expect((byId(items, "vpc") as NBoundary).kind).toBe("vpc");
    expect((byId(items, "az") as NBoundary).kind).toBe("zone");
    expect((byId(items, "odd") as NBoundary).kind).toBe("group");
    expect((byId(items, "fn") as NComponent).icon).toBe("aws-lambda");
    expect((byId(items, "db") as NComponent).icon).toBe("aws-dynamodb");
    expect((byId(items, "gw") as NComponent).icon).toBe("azure-application-gateway");
    expect(spec.connections.map((c) => c.meaning)).toEqual(["request", "async", "request"]);
    expect(warnings).toContain('Unknown boundary kind "blob of things"; drew it as a generic group');
    expect(warnings).toContain('Unknown connection meaning "telepathy"; drew it as a request');
  });

  it("gives duplicate names unique ids and warns about ambiguous name references", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Dupes",
      items: [
        { type: "group", id: "a", name: "Zone A", items: [{ name: "Web server" }] },
        { type: "group", id: "b", name: "Zone B", items: [{ name: "Web server" }] },
        { id: "lb", name: "Load balancer" },
      ],
      connections: [{ from: "lb", to: "Web server" }],
    });
    const ids = allItems(spec.items).map((i) => i.id);
    expect(ids).toEqual(["a", "web-server", "b", "web-server-2", "lb"]);
    expect(spec.connections).toEqual([{ from: "lb", to: "web-server", meaning: "request" }]);
    expect(warnings).toContain('Ambiguous reference "Web server" matches 2 items; used web-server (use an id)');
  });

  it("resolves step references in every form and caps sequences at two", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Steps",
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
      sequences: [
        { id: "in", name: "Inbound", steps: ["one", "two"] },
        { id: "out", name: "Outbound", steps: ["one"] },
        { id: "extra", name: "Extra", steps: ["one"] },
      ],
      connections: [
        { from: "a", to: "b", step: "in.2" },
        { from: "b", to: "c", step: 1 },
        { from: "c", to: "d", step: { sequence: "out", number: 1 } },
      ],
    });
    expect(spec.sequences.map((s) => s.id)).toEqual(["in", "out"]);
    expect(spec.connections.map((c) => c.step)).toEqual([{ sequence: "in", number: 2 }, { sequence: "in", number: 1 }, { sequence: "out", number: 1 }]);
    expect(warnings).toContain("Dropped step sequences beyond 2");
  });

  it("creates a workflow for step numbers with no sequence and warns about missing descriptions", () => {
    const { spec, warnings } = normalizeArchSpec({ title: "Numbers", items: [{ id: "a", name: "A" }, { id: "b", name: "B" }], connections: [{ from: "a", to: "b", step: 1 }] });
    expect(spec.sequences).toEqual([{ id: "main", name: "Workflow", badge: "circle", steps: [] }]);
    expect(warnings).toContain("Step main.1 has no description in the workflow");
  });

  it("drops unresolved, self-loop and malformed connections, and merges duplicates", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Links",
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      connections: [
        { from: "a", to: "b" },
        { from: "a", to: "b", label: "HTTPS" },
        { from: "a", to: "ghost" },
        { from: "a", to: "a" },
      ],
    });
    expect(spec.connections).toEqual([{ from: "a", to: "b", meaning: "request", label: "HTTPS" }]);
    expect(warnings).toEqual(expect.arrayContaining(["Merged duplicate connection a → b", "Dropped connection with unresolved endpoint ghost", "Dropped self-loop connection on a"]));
  });

  it("resolves overlays and drops members it can't find", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "Overlay",
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      overlays: [{ name: "Auto Scaling group", members: ["a", "b", "nope"] }, { name: "Lonely", members: ["a"] }],
    });
    expect(spec.overlays).toEqual([{ id: "auto-scaling-group", kind: "scaling-group", name: "Auto Scaling group", members: ["a", "b"] }]);
    expect(warnings).toEqual(expect.arrayContaining(["Dropped unknown overlay member nope from Auto Scaling group", "Dropped overlay Lonely: it needs at least two members"]));
  });

  it("converts an empty boundary to a component rather than dropping it", () => {
    const { spec, warnings } = normalizeArchSpec({ title: "Empty", items: [{ type: "group", kind: "external", id: "internet", name: "Internet", facts: "Public", items: [] }, { id: "x", name: "X" }] });
    expect(spec.items[0]).toEqual({ type: "component", id: "internet", name: "Internet", detail: "Public" });
    expect(warnings).toContain("Converted empty boundary Internet to a component");
  });

  it("warns about unknown fields with a suggestion", () => {
    const { warnings } = normalizeArchSpec({ title: "Typos", items: [{ id: "a", name: "A", detial: "x" }], conections: [] });
    expect(warnings).toContain('Ignored unknown spec field "conections" (did you mean "connections"?)');
    expect(warnings).toContain('Ignored unknown component field "detial" (did you mean "detail"?)');
  });

  it("keeps everything past the envelope with a warning, and rejects input past the hard cap", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
    const { spec, warnings } = normalizeArchSpec({ title: "Big", items: many(70) });
    expect(allItems(spec.items)).toHaveLength(70);
    expect(warnings).toContain("70 components exceed the 60-component envelope; the layout may be less tidy");
    expect(() => normalizeArchSpec({ title: "Huge", items: many(241) })).toThrow(SpecError);
  });

  it("rejects input it can't repair", () => {
    expect(() => normalizeArchSpec({ title: "Nothing", items: [] })).toThrow(/no components/);
    expect(() => normalizeArchSpec({ title: "Only boxes", items: [{ type: "group", name: "Box", items: [{ type: "group", name: "Inner", items: [] }] }] })).not.toThrow();
    expect(() => normalizeArchSpec({ title: "Clash", items: [{ id: "Web App", name: "One" }, { id: "web-app", name: "Two" }] })).toThrow(/share the id "web-app"/);
    expect(() =>
      normalizeArchSpec({
        title: "Cycle",
        items: [
          { type: "group", id: "a", name: "A", parent: "b", items: [{ id: "x", name: "X" }] },
          { type: "group", id: "b", name: "B", parent: "a", items: [{ id: "y", name: "Y" }] },
        ],
      }),
    ).toThrow(/contain each other/);
    expect(() => normalizeArchSpec([1, 2])).toThrow(SpecError);
  });

  it("tells Architecture specs from Poster specs", () => {
    expect(isArchSpecShape(JSON.parse(fixture("azure-hub-spoke")))).toBe(true);
    expect(isArchSpecShape({ title: "Poster", columns: [{ title: "A", items: [] }] })).toBe(false);
    expect(isArchSpecShape({ title: "Poster", items: [{ type: "grid", items: [] }], connectors: [] })).toBe(false);
    expect(isArchSpecShape({ title: "Arch", items: [{ id: "a", name: "A" }], connections: [] })).toBe(true);
  });
});

describe("boundary helpers", () => {
  it("lists items depth first in author order", () => {
    const { spec } = normalizeArchSpecText(fixture("aws-multi-az-three-tier"));
    const ids = allItems(spec.items).map((i) => i.id);
    expect(ids.indexOf("az-a")).toBeLessThan(ids.indexOf("pub-a"));
    expect(ids.indexOf("pub-a")).toBeLessThan(ids.indexOf("az-b"));
    expect(allItems(spec.items).filter(isBoundary).map((b) => b.id)).toContain("vpc");
  });
});

describe("normalizer repairs for model output", () => {
  it("gives a service its own icon instead of the provider's logo, and says so", () => {
    const { spec, warnings } = normalizeArchSpec({
      title: "T",
      platform: "gcp",
      items: [
        { id: "bq", name: "BigQuery", icon: "gcp" },
        { id: "ps", name: "Cloud Pub/Sub", icon: "gcp" },
        { id: "df", name: "Dataflow streaming pipeline", icon: "gcp" },
        { id: "partner", name: "Partner system", icon: "gcp" },
      ],
    });
    const icons = Object.fromEntries(allItems(spec.items).map((item) => [item.id, (item as NComponent).icon]));
    expect(icons).toEqual({ bq: "gcp-bigquery", ps: "gcp-pubsub", df: "gcp-dataflow", partner: "gcp" });
    expect(warnings.filter((w) => w.includes('instead of the "gcp" logo'))).toHaveLength(3);
  });

  it("warns about workflow steps that no connection carries", () => {
    const { warnings } = normalizeArchSpec({
      title: "T",
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      connections: [{ from: "a", to: "b", step: "main.1" }],
      sequences: [{ id: "main", steps: ["one", "two", "three"] }],
    });
    expect(warnings).toContain("Steps main.2, main.3 aren't on any connection, so they have no badge on the diagram");
  });
});
