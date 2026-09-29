import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ElkLike } from "./elk";
import { composeArchitecture, composeArchitectureText } from "./index";
import type { Box, DiagramModel, DiagramNode } from "@/lib/model/types";

const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
const fixture = (name: string) => readFileSync(path.join(fixtureDir, `${name}.json`), "utf8");
const node = (model: DiagramModel, specId: string): DiagramNode => {
  const found = model.nodes.find((n) => n.arch?.id === specId);
  if (!found) throw new Error(`missing ${specId}`);
  return found;
};
const centreX = (b: Box) => b.x + b.w / 2;
const centreY = (b: Box) => b.y + b.h / 2;
const inside = (c: Box, p: Box) => c.x >= p.x - 1 && c.y >= p.y - 1 && c.x + c.w <= p.x + p.w + 1 && c.y + c.h <= p.y + p.h + 1;

describe("layoutArchitecture", () => {
  it("draws the zone-redundant web app like a reference architecture", async () => {
    const { model, report } = await composeArchitectureText(fixture("azure-zone-redundant-web"));
    expect(report.hardViolations).toBe(0);
    expect(model.kind).toBe("architecture");
    // Private endpoints share their subnet; each PaaS service lines up with its endpoint.
    const subnet = node(model, "pe-subnet").box;
    for (const pe of ["pe-app", "pe-sql", "pe-kv", "pe-st"]) expect(inside(node(model, pe).box, subnet)).toBe(true);
    const offsets = [["pe-sql", "sql"], ["pe-kv", "kv"], ["pe-st", "st"]].map(([pe, svc]) => Math.abs(centreY(node(model, pe).box) - centreY(node(model, svc).box)));
    // Lined up with its endpoint; a small jog only where stacked neighbours leave no room.
    expect(offsets.filter((o) => o <= 8).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(16);
    // Zones inside the App Service plan sit in author order, one row.
    const zones = ["zone-1", "zone-2", "zone-3"].map((z) => node(model, z).box);
    expect(zones[0].x).toBeLessThan(zones[1].x);
    expect(zones[1].x).toBeLessThan(zones[2].x);
    expect(new Set(zones.map((z) => Math.round(z.y))).size).toBe(1);
    // Both sequences get badges; identity and monitoring are in the band under the diagram.
    expect(model.edges.flatMap((e) => e.badges ?? []).map((b) => `${b.sequence}.${b.number}`).sort()).toEqual(["in.1", "in.2", "in.3", "out.1", "out.2"]);
    expect(node(model, "ops").box.y).toBeGreaterThan(node(model, "region").box.y + node(model, "region").box.h);
    expect(model.arch?.sequences.map((s) => s.id)).toEqual(["in", "out"]);
  });

  it("keeps Availability Zones as parallel lanes in author order with the Auto Scaling group overlay", async () => {
    const { model, report } = await composeArchitectureText(fixture("aws-multi-az-three-tier"));
    expect(report.hardViolations).toBe(0);
    const a = node(model, "az-a").box;
    const b = node(model, "az-b").box;
    // Lanes: side by side or stacked, never overlapping, A before B in reading order.
    expect(a.x + a.w <= b.x || a.y + a.h <= b.y).toBe(true);
    expect(model.arch?.overlays[0]).toMatchObject({ name: "Auto Scaling group", members: ["web-a", "web-b"] });
  });

  it("is deterministic", async () => {
    const text = fixture("azure-hub-spoke");
    const first = await composeArchitectureText(text);
    const second = await composeArchitectureText(text);
    expect(JSON.stringify(second.model)).toBe(JSON.stringify(first.model));
    expect(second.report.candidate).toBe(first.report.candidate);
  });

  it("packs a boundary with no connectors inside it as an ordered row", async () => {
    const { model } = await composeArchitecture({
      title: "Pool",
      items: [
        { id: "lb", name: "Load balancer", icon: "load-balancer" },
        { type: "group", id: "pool", name: "Workers", items: [{ id: "w1", name: "Worker 1" }, { id: "w2", name: "Worker 2" }, { id: "w3", name: "Worker 3" }] },
      ],
      connections: [{ from: "lb", to: "pool" }],
    });
    const xs = ["w1", "w2", "w3"].map((id) => node(model, id).box.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    expect(new Set(["w1", "w2", "w3"].map((id) => node(model, id).box.y)).size).toBe(1);
  });

  it("routes a cycle without looping around the page", async () => {
    const { report } = await composeArchitecture({
      title: "Cycle",
      items: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      connections: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a", label: "Callback" }],
    });
    expect(report.loops).toBe(0);
    expect(report.hardViolations).toBe(0);
  });

  it("keeps monitoring links into the shared band as hidden links", async () => {
    const { model } = await composeArchitectureText(fixture("azure-hub-spoke"));
    const hidden = model.edges.filter((e) => e.hidden);
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    expect(hidden.every((e) => e.route.length === 0 && e.meaning === "monitoring")).toBe(true);
  });

  it("falls back to another option set when ELK throws on one", async () => {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const real = new ELK();
    let calls = 0;
    const flaky: ElkLike = { layout: (graph, args) => (++calls === 1 ? Promise.reject(new Error("boom")) : real.layout(graph, args)) };
    const { report } = await composeArchitectureText(fixture("microservices-cycles"), { elk: flaky });
    expect(report.fallback).toBe(false);
    expect(report.hardViolations).toBe(0);
  });

  it("still lays everything out when ELK fails on every call", async () => {
    const broken: ElkLike = { layout: () => Promise.reject(new Error("ELK is down")) };
    const text = fixture("kubernetes-shop");
    const { model, report, spec } = await composeArchitectureText(text, { elk: broken });
    expect(report.fallback).toBe(true);
    expect(report.warnings).toContain("Every layout attempt failed; used a simple arrangement");
    expect(model.nodes.filter((n) => n.role === "service")).toHaveLength(13);
    expect(model.edges).toHaveLength(spec.connections.length);
  });

  it("keeps every component and connection past the envelope", async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ id: `c${i}`, name: `Component ${i}` }));
    const connections = items.slice(1).map((item, i) => ({ from: items[i].id, to: item.id }));
    const { model, warnings } = await composeArchitecture({ title: "Big", items, connections });
    expect(model.nodes.filter((n) => n.role === "service")).toHaveLength(70);
    expect(model.edges).toHaveLength(69);
    expect(warnings.some((w) => w.includes("envelope"))).toBe(true);
  }, 60_000);
});

describe("architecture fixtures", () => {
  const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));

  it.each(files)("%s lays out within the hard constraints, or reports why", async (file) => {
    const { model, report } = await composeArchitectureText(readFileSync(path.join(fixtureDir, file), "utf8"));
    if (report.hardViolations > 0) expect(report.warnings.some((w) => w.includes("overlap"))).toBe(true);
    expect(report.hardViolations).toBeLessThanOrEqual(1);
    expect(report.aspectRatio).toBeGreaterThanOrEqual(1);
    expect(report.aspectRatio).toBeLessThanOrEqual(2.3);
    expect(report.loops).toBe(0);
    // Every node sits inside its parent; page projections are generated.
    for (const n of model.nodes) {
      const parent = model.nodes.find((p) => p.id === n.parent);
      if (parent) expect(inside(n.box, parent.box), `${n.id} inside ${parent.id}`).toBe(true);
    }
    expect(model.nodes.filter((n) => n.generated).map((n) => n.role)).toContain("title");
  }, 60_000);
});
