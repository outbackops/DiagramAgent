import { describe, it, expect } from "vitest";
import { boxesOverlap, containsBox, longestSegmentMidpoint, segmentHitsBox, simplifyPolyline, unionBoxes } from "./geometry";
import { ancestors, descendants, edgeId, ensureParentsFirst, indexModel, isGroup, isWithin, joinPath, keyOf, renumberEdges, splitPath, uniqueKey } from "./query";
import type { DiagramEdge, DiagramModel, DiagramNode } from "./types";

const node = (id: string, parent: string | null, box = { x: 0, y: 0, w: 10, h: 10 }, container = false): DiagramNode => ({
  id,
  parent,
  label: keyOf(id),
  shape: "rectangle",
  box,
  style: {},
  container,
});

const edge = (from: string, to: string, id = edgeId(from, to, 0)): DiagramEdge => ({
  id,
  from,
  to,
  srcArrow: "none",
  dstArrow: "triangle",
  style: {},
  route: [],
});

describe("geometry", () => {
  const box = { x: 10, y: 10, w: 20, h: 20 };

  it("detects segments through a box but not along or outside it", () => {
    expect(segmentHitsBox({ x: 0, y: 20 }, { x: 40, y: 20 }, box)).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 10 }, { x: 40, y: 10 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 0, y: 0 }, { x: 5, y: 40 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 20, y: 0 }, { x: 20, y: 15 }, box)).toBe(true);
  });

  it("keeps only corners of a polyline", () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
    ]);
  });

  it("unions, contains and overlaps boxes", () => {
    expect(unionBoxes([box, { x: 0, y: 25, w: 5, h: 5 }])).toEqual({ x: 0, y: 10, w: 30, h: 20 });
    expect(unionBoxes([])).toBeNull();
    expect(containsBox(box, { x: 12, y: 12, w: 5, h: 5 })).toBe(true);
    expect(boxesOverlap(box, { x: 30, y: 10, w: 5, h: 5 })).toBe(false);
    expect(boxesOverlap(box, { x: 29, y: 10, w: 5, h: 5 })).toBe(true);
  });

  it("puts labels on the longest segment", () => {
    expect(
      longestSegmentMidpoint([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ]),
    ).toEqual({ x: 50, y: 10 });
  });
});

describe("query", () => {
  const model: DiagramModel = {
    version: 1,
    nodes: [node("cloud", null, undefined, true), node("cloud.vnet", "cloud", undefined, true), node("cloud.vnet.web", "cloud.vnet"), node("users", null), node("cloud.empty", "cloud", undefined, true)],
    edges: [edge("users", "cloud.vnet.web")],
  };
  const index = indexModel(model);

  it("walks the hierarchy", () => {
    expect(descendants(index, "cloud").map((n) => n.id)).toEqual(["cloud.vnet", "cloud.vnet.web", "cloud.empty"]);
    expect(ancestors(index, "cloud.vnet.web").map((n) => n.id)).toEqual(["cloud.vnet", "cloud"]);
    expect(isWithin(index, "cloud.vnet.web", "cloud")).toBe(true);
    expect(isWithin(index, "users", "cloud")).toBe(false);
  });

  it("treats empty containers as groups", () => {
    expect(isGroup(index, "cloud.empty")).toBe(true);
    expect(isGroup(index, "cloud.vnet")).toBe(true);
    expect(isGroup(index, "users")).toBe(false);
  });

  it("splits D2 paths, keeping quoted keys whole", () => {
    expect(splitPath('a."b.c".d')).toEqual(["a", '"b.c"', "d"]);
    expect(keyOf('a."b.c"')).toBe('"b.c"');
    expect(joinPath(null, "a")).toBe("a");
    expect(joinPath("a", "b")).toBe("a.b");
  });

  it("renumbers parallel edges D2-style", () => {
    const edges = renumberEdges([edge("a", "b", "x"), edge("a", "b", "y"), edge("b", "a", "z")]);
    expect(edges.map((e) => e.id)).toEqual(["(a -> b)[0]", "(a -> b)[1]", "(b -> a)[0]"]);
  });

  it("orders parents first, keeping valid input untouched", () => {
    const valid = [node("a", null), node("a.b", "a"), node("c", null)];
    expect(ensureParentsFirst(valid)).toBe(valid);
    const shuffled = [node("a.b.c", "a.b"), node("x", null), node("a.b", "a"), node("a", null)];
    expect(ensureParentsFirst(shuffled)?.map((n) => n.id)).toEqual(["x", "a", "a.b", "a.b.c"]);
    expect(ensureParentsFirst([node("a.b", "missing")])).toBeNull();
    expect(ensureParentsFirst([node("p", "q"), node("q", "p")])).toBeNull();
  });

  it("derives unique D2 keys from labels", () => {
    expect(uniqueKey("App Service", [])).toBe("App_Service");
    expect(uniqueKey("App Service", ["App_Service", "App_Service_2"])).toBe("App_Service_3");
    expect(uniqueKey("  ***  ", [])).toBe("node");
  });
});
