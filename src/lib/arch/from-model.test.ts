import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeArchitecture, composeArchitectureText, modelToArchSpec, recomposeArchitecture } from "./index";
import { setArchDetail, setArchFacts, setArchIcon, setArchMeaning, setArchTitle } from "./edit";
import { scoreArchitecture } from "./quality";
import { validateModel } from "@/lib/model/validate";
import { diagramKind } from "@/lib/model/kind";
import { addNode, connect, deleteItems, moveItems, renameItem, reparent } from "@/lib/model/ops";
import { routeModelEdges } from "@/lib/model/route";
import type { DiagramModel } from "@/lib/model/types";

const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));
const fixture = (name: string) => readFileSync(path.join(fixtureDir, `${name}.json`), "utf8");
const byArch = (model: DiagramModel, id: string) => model.nodes.find((n) => n.arch?.id === id)!;

describe("modelToArchSpec", () => {
  it.each(files)("round-trips %s to the identical layout", async (file) => {
    const first = await composeArchitectureText(readFileSync(path.join(fixtureDir, file), "utf8"));
    const again = await recomposeArchitecture(first.model);
    expect(again.warnings).toEqual([]);
    expect(JSON.stringify(again.model)).toBe(JSON.stringify(first.model));
  }, 60_000);

  it("keeps meanings (omitting the default), labels, step references, sequences, overlays and assumptions", async () => {
    const { model } = await composeArchitectureText(fixture("aws-multi-az-three-tier"));
    const { spec, lost } = modelToArchSpec(model);
    expect(lost).toEqual([]);
    expect(spec.connections?.find((c) => c.from === "rds-primary")).toEqual({ from: "rds-primary", to: "rds-standby", meaning: "replication", label: "Synchronous" });
    expect(spec.connections?.find((c) => c.from === "alb" && c.to === "web-a")).toEqual({ from: "alb", to: "web-a", label: "HTTP 8080", step: "main.4" });
    expect(spec.overlays).toEqual([{ id: "auto-scaling-group", kind: "scaling-group", name: "Auto Scaling group", members: ["web-a", "web-b"] }]);
    expect(spec.assumptions).toEqual(["Instance sizes are recommendations"]);
    expect(JSON.stringify(spec)).not.toContain("__title");
  });

  it("follows hand edits: a component dragged out of its boundary and one dropped into another", async () => {
    const { model } = await composeArchitectureText(fixture("azure-hub-spoke"));
    const vm = byArch(model, "web-vmss");
    const outside = reparent(model, vm.id, null).model;
    expect(modelToArchSpec(outside).spec.items.map((i) => i.id)).toContain("web-vmss");
    const aksSpoke = byArch(outside, "spoke-aks");
    const moved = reparent(outside, byArch(outside, "web-vmss").id, aksSpoke.id).model;
    const spoke = modelToArchSpec(moved).spec.items.find((i) => i.id === "spoke-aks") as { items: Array<{ id: string }> };
    expect(spoke.items.map((i) => i.id).sort()).toEqual(["aks", "web-vmss"]);
    // Spec ids survive the path renames.
    expect(byArch(moved, "web-vmss").id).toBe(`${aksSpoke.id}.web-vmss`);
  });

  it("gives a canvas-added node a fresh spec id and keeps spec ids through colliding path renames", async () => {
    const { model } = await composeArchitectureText(fixture("azure-hub-spoke"));
    const fw = byArch(model, "fw");
    const aksSpoke = byArch(model, "spoke-aks");
    // Added on the canvas with the firewall's id as its key, in the spoke the firewall then moves into.
    const added = addNode(model, { parent: aksSpoke.id, label: "fw" });
    const moved = reparent(added.model, fw.id, aksSpoke.id);
    expect(moved.id).not.toBe(added.id);
    expect(byArch(moved.model, "fw").id).toBe(moved.id);
    const spoke = modelToArchSpec(moved.model).spec.items.find((i) => i.id === "spoke-aks") as { items: Array<{ id: string; name: string }> };
    expect(spoke.items.map((i) => [i.id, i.name])).toEqual(expect.arrayContaining([["fw", fw.label], ["fw-2", "fw"]]));
  });

  it("converts a Graph document explicitly and says what didn't carry over", () => {
    const graph: DiagramModel = {
      version: 1,
      nodes: [
        { id: "net", parent: null, label: "Network", shape: "rectangle", box: { x: 0, y: 0, w: 300, h: 200 }, style: { fill: "#eef" }, container: true },
        { id: "net.db", parent: "net", label: "Orders DB", shape: "cylinder", box: { x: 20, y: 60, w: 100, h: 60 }, style: {}, container: false, tooltip: "primary" },
        { id: "api", parent: null, label: "API", shape: "rectangle", icon: "/icons/azure-app-service.svg", box: { x: 400, y: 60, w: 100, h: 60 }, style: {}, container: false },
      ],
      edges: [{ id: "(api -> net.db)[0]", from: "api", to: "net.db", label: "SQL", srcArrow: "none", dstArrow: "triangle", style: { strokeDash: 4 }, route: [] }],
    };
    const { spec, lost } = modelToArchSpec(graph);
    expect(spec.items).toEqual([
      { type: "group", id: "net", kind: "group", name: "Network", items: [{ id: "db", name: "Orders DB" }] },
      { id: "api", name: "API", icon: "azure-app-service" },
    ]);
    expect(spec.connections).toEqual([{ from: "api", to: "db", label: "SQL" }]);
    expect(lost).toEqual(expect.arrayContaining([expect.stringContaining("cylinder"), expect.stringContaining("Colours"), expect.stringContaining("Tooltips"), expect.stringContaining("dash")]));
  });
});

describe("validation of Architecture models", () => {
  it.each(files)("keeps every field of %s", async (file) => {
    const { model } = await composeArchitectureText(readFileSync(path.join(fixtureDir, file), "utf8"));
    const result = validateModel(JSON.parse(JSON.stringify(model)));
    if (!result.ok) throw new Error(result.error);
    expect(result.model).toEqual(model);
  }, 60_000);

  it("treats kind as authoritative over the legacy composed flag", async () => {
    const { model } = await composeArchitecture({ title: "T", items: [{ id: "a", name: "A" }, { id: "b", name: "B" }], connections: [{ from: "a", to: "b" }] });
    const result = validateModel({ ...model, composed: true });
    expect(result.ok && result.model.kind).toBe("architecture");
    expect(result.ok && "composed" in result.model).toBe(false);
  });

  it("reads legacy poster documents as posters and leaves graph documents alone", () => {
    const node = { id: "a", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 10, h: 10 }, style: {}, container: false };
    const poster = validateModel({ version: 1, composed: true, nodes: [node], edges: [] });
    expect(poster.ok && diagramKind(poster.model)).toBe("poster");
    const graph = validateModel({ version: 1, nodes: [node], edges: [] });
    expect(graph.ok && diagramKind(graph.model)).toBe("graph");
    expect(graph.ok && graph.model).toEqual({ version: 1, nodes: [node], edges: [] });
  });

  it("rejects unknown meanings and malformed badges with the field named", async () => {
    const { model } = await composeArchitecture({ title: "T", items: [{ id: "a", name: "A" }, { id: "b", name: "B" }], connections: [{ from: "a", to: "b", step: 1 }] });
    const bad = JSON.parse(JSON.stringify(model));
    bad.edges[0].meaning = "telepathy";
    expect(validateModel(bad)).toMatchObject({ ok: false, error: expect.stringContaining("edges[0].meaning") });
    const badge = JSON.parse(JSON.stringify(model));
    badge.edges[0].badges = [{ sequence: "main", number: 0 }];
    expect(validateModel(badge)).toMatchObject({ ok: false, error: expect.stringContaining("badges[0].number") });
  });

  it("accepts hand-edited detail longer than the spec budget", async () => {
    const { model } = await composeArchitecture({ title: "T", items: [{ id: "a", name: "A" }] });
    const long = { ...model, nodes: model.nodes.map((n) => (n.arch?.id === "a" ? { ...n, arch: { ...n.arch, detail: "x".repeat(200) } } : n)) };
    expect(validateModel(long).ok).toBe(true);
  });
});

describe("editing Architecture models", () => {
  it("sets detail, facts, meaning, title and icon on canonical data", async () => {
    const { model } = await composeArchitectureText(fixture("azure-hub-spoke"));
    const fw = byArch(model, "fw");
    const hub = byArch(model, "hub");
    let next = setArchDetail(model, fw.id, "  Premium · forced tunnelling  ");
    next = setArchFacts(next, hub.id, "10.0.0.0/22");
    next = setArchMeaning(next, next.edges[0].id, "peering");
    next = setArchTitle(next, "Hub-and-spoke (production)");
    next = setArchIcon(next, fw.id, "firewall");
    expect(byArch(next, "fw").arch).toMatchObject({ detail: "Premium · forced tunnelling", iconKey: "firewall" });
    expect(byArch(next, "fw").icon).toBe("/icons/firewall.svg");
    expect(byArch(next, "hub").arch?.facts).toBe("10.0.0.0/22");
    expect(next.edges[0]).toMatchObject({ meaning: "peering", srcArrow: "triangle", dstArrow: "triangle" });
    expect(next.arch?.title).toBe("Hub-and-spoke (production)");
    expect(next.nodes.find((n) => n.role === "title")?.label).toBe("Hub-and-spoke (production)");
    const spec = modelToArchSpec(next).spec;
    expect(spec.title).toBe("Hub-and-spoke (production)");
    expect(setArchDetail(next, fw.id, "").nodes.find((n) => n.id === fw.id)?.arch?.detail).toBeUndefined();
  });

  it("grows a component whose detail or name got longer, so its text still fits", async () => {
    const { model } = await composeArchitectureText(fixture("azure-zone-redundant-web"));
    const kv = byArch(model, "kv");
    const edited = renameItem(setArchDetail(model, kv.id, "Premium · soft delete"), kv.id, "Key Vault for application secrets");
    const grown = byArch(edited, "kv");
    expect(grown.box.h).toBeGreaterThan(kv.box.h);
    expect(grown.box.w).toBeGreaterThanOrEqual(kv.box.w);
    expect(scoreArchitecture(edited).checks.find((c) => c.id === "text_fit")?.status).toBe("pass");
    const hub = byArch(model, "vnet");
    const facts = setArchFacts(model, hub.id, "10.20.0.0/16 · peered to the corporate hub");
    expect(scoreArchitecture(facts).checks.find((c) => c.id === "text_fit")?.status).toBe("pass");
  });

  it("protects generated page nodes from shape operations; renaming the title edits the model's title", async () => {
    const { model } = await composeArchitectureText(fixture("azure-zone-redundant-web"));
    const title = model.nodes.find((n) => n.role === "title")!;
    const workflow = model.nodes.find((n) => n.role === "workflow")!;
    expect(moveItems(model, [title.id], 50, 50).nodes.find((n) => n.id === title.id)?.box).toEqual(title.box);
    expect(deleteItems(model, [workflow.id]).nodes.some((n) => n.id === workflow.id)).toBe(true);
    expect(connect(model, title.id, byArch(model, "users").id).id).toBe("");
    expect(reparent(model, title.id, byArch(model, "region").id).model).toBe(model);
    const renamed = renameItem(model, title.id, "Web app — production");
    expect(renamed.arch?.title).toBe("Web app — production");
  });

  it("drops badge positions with a cleared route and never routes hidden links", async () => {
    const { model } = await composeArchitectureText(fixture("azure-zone-redundant-web"));
    const moved = moveItems(model, [byArch(model, "agw").id], 0, 40);
    const firstStep = moved.edges.find((e) => e.badges?.some((b) => b.sequence === "in" && b.number === 1))!;
    expect(firstStep.route).toEqual([]);
    expect(firstStep.badges?.[0].at).toBeUndefined();
    const routed = routeModelEdges(moved, { fallbackOnly: true });
    for (const edge of routed.edges.filter((e) => e.hidden)) expect(edge.route).toEqual([]);
  });
});
