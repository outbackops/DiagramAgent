import { describe, expect, it } from "vitest";
import { carryContainers, mergeStable, placeNear } from "./merge";
import { boxesOverlap, containsBox } from "./geometry";
import { edgeId, indexModel } from "./query";
import type { DiagramEdge, DiagramModel, DiagramNode } from "./types";

function node(id: string, parent: string | null, x: number, y: number, w = 80, h = 50, container = false, label = id.split(".").at(-1) ?? id): DiagramNode {
  return {
    id,
    parent,
    label,
    shape: "rectangle",
    box: { x, y, w, h },
    style: { fontSize: container ? 20 : 16 },
    container,
  };
}

function edge(from: string, to: string, route = [{ x: 0, y: 0 }, { x: 100, y: 0 }], id = edgeId(from, to, 0)): DiagramEdge {
  return { id, from, to, srcArrow: "none", dstArrow: "triangle", style: { stroke: "#757575" }, route };
}

function prevModel(): DiagramModel {
  return {
    version: 1,
    handArranged: true,
    nodes: [node("g", null, 0, 0, 240, 180, true), node("g.a", "g", 30, 70), node("b", null, 350, 60), node("old", null, 520, 60)],
    edges: [edge("g.a", "b", [{ x: 110, y: 95 }, { x: 350, y: 85 }]), edge("old", "b", [{ x: 520, y: 85 }, { x: 430, y: 85 }])],
  };
}

describe("stable merge", () => {
  it("keeps unchanged node positions and sizes exactly while taking next content", () => {
    const prev = prevModel();
    const next: DiagramModel = {
      version: 1,
      nodes: [node("g", null, 1000, 1000, 500, 500, true, "Group"), node("g.a", "g", 1100, 1100, 120, 90, false, "Renamed A"), node("b", null, 1500, 1100, 100, 80, false, "B")],
      edges: [edge("g.a", "b", [], edgeId("g.a", "b", 0))],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    expect(index.byId.get("g.a")?.box).toEqual({ x: 30, y: 70, w: 80, h: 50 });
    expect(index.byId.get("g.a")?.label).toBe("Renamed A");
    expect(index.byId.get("g")?.label).toBe("Group");
    expect(result.model.handArranged).toBe(true);
    expect(result.removed).toEqual(["old"]);
    expect(result.model.edges).toHaveLength(1);
    expect(result.model.edges[0]?.route).toEqual([{ x: 110, y: 95 }, { x: 350, y: 85 }]);
  });

  it("places a new node beside its connected neighbour without overlap", () => {
    const prev = prevModel();
    const next: DiagramModel = {
      version: 1,
      nodes: [...prev.nodes.filter((item) => item.id !== "old"), node("cache", null, 0, 0)],
      edges: [edge("g.a", "b"), edge("b", "cache", [], edgeId("b", "cache", 0))],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    const cache = index.byId.get("cache");
    const b = index.byId.get("b");
    expect(result.added).toEqual(["cache"]);
    expect(cache?.box.x).toBe((b?.box.x ?? 0) + (b?.box.w ?? 0) + 40);
    expect(cache && b ? boxesOverlap(cache.box, b.box) : true).toBe(false);
  });

  it("places a new child in a full group without overlapping siblings and grows the group", () => {
    const prev: DiagramModel = {
      version: 1,
      nodes: [node("G", null, 0, 0, 380, 180, true), node("G.A", "G", 24, 48, 140, 60), node("G.B", "G", 214, 48, 140, 60)],
      edges: [],
    };
    const next: DiagramModel = {
      version: 1,
      nodes: [...prev.nodes, node("G.C", "G", 24, 48, 140, 60)],
      edges: [edge("G.A", "G.C", [], edgeId("G.A", "G.C", 0))],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    const c = index.byId.get("G.C");
    const siblings = result.model.nodes.filter((item) => item.parent === "G" && item.id !== "G.C");
    expect(c?.box).not.toEqual({ x: 24, y: 48, w: 140, h: 60 });
    expect(siblings.every((sibling) => c && !boxesOverlap(c.box, sibling.box))).toBe(true);
    expect(index.byId.get("G")?.box.h).toBeGreaterThan(180);
  });

  it("does not place a new child beside a connected node in another group", () => {
    const prev: DiagramModel = {
      version: 1,
      nodes: [
        node("web", null, 0, 0, 300, 200, true),
        node("web.ui", "web", 40, 70, 80, 50),
        node("data", null, 400, 0, 300, 200, true),
        node("data.db", "data", 520, 70, 80, 50),
      ],
      edges: [],
    };
    const next: DiagramModel = {
      version: 1,
      nodes: [...prev.nodes, node("web.cache", "web", 0, 0, 80, 50)],
      edges: [edge("web.cache", "data.db", [], edgeId("web.cache", "data.db", 0))],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    const cache = index.byId.get("web.cache");
    expect(cache?.box.x).toBeLessThan(400);
    expect(index.byId.get("data")?.box).toEqual({ x: 400, y: 0, w: 300, h: 200 });
  });

  it("keeps an existing node's exact box when a new sibling is added next to it", () => {
    const prev: DiagramModel = { version: 1, nodes: [node("g", null, 0, 0, 260, 180, true), node("g.a", "g", 40, 70)], edges: [] };
    const next: DiagramModel = { version: 1, nodes: [node("g", null, 0, 0, 260, 180, true), node("g.a", "g", 900, 900), node("g.b", "g", 0, 0)], edges: [edge("g.a", "g.b", [], edgeId("g.a", "g.b", 0))] };
    const result = mergeStable(prev, next);
    expect(indexModel(result.model).byId.get("g.a")?.box).toEqual({ x: 40, y: 70, w: 80, h: 50 });
  });

  it("places a regrouped AI-moved node inside its new parent without overlapping siblings", () => {
    const prev: DiagramModel = {
      version: 1,
      nodes: [node("g", null, 0, 0, 260, 180, true), node("g.a", "g", 40, 70, 80, 50, false, "a"), node("h", null, 320, 0, 260, 180, true), node("h.existing", "h", 350, 70)],
      edges: [],
    };
    const next: DiagramModel = {
      version: 1,
      nodes: [node("g", null, 0, 0, 260, 180, true), node("h", null, 320, 0, 260, 180, true), node("h.existing", "h", 350, 70), node("h.a", "h", 350, 70, 80, 50, false, "a")],
      edges: [],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    const regrouped = index.byId.get("h.a");
    const existing = index.byId.get("h.existing");
    const parent = index.byId.get("h");
    expect(result.regrouped).toEqual(["h.a"]);
    expect(regrouped && parent ? regrouped.box.x >= parent.box.x + 24 && regrouped.box.y >= parent.box.y + (20 * 1.3 + 24) : false).toBe(true);
    expect(regrouped && existing ? boxesOverlap(regrouped.box, existing.box) : true).toBe(false);
  });

  it("sizes new groups to fit placed children and reports regrouped nodes", () => {
    const prev = prevModel();
    const next: DiagramModel = {
      version: 1,
      nodes: [node("g", null, 0, 0, 240, 180, true), node("g.a", "g", 0, 0), node("newGroup", null, 600, 600, 100, 100, true), node("newGroup.b", "newGroup", 620, 660, 80, 50, false, "b")],
      edges: [edge("g.a", "newGroup.b", [], edgeId("g.a", "newGroup.b", 0))],
    };
    const result = mergeStable(prev, next);
    const index = indexModel(result.model);
    expect(result.regrouped).toEqual(["newGroup.b"]);
    expect(result.added).toContain("newGroup");
    const group = index.byId.get("newGroup");
    const child = index.byId.get("newGroup.b");
    expect(group && child ? containsBox(group.box, child.box) : false).toBe(true);
  });

  it("carries empty containers across imported next models", () => {
    const prev: DiagramModel = { version: 1, nodes: [node("empty", null, 0, 0, 200, 140, true)], edges: [] };
    const next: DiagramModel = { version: 1, nodes: [node("empty", null, 0, 0, 200, 140, false)], edges: [] };
    expect(carryContainers(prev, next).nodes[0].container).toBe(true);
    expect(mergeStable(prev, next).model.nodes[0].container).toBe(true);
  });

  it("keeps prior boxes stable across consecutive additions to a full group", () => {
    let model: DiagramModel = {
      version: 1,
      nodes: [node("G", null, 0, 0, 380, 180, true), node("G.A", "G", 24, 48, 140, 60), node("G.B", "G", 214, 48, 140, 60)],
      edges: [],
    };
    const additions = ["C", "D", "E"];
    for (const name of additions) {
      const before = new Map(model.nodes.map((item) => [item.id, item.box]));
      const next: DiagramModel = {
        version: 1,
        nodes: [...model.nodes, node(`G.${name}`, "G", 24, 48, 140, 60)],
        edges: [...model.edges, edge("G.A", `G.${name}`, [], edgeId("G.A", `G.${name}`, 0))],
      };
      model = mergeStable(model, next).model;
      for (const item of model.nodes) {
        if (!before.has(item.id) || item.id === "G") continue;
        expect(item.box, `${name} changed ${item.id}`).toEqual(before.get(item.id));
      }
      const leaves = model.nodes.filter((item) => item.parent === "G" && !item.container);
      for (let i = 0; i < leaves.length; i++) {
        for (let j = i + 1; j < leaves.length; j++) expect(boxesOverlap(leaves[i].box, leaves[j].box), `${leaves[i].id}/${leaves[j].id}`).toBe(false);
      }
    }
  });

  it("clears routes for new edges while keeping safe existing routes", () => {
    const prev = prevModel();
    const next: DiagramModel = {
      version: 1,
      nodes: [...prev.nodes.filter((item) => item.id !== "old"), node("blocker", null, 180, 70)],
      edges: [edge("g.a", "b", [], edgeId("g.a", "b", 0)), edge("g.a", "blocker", [], edgeId("g.a", "blocker", 0))],
    };
    const result = mergeStable(prev, next);
    expect(result.model.edges[0]?.route).toEqual([{ x: 110, y: 95 }, { x: 350, y: 85 }]);
    expect(result.model.edges[1]?.route).toEqual([]);
  });

  it("placeNear scans a free top-level slot when there are no anchors and is deterministic", () => {
    const model: DiagramModel = { version: 1, nodes: [node("a", null, 0, 0), node("b", null, 0, 0)], edges: [] };
    const once = placeNear(model, "b", []);
    const twice = placeNear(model, "b", []);
    expect(once).toEqual(twice);
    expect(indexModel(once).byId.get("b")?.box.x).toBe(120);
  });
});
