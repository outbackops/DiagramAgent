import { describe, expect, it } from "vitest";
import { mergeStable, placeNear } from "./merge";
import { boxesOverlap } from "./geometry";
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
    expect(index.byId.get("newGroup")?.box.w).toBeGreaterThanOrEqual(124);
    expect(index.byId.get("newGroup")?.box.h).toBeGreaterThanOrEqual(124);
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
