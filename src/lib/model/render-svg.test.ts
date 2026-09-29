import { describe, expect, it } from "vitest";
import { modelBounds, renderModelSvg } from "./render-svg";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode } from "./types";

const node = (overrides: Partial<DiagramNode> & Pick<DiagramNode, "id">): DiagramNode => ({
  id: overrides.id,
  parent: overrides.parent ?? null,
  label: overrides.label ?? overrides.id,
  shape: overrides.shape ?? "rectangle",
  box: overrides.box ?? { x: 0, y: 0, w: 100, h: 60 },
  style: overrides.style ?? {},
  container: overrides.container ?? false,
  icon: overrides.icon,
  labelPosition: overrides.labelPosition,
  iconPosition: overrides.iconPosition,
  labelSize: overrides.labelSize,
});

const edge = (overrides: Partial<DiagramEdge> & Pick<DiagramEdge, "id">): DiagramEdge => ({
  id: overrides.id,
  from: overrides.from ?? "a",
  to: overrides.to ?? "b",
  label: overrides.label,
  labelSize: overrides.labelSize,
  srcArrow: overrides.srcArrow ?? "none",
  dstArrow: overrides.dstArrow ?? "triangle",
  style: overrides.style ?? {},
  route: overrides.route ?? [
    { x: 100, y: 30 },
    { x: 160, y: 30 },
  ],
});

describe("renderModelSvg", () => {
  it("renders groups, edges, nodes and labels in layer order", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node({ id: "group", container: true, box: { x: 0, y: 0, w: 220, h: 140 } }),
        node({ id: "group.a", parent: "group", box: { x: 20, y: 50, w: 80, h: 50 } }),
        node({ id: "b", box: { x: 180, y: 50, w: 80, h: 50 } }),
      ],
      edges: [edge({ id: "(group.a -> b)[0]", from: "group.a", to: "b", label: "edge" })],
    };
    const svg = renderModelSvg(model);
    expect(svg).toContain('data-id="group" data-kind="group"');
    expect(svg).toContain('data-edge="(group.a -&gt; b)[0]"');
    expect(svg).toContain('data-id="group.a" data-kind="node"');
    expect(svg.indexOf('data-kind="group"')).toBeLessThan(svg.indexOf("data-edge="));
    expect(svg.indexOf("data-edge=")).toBeLessThan(svg.indexOf('data-kind="node"'));
    expect(svg.indexOf('data-kind="node"')).toBeLessThan(svg.indexOf("data-edge-label="));
  });

  it("escapes labels and attributes", () => {
    const svg = renderModelSvg({
      version: 1,
      nodes: [node({ id: "a&b", label: `<script>&"'`, box: { x: 0, y: 0, w: 100, h: 60 } })],
      edges: [],
    });
    expect(svg).toContain('data-id="a&amp;b"');
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).not.toContain("<script>");
  });

  it("omits unsafe icons and keeps vendored and data image icons", () => {
    const dataUri = "data:image/png;base64,AAAA";
    const svg = renderModelSvg({
      version: 1,
      nodes: [
        node({ id: "safe", icon: "/icons/user.svg" }),
        node({ id: "data", icon: dataUri, box: { x: 120, y: 0, w: 100, h: 60 } }),
        node({ id: "unsafe", icon: "https://example.test/icon.svg", box: { x: 240, y: 0, w: 100, h: 60 } }),
      ],
      edges: [],
    });
    expect(svg).toContain('href="/icons/user.svg"');
    expect(svg).toContain(`href="${dataUri}"`);
    expect(svg).not.toContain("https://example.test");
  });

  it("expands the viewBox to include routes, outside labels and padding", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node({ id: "a", label: "Outside", labelPosition: "OUTSIDE_BOTTOM_CENTER", box: { x: 10, y: 20, w: 100, h: 60 }, labelSize: { w: 80, h: 20 } })],
      edges: [edge({ id: "e", route: [{ x: -20, y: -10 }, { x: 10, y: -10 }] })],
    };
    expect(modelBounds(model)).toEqual({ x: -20, y: -10, w: 130, h: 118 });
    expect(renderModelSvg(model, { padding: 10 })).toContain('viewBox="-30 -20 150 138"');
  });

  it("supports dashed edges, markers with prefixes, skipped empty routes and transparent background", () => {
    const svg = renderModelSvg(
      {
        version: 1,
        nodes: [node({ id: "a" }), node({ id: "b", box: { x: 200, y: 0, w: 100, h: 60 } })],
        edges: [
          edge({ id: "drawn", style: { stroke: "B1", strokeDash: 10 }, srcArrow: "circle", dstArrow: "filled-diamond" }),
          edge({ id: "empty", route: [] }),
        ],
      },
      { idPrefix: "test", background: null },
    );
    expect(svg).toContain("stroke-dasharray=");
    expect(svg).toContain('id="test-marker-circle-');
    expect(svg).toContain('marker-start="url(#test-marker-circle-');
    expect(svg).toContain('marker-end="url(#test-marker-filled-diamond-');
    expect(svg).toContain('data-edge="drawn"');
    expect(svg).not.toContain('data-edge="empty"');
    expect(svg).not.toContain('fill="#ffffff"/><g');
  });

  it("is deterministic", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node({ id: "a", style: { fill: "N7", stroke: "N2" } })],
      edges: [edge({ id: "e", style: { stroke: "#123456" } })],
    };
    expect(renderModelSvg(model)).toBe(renderModelSvg(model));
  });

  it("renders every supported shape without NaN", () => {
    const shapes = ["rectangle", "square", "cylinder", "queue", "oval", "circle", "diamond", "hexagon", "person", "cloud", "document", "page", "package", "parallelogram", "step", "callout", "stored_data", "image", "text"];
    const arrows: Arrowhead[] = ["arrow", "triangle", "diamond", "filled-diamond", "circle", "filled-circle", "box", "filled-box", "line", "cross", "cf-one", "cf-many", "cf-one-required", "cf-many-required"];
    const model: DiagramModel = {
      version: 1,
      nodes: shapes.map((shape, i) =>
        node({
          id: shape,
          shape,
          icon: shape === "image" ? "/icons/image.svg" : undefined,
          box: { x: (i % 5) * 120, y: Math.floor(i / 5) * 90, w: 100, h: 60 },
        }),
      ),
      edges: arrows.map((arrow, i) =>
        edge({
          id: `e${i}`,
          srcArrow: arrow,
          dstArrow: arrow,
          route: [
            { x: 0, y: 400 + i * 5 },
            { x: 100, y: 400 + i * 5 },
          ],
        }),
      ),
    };
    const svg = renderModelSvg(model);
    expect(svg).not.toContain("NaN");
    for (const shape of shapes) expect(svg).toContain(`data-id="${shape}"`);
  });
});
