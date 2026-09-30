import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeArchitectureText } from "./index";
import { extractFacts, faithfulness, scoreArchitecture } from "./quality";
import type { NormalizedArchSpec } from "./spec";
import type { DiagramEdge, DiagramModel, DiagramNode } from "@/lib/model/types";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "src", "test", "fixtures", "architecture", `${name}.json`), "utf8");

function service(id: string, label: string, x: number, y: number, w = 120, h = 96, parent: string | null = null): DiagramNode {
  return {
    id,
    parent,
    label,
    shape: "rectangle",
    box: { x, y, w, h },
    style: {},
    container: false,
    role: "service",
    icon: "/icons/generic.svg",
    arch: { id, iconKey: "generic" },
  };
}


function edge(id: string, from: string, to: string, route: Array<{ x: number; y: number }>, label?: string): DiagramEdge {
  return { id, from, to, label, srcArrow: "none", dstArrow: "arrow", style: {}, route, kind: "call", meaning: "request" };
}

function model(nodes: DiagramNode[], edges: DiagramEdge[] = []): DiagramModel {
  return { version: 1, kind: "architecture", nodes, edges, arch: { title: "Test", sequences: [], assumptions: [], overlays: [] } };
}

const baseSpec = (overrides: Partial<NormalizedArchSpec> = {}): NormalizedArchSpec => ({
  version: 1,
  title: "Identity app",
  platform: "azure",
  view: "deployment",
  items: [
    { type: "component", id: "idp", name: "Microsoft Entra ID", icon: "azure-active-directory" },
    { type: "boundary", id: "app", kind: "resource-group", name: "Application", items: [{ type: "component", id: "api", name: "API", detail: "Java 21" }] },
    { type: "boundary", id: "data", kind: "subnet", name: "Data subnet", facts: "10.0.0.0/24", items: [{ type: "component", id: "db", name: "Database", detail: "MySQL 8.0" }] },
  ],
  connections: [{ from: "api", to: "db", meaning: "request", label: "HTTPS 443" }],
  sequences: [],
  overlays: [{ id: "asg", kind: "scaling-group", name: "Scale set", members: ["api", "db"] }],
  assumptions: [],
  ...overrides,
});

describe("scoreArchitecture", () => {
  it("scores a clean fixture with no failed critical checks", async () => {
    const { model, warnings } = await composeArchitectureText(fixture("azure-hub-spoke"));
    const report = scoreArchitecture(model, { warnings });
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.checks.filter((check) => check.severity === "critical" && check.status === "fail")).toHaveLength(0);
  }, 60_000);

  it("names offenders for overlap, connector-through-component, text fit and label overlap", () => {
    const a = service("a", "Alpha", 0, 0);
    const b = service("b", "Beta", 30, 20);
    const c = service("c", "Gamma", 180, 40);
    const tiny = service("tiny", "Name that cannot fit", 360, 0, 40, 60);
    const e = edge("a_to_b", "a", "b", [
      { x: 60, y: 48 },
      { x: 240, y: 48 },
      { x: 360, y: 48 },
    ], "bad route");
    e.labelAt = { x: c.box.x + 20, y: c.box.y + 20 };
    e.labelSize = { w: 70, h: 18 };
    const report = scoreArchitecture(model([a, b, c, tiny], [e]));

    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get("overlap")?.status).toBe("fail");
    expect(byId.get("overlap")?.detail).toContain("Alpha");
    expect(byId.get("overlap")?.detail).toContain("Beta");
    expect(byId.get("connector_through_component")?.status).toBe("fail");
    expect(byId.get("connector_through_component")?.detail).toContain("Gamma");
    expect(byId.get("text_fit")?.status).toBe("fail");
    expect(byId.get("text_fit")?.detail).toContain("Name that cannot fit");
    expect(byId.get("label_overlap")?.status).toBe("fail");
    expect(byId.get("label_overlap")?.detail).toContain("Gamma");
  });

  it("warns, not fails critically, when aspect ratio is outside the target", () => {
    const report = scoreArchitecture(model([service("wide", "Wide", 0, 0, 668, 168)]));
    const aspect = report.checks.find((check) => check.id === "aspect_ratio");
    expect(report.metrics.aspectRatio).toBeCloseTo(3.5, 1);
    expect(aspect?.status).toBe("warn");
    expect(aspect?.severity).not.toBe("critical");
  });

  it("scores 60 services and 80 edges within a loose performance budget", () => {
    const nodes: DiagramNode[] = [];
    for (let i = 0; i < 60; i++) nodes.push(service(`n${i}`, `Node ${i}`, (i % 10) * 180, Math.floor(i / 10) * 140));
    const edges: DiagramEdge[] = [];
    for (let i = 0; i < 59; i++) edges.push(edge(`e${i}`, `n${i}`, `n${i + 1}`, [{ x: nodes[i].box.x + 60, y: nodes[i].box.y + 48 }, { x: nodes[i + 1].box.x + 60, y: nodes[i + 1].box.y + 48 }], "HTTPS"));
    for (let i = 0; edges.length < 80; i++) edges.push(edge(`v${i}`, `n${i}`, `n${i + 10}`, [{ x: nodes[i].box.x + 60, y: nodes[i].box.y + 48 }, { x: nodes[i + 10].box.x + 60, y: nodes[i + 10].box.y + 48 }], "HTTPS"));
    const start = performance.now();
    const report = scoreArchitecture(model(nodes, edges));
    const elapsed = performance.now() - start;
    expect(report.metrics.nodes).toBe(60);
    expect(report.metrics.connections).toBe(80);
    expect(elapsed).toBeLessThan(150);
  });
});

describe("faithfulness", () => {
  it("reports missing required boundary groups", () => {
    const report = faithfulness(baseSpec({ assumptions: ["Java 21, MySQL 8.0 and 10.0.0.0/24 are supplied by the platform baseline."] }), "Use Entra ID with API, database and HTTPS.", { boundaries: [["private subnet", "priv subnet"]] });
    expect(report.pass).toBe(false);
    expect(report.missingBoundaries).toEqual(["private subnet"]);
  });

  it("reports missing flows", () => {
    const report = faithfulness(baseSpec({ assumptions: ["Java 21, MySQL 8.0 and 10.0.0.0/24 are supplied by the platform baseline."] }), "Use Entra ID with API, database and HTTPS.", { flows: [[["database"], ["api"]]] });
    expect(report.pass).toBe(false);
    expect(report.missingFlows).toEqual(["database → api"]);
  });

  it("finds prohibited strings in the spec", () => {
    const report = faithfulness(baseSpec({ assumptions: ["Java 21, MySQL 8.0 and 10.0.0.0/24 are supplied by the platform baseline."] }), "Use Entra ID with API, database and HTTPS.", { prohibited: ["mysql"] });
    expect(report.pass).toBe(false);
    expect(report.prohibitedFound).toEqual(["mysql"]);
  });

  it("flags invented concrete facts", () => {
    const spec = baseSpec({
      items: [{ type: "component", id: "web", name: "Web app", detail: "P1v3" }, { type: "boundary", id: "vnet", kind: "vnet", name: "Virtual network", facts: "10.9.0.0/16", items: [] }],
      connections: [],
      overlays: [],
    });

    const report = faithfulness(spec, "Draw a web app in a virtual network.", {});
    expect(report.pass).toBe(false);
    expect(report.ungroundedFacts).toEqual(expect.arrayContaining(["P1v3", "10.9.0.0/16"]));
    expect(extractFacts(spec).map((fact) => fact.text)).toEqual(expect.arrayContaining(["P1v3", "10.9.0.0/16"]));
  });

  it("does not ground non-default protocol ports by substring", () => {
    const spec8443 = baseSpec({ connections: [{ from: "api", to: "db", meaning: "request", label: "HTTPS 8443" }] });
    const report8443 = faithfulness(spec8443, "Use HTTPS between API and database.", {});
    expect(report8443.ungroundedFacts).toContain("HTTPS 8443");

    const spec443 = baseSpec({ connections: [{ from: "api", to: "db", meaning: "request", label: "HTTPS 443" }] });
    const report443 = faithfulness(spec443, "Use HTTPS between API and database.", {});
    expect(report443.ungroundedFacts).not.toContain("HTTPS 443");

    // A bare port is grounded only when it is the default port of a protocol the request names.
    const bare = (port: string) => baseSpec({ connections: [{ from: "api", to: "db", meaning: "request", label: `port ${port}` }] });
    expect(faithfulness(bare("443"), "Use HTTPS between API and database.", {}).ungroundedFacts).not.toContain("port 443");
    expect(faithfulness(bare("8443"), "Use HTTPS between API and database.", {}).ungroundedFacts).toContain("port 8443");
    // So is a transport and that port: SQL Server's TCP 1433, not TCP 8443.
    const tcp = (port: string) => baseSpec({ connections: [{ from: "api", to: "db", meaning: "request", label: `TCP ${port}` }] });
    expect(faithfulness(tcp("1433"), "The API queries SQL Server.", {}).ungroundedFacts).not.toContain("TCP 1433");
    expect(faithfulness(tcp("8443"), "Use HTTPS between API and database.", {}).ungroundedFacts).toContain("TCP 8443");
  });

  it("extracts counts without matching words ending in x", () => {
    const facts = extractFacts(baseSpec({ items: [{ type: "component", id: "web", name: "Web", detail: "nginx 1.25\nAutoscale max 5\nVM × 3" }], connections: [], overlays: [] })).map((fact) => fact.text);
    expect(facts).not.toContain("x 1");
    expect(facts).not.toContain("x 5");
    expect(facts).toContain("× 3");
  });

  it("extracts .NET versions at the start of text or after a space", () => {
    const facts = extractFacts(baseSpec({ items: [{ type: "component", id: "api", name: "API", detail: ".NET 8\nRuns .NET 8.0" }], connections: [], overlays: [] })).map((fact) => fact.text);
    expect(facts).toEqual(expect.arrayContaining([".NET 8", ".NET 8.0"]));
  });

  it("accepts aliases such as Azure AD for Microsoft Entra ID", () => {
    const report = faithfulness(baseSpec({ items: [{ type: "component", id: "idp", name: "Microsoft Entra ID" }], connections: [], overlays: [] }), "Use Microsoft Entra ID.", { components: [["azure ad", "entra id"]] });
    expect(report.missingComponents).toEqual([]);
  });

  it("matches an alias at the start of a word (plurals, longer names), and a component drawn as a boundary", () => {
    const spec = baseSpec({
      items: [
        { type: "component", id: "producers", name: "Event producers" },
        { type: "component", id: "db", name: "PostgreSQL" },
        { type: "boundary", id: "aks", kind: "cluster", name: "AKS cluster", items: [{ type: "component", id: "api", name: "API" }] },
      ],
      connections: [{ from: "producers", to: "db", meaning: "request" }],
      overlays: [],
    });
    const report = faithfulness(spec, "Producers write to PostgreSQL on AKS.", { components: [["producer"], ["postgres"], ["aks"]], flows: [[["producer"], ["postgres"]]] });
    expect(report).toMatchObject({ missingComponents: [], missingFlows: [] });
    // Not in the middle of a word.
    expect(faithfulness(spec, "p", { components: [["gres"]] }).missingComponents).toEqual(["gres"]);
  });

  it("grounds facts from assumptions", () => {
    const spec = baseSpec({ items: [{ type: "component", id: "web", name: "Web app", detail: "P1v3" }], connections: [], overlays: [], assumptions: ["P1v3 is the chosen app service tier."] });
    expect(faithfulness(spec, "Draw a web app.", {}).ungroundedFacts).toEqual([]);
    // Also at the end of a sentence or before a colon.
    const endOfSentence = { ...spec, assumptions: ["App Service plan P1v3."] };
    expect(faithfulness(endOfSentence, "Draw a web app.", {}).ungroundedFacts).toEqual([]);
    expect(faithfulness({ ...spec, assumptions: ["Tier P1v3: chosen for zone redundancy"] }, "Draw a web app.", {}).ungroundedFacts).toEqual([]);
  });

  it("grounds allowed facts", () => {
    const spec = baseSpec({ items: [{ type: "component", id: "web", name: "Web app", detail: "P1v3" }], connections: [], overlays: [] });
    expect(faithfulness(spec, "Draw a web app.", { allowedFacts: ["P1v3"] }).ungroundedFacts).toEqual([]);
  });

  it("grounds HTTPS 443 when HTTPS is in the prompt", () => {
    const spec = baseSpec({ items: [{ type: "component", id: "a", name: "A" }, { type: "component", id: "b", name: "B" }], connections: [{ from: "a", to: "b", meaning: "request", label: "HTTPS 443" }], overlays: [] });
    expect(faithfulness(spec, "Connect A to B over HTTPS.", {}).ungroundedFacts).toEqual([]);
  });

  it("grounds subnets inside a declared address range, ports stated in an assumption, and a protocol's own default port", () => {
    const subnet = (facts: string): NormalizedArchSpec["items"] => [
      { type: "boundary", id: "vnet", kind: "vnet", name: "VNet", facts: "10.30.0.0/16", items: [{ type: "boundary", id: "web", kind: "subnet", name: "Web", facts, items: [{ type: "component", id: "app", name: "App" }] }] },
      { type: "component", id: "db", name: "Database" },
    ];
    const spec = baseSpec({
      items: subnet("10.30.1.0/24"),
      connections: [{ from: "app", to: "db", meaning: "request", label: "SQL 3306" }, { from: "db", to: "app", meaning: "request", label: "HTTPS 443" }],
      overlays: [],
      assumptions: ["VNet address space 10.30.0.0/16 with /24 subnets", "MySQL on port 3306"],
    });
    expect(faithfulness(spec, "Draw an app and its database.", {}).ungroundedFacts).toEqual([]);
    // A subnet outside every declared range is still an invented fact.
    expect(faithfulness({ ...spec, items: subnet("10.40.1.0/24") }, "Draw an app and its database.", {}).ungroundedFacts).toEqual(["10.40.1.0/24"]);
    // A default route names every address, not an address space: it grounds no range.
    const route = { ...spec, assumptions: ["MySQL on port 3306"] };
    expect(faithfulness(route, "Draw an app and its database; egress 0.0.0.0/0 goes to the firewall.", { allowedFacts: ["0.0.0.0/0"] }).ungroundedFacts).toEqual(["10.30.0.0/16", "10.30.1.0/24"]);
  });

  it("counts a CIDR once, not its address again", () => {
    expect(extractFacts(baseSpec()).map((fact) => fact.text)).toContain("10.0.0.0/24");
    expect(extractFacts(baseSpec()).map((fact) => fact.text)).not.toContain("10.0.0.0");
  });

  it("matches required overlays", () => {
    const report = faithfulness(baseSpec({ assumptions: ["Java 21, MySQL 8.0 and 10.0.0.0/24 are supplied by the platform baseline."] }), "Use Entra ID with API, database and HTTPS.", { overlays: [["auto scaling group", "scale set"]] });
    expect(report.missingOverlays).toEqual([]);
  });
});
