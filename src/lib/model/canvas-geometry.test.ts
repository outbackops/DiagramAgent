import { describe, expect, it } from "vitest";
import { clientToModel, dropTargetAt, fitViewBox, itemsInRect, nudgeDelta, resizeBox } from "./canvas-geometry";
import type { DiagramModel, DiagramNode } from "./types";

const node = (id: string, parent: string | null, box: { x: number; y: number; w: number; h: number }, container = false): DiagramNode => ({
  id,
  parent,
  label: id,
  shape: "rectangle",
  box,
  style: {},
  container,
});

const model: DiagramModel = {
  version: 1,
  nodes: [
    node("root", null, { x: 0, y: 0, w: 300, h: 240 }, true),
    node("root.inner", "root", { x: 40, y: 40, w: 160, h: 130 }, true),
    node("root.inner.api", "root.inner", { x: 70, y: 80, w: 50, h: 40 }),
    node("outside", null, { x: 360, y: 30, w: 80, h: 50 }),
  ],
  edges: [
    {
      id: "(root.inner.api -> outside)[0]",
      from: "root.inner.api",
      to: "outside",
      srcArrow: "none",
      dstArrow: "arrow",
      style: {},
      route: [
        { x: 120, y: 100 },
        { x: 250, y: 100 },
      ],
    },
  ],
};

describe("canvas geometry", () => {
  it("converts client coordinates through the SVG rect and viewBox", () => {
    expect(clientToModel({ x: 150, y: 260 }, { left: 50, top: 60, width: 200, height: 400 }, { x: -100, y: 10, w: 500, h: 1000 })).toEqual({
      x: 150,
      y: 510,
    });
  });

  it("finds nodes and edges fully inside a rectangle", () => {
    expect(itemsInRect(model, { x: 35, y: 35, w: 220, h: 140 })).toEqual(["root.inner", "root.inner.api", "(root.inner.api -> outside)[0]"]);
  });

  it("finds the deepest valid drop target and excludes moving subtrees", () => {
    expect(dropTargetAt(model, { x: 90, y: 90 }, ["outside"])).toBe("root.inner");
    expect(dropTargetAt(model, { x: 90, y: 90 }, ["root"])).toBeNull();
    expect(dropTargetAt(model, { x: 500, y: 500 }, ["outside"])).toBeNull();
  });

  it("resizes every handle and respects minimum size", () => {
    const box = { x: 10, y: 20, w: 100, h: 80 };
    expect(resizeBox(box, "e", 5, 9, 40, 30)).toEqual({ x: 10, y: 20, w: 105, h: 80 });
    expect(resizeBox(box, "s", 5, 9, 40, 30)).toEqual({ x: 10, y: 20, w: 100, h: 89 });
    expect(resizeBox(box, "w", 5, 9, 40, 30)).toEqual({ x: 15, y: 20, w: 95, h: 80 });
    expect(resizeBox(box, "n", 5, 9, 40, 30)).toEqual({ x: 10, y: 29, w: 100, h: 71 });
    expect(resizeBox(box, "ne", 5, 9, 40, 30)).toEqual({ x: 10, y: 29, w: 105, h: 71 });
    expect(resizeBox(box, "nw", 5, 9, 40, 30)).toEqual({ x: 15, y: 29, w: 95, h: 71 });
    expect(resizeBox(box, "se", 5, 9, 40, 30)).toEqual({ x: 10, y: 20, w: 105, h: 89 });
    expect(resizeBox(box, "sw", 5, 9, 40, 30)).toEqual({ x: 15, y: 20, w: 95, h: 89 });
    expect(resizeBox(box, "nw", 90, 70, 40, 30)).toEqual({ x: 70, y: 70, w: 40, h: 30 });
  });

  it("returns keyboard nudge deltas", () => {
    expect(nudgeDelta("ArrowLeft", false)).toEqual({ x: -10, y: 0 });
    expect(nudgeDelta("ArrowRight", true)).toEqual({ x: 1, y: 0 });
    expect(nudgeDelta("ArrowUp", false)).toEqual({ x: 0, y: -10 });
    expect(nudgeDelta("ArrowDown", true)).toEqual({ x: 0, y: 1 });
    expect(nudgeDelta("Enter", false)).toEqual({ x: 0, y: 0 });
  });
});

describe("letterboxed canvas mapping", () => {
  it("centres a wide viewBox in a tall box and maps through the bars", () => {
    const rect = { left: 0, top: 0, width: 400, height: 400 };
    const viewBox = { x: 0, y: 0, w: 800, h: 200 };
    expect(fitViewBox(rect, viewBox)).toEqual({ scale: 0.5, offsetX: 0, offsetY: 150 });
    expect(clientToModel({ x: 200, y: 200 }, rect, viewBox)).toEqual({ x: 400, y: 100 });
    expect(clientToModel({ x: 0, y: 150 }, rect, viewBox)).toEqual({ x: 0, y: 0 });
  });

  it("centres a tall viewBox horizontally", () => {
    const rect = { left: 10, top: 20, width: 600, height: 300 };
    const viewBox = { x: -50, y: -50, w: 100, h: 100 };
    const { scale, offsetX, offsetY } = fitViewBox(rect, viewBox);
    expect(scale).toBe(3);
    expect(offsetX).toBe(160);
    expect(offsetY).toBe(20);
    expect(clientToModel({ x: 310, y: 170 }, rect, viewBox)).toEqual({ x: 0, y: 0 });
  });
});
