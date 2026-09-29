import { describe, expect, it } from "vitest";
import { expand, polylineHitsBox } from "./geometry";
import { routeEdge, routeModelEdges, type Side } from "./route";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, Point } from "./types";

const node = (id: string, box: Box, parent: string | null = null, container = false): DiagramNode => ({
  id,
  parent,
  label: id,
  shape: "rectangle",
  box,
  style: {},
  container,
});

const edge = (id: string, from: string, to: string, route: Point[] = []): DiagramEdge => ({
  id,
  from,
  to,
  srcArrow: "none",
  dstArrow: "triangle",
  style: {},
  route,
});

function expectAxisAligned(points: Point[]): void {
  for (let i = 1; i < points.length; i++) {
    expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true);
  }
}

function pointOnBorder(p: Point, b: Box): boolean {
  const onX = Math.abs(p.x - b.x) <= 0.5 || Math.abs(p.x - (b.x + b.w)) <= 0.5;
  const onY = Math.abs(p.y - b.y) <= 0.5 || Math.abs(p.y - (b.y + b.h)) <= 0.5;
  const inX = p.x >= b.x - 0.5 && p.x <= b.x + b.w + 0.5;
  const inY = p.y >= b.y - 0.5 && p.y <= b.y + b.h + 0.5;
  return (onX && inY) || (onY && inX);
}

function inside(p: Point, b: Box): boolean {
  return p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
}

function firstSide(points: Point[], box: Box): Side {
  const p = points[0];
  if (Math.abs(p.x - box.x) <= 0.5) return "left";
  if (Math.abs(p.x - (box.x + box.w)) <= 0.5) return "right";
  if (Math.abs(p.y - box.y) <= 0.5) return "top";
  return "bottom";
}

function lastSide(points: Point[], box: Box): Side {
  const p = points[points.length - 1];
  if (Math.abs(p.x - box.x) <= 0.5) return "left";
  if (Math.abs(p.x - (box.x + box.w)) <= 0.5) return "right";
  if (Math.abs(p.y - box.y) <= 0.5) return "top";
  return "bottom";
}

function segmentPerpendicular(points: Point[], side: Side, start: boolean): boolean {
  const a = start ? points[0] : points[points.length - 2];
  const b = start ? points[1] : points[points.length - 1];
  return side === "left" || side === "right" ? Math.abs(a.y - b.y) <= 0.5 : Math.abs(a.x - b.x) <= 0.5;
}

describe("routeEdge", () => {
  it("routes a straight horizontal line between aligned boxes", () => {
    const from = { x: 0, y: 0, w: 80, h: 40 };
    const to = { x: 180, y: 0, w: 80, h: 40 };
    const route = routeEdge(from, to, []);
    expect(route).toEqual([
      { x: 80, y: 20 },
      { x: 180, y: 20 },
    ]);
  });

  it("routes a straight vertical line between aligned boxes", () => {
    const from = { x: 0, y: 0, w: 80, h: 40 };
    const to = { x: 0, y: 140, w: 80, h: 40 };
    const route = routeEdge(from, to, []);
    expect(route).toEqual([
      { x: 40, y: 40 },
      { x: 40, y: 140 },
    ]);
  });

  it("routes offset boxes with only right-angle bends", () => {
    const route = routeEdge({ x: 0, y: 0, w: 60, h: 40 }, { x: 160, y: 110, w: 60, h: 40 }, []);
    expectAxisAligned(route);
    expect(route.length).toBeGreaterThanOrEqual(3);
    expect(route.length).toBeLessThanOrEqual(4);
  });

  it("routes around a blocker without crossing its expanded interior", () => {
    const blocker = { x: 100, y: -20, w: 50, h: 80 };
    const route = routeEdge({ x: 0, y: 0, w: 60, h: 40 }, { x: 220, y: 0, w: 60, h: 40 }, [blocker]);
    expectAxisAligned(route);
    expect(polylineHitsBox(route, expand(blocker, 12))).toBe(false);
  });

  it("places endpoints on borders and uses perpendicular first and last segments", () => {
    const from = { x: 0, y: 0, w: 80, h: 40 };
    const to = { x: 180, y: 60, w: 70, h: 50 };
    const route = routeEdge(from, to, [], { fromSide: "right", toSide: "left" });
    expect(pointOnBorder(route[0], from)).toBe(true);
    expect(pointOnBorder(route[route.length - 1], to)).toBe(true);
    expect(inside(route[0], from)).toBe(false);
    expect(inside(route[route.length - 1], to)).toBe(false);
    expect(segmentPerpendicular(route, firstSide(route, from), true)).toBe(true);
    expect(segmentPerpendicular(route, lastSide(route, to), false)).toBe(true);
  });

  it("falls back to an orthogonal route when fully enclosed", () => {
    const from = { x: 0, y: 0, w: 40, h: 40 };
    const to = { x: 240, y: 0, w: 40, h: 40 };
    const walls = [
      { x: -40, y: -40, w: 120, h: 20 },
      { x: -40, y: 60, w: 120, h: 20 },
      { x: -40, y: -40, w: 20, h: 120 },
      { x: 60, y: -40, w: 20, h: 120 },
    ];
    const route = routeEdge(from, to, walls, { fromSide: "right", toSide: "left" });
    expectAxisAligned(route);
    expect(pointOnBorder(route[0], from)).toBe(true);
    expect(pointOnBorder(route[route.length - 1], to)).toBe(true);
  });
});

describe("routeModelEdges", () => {
  it("only fills empty routes by default and leaves existing routes untouched", () => {
    const existing = [
      { x: 1, y: 2 },
      { x: 3, y: 2 },
    ];
    const model: DiagramModel = {
      version: 1,
      nodes: [node("a", { x: 0, y: 0, w: 50, h: 40 }), node("b", { x: 140, y: 0, w: 50, h: 40 }), node("c", { x: 280, y: 0, w: 50, h: 40 })],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c", existing)],
    };
    const routed = routeModelEdges(model);
    expect(routed).not.toBe(model);
    expect(routed.edges[0].route.length).toBeGreaterThan(0);
    expect(routed.edges[1].route).toBe(existing);
  });

  it("routes from outside to a nested leaf on the leaf border", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("group", { x: 100, y: 0, w: 180, h: 120 }, null, true), node("group.inner", { x: 150, y: 40, w: 50, h: 40 }, "group"), node("outside", { x: 0, y: 40, w: 50, h: 40 })],
      edges: [edge("e", "outside", "group.inner")],
    };
    const route = routeModelEdges(model).edges[0].route;
    expect(pointOnBorder(route[route.length - 1], model.nodes[1].box)).toBe(true);
  });

  it("routes an edge to a group on the group border", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("group", { x: 160, y: 0, w: 160, h: 120 }, null, true), node("group.inner", { x: 200, y: 40, w: 50, h: 40 }, "group"), node("outside", { x: 0, y: 40, w: 50, h: 40 })],
      edges: [edge("e", "outside", "group")],
    };
    const route = routeModelEdges(model).edges[0].route;
    expect(pointOnBorder(route[route.length - 1], model.nodes[0].box)).toBe(true);
  });

  it("spreads ports for three edges leaving the same side", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node("a", { x: 0, y: 0, w: 80, h: 90 }),
        node("b", { x: 200, y: -60, w: 60, h: 40 }),
        node("c", { x: 200, y: 20, w: 60, h: 40 }),
        node("d", { x: 200, y: 100, w: 60, h: 40 }),
      ],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "c"), edge("e3", "a", "d")],
    };
    const routed = routeModelEdges(model);
    const starts = routed.edges.map((e) => e.route[0].y);
    expect(new Set(starts).size).toBe(3);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("is deterministic", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("a", { x: 0, y: 0, w: 60, h: 40 }), node("b", { x: 220, y: 0, w: 60, h: 40 }), node("block", { x: 110, y: -30, w: 50, h: 100 })],
      edges: [edge("e", "a", "b")],
    };
    expect(routeModelEdges(model)).toEqual(routeModelEdges(model));
  });

  it("routes 60 edges among 80 leaf obstacles quickly", () => {
    const nodes: DiagramNode[] = [
      node("g1", { x: -40, y: -40, w: 900, h: 500 }, null, true),
      node("g2", { x: -40, y: 500, w: 900, h: 500 }, null, true),
    ];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 10; x++) {
        const id = `n${y}_${x}`;
        nodes.push(node(id, { x: x * 170, y: y * 178, w: 110, h: 118 }, y < 4 ? "g1" : "g2"));
      }
    }
    const edges: DiagramEdge[] = [];
    for (let i = 0; i < 60; i++) {
      const y = i % 6;
      const from = `n${y}_${i % 3}`;
      const to = `n${y + 2}_${7 + (i % 3)}`;
      edges.push(edge(`e${i}`, from, to));
    }
    const started = performance.now();
    const routed = routeModelEdges({ version: 1, nodes, edges });
    const elapsed = performance.now() - started;
    console.log(`routeModelEdges performance: ${elapsed.toFixed(1)} ms`);
    expect(routed.edges.every((e) => e.route.length >= 2)).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });
});
