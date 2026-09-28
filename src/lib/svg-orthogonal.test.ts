import { describe, it, expect } from "vitest";
import {
  countObstacleHits,
  isOrthogonalRoute,
  orthogonalizeConnections,
  parseVertices,
  routeOrthogonal,
} from "./svg-orthogonal";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("svg-orthogonal (legacy wrapper)", () => {
  it("orthogonalises a diagonal connection (vertical-first when dx == dy)", () => {
    const out = orthogonalizeConnections(`<svg><g class="connection"><path d="M 10 10 L 100 100" /></g></svg>`, { obstacles: [] }).svg;
    expect(out).toContain('d="M 10 10 L 10 55 L 100 55 L 100 100"');
  });

  it("ignores non-connection paths", () => {
    const out = orthogonalizeConnections(`<svg><g class="node"><path d="M 0 0 L 10 10" /></g></svg>`, { obstacles: [] }).svg;
    expect(out).toContain('d="M 0 0 L 10 10"');
  });

  it("orthogonalises Bezier curves", () => {
    const out = orthogonalizeConnections(`<svg><g class="connection"><path d="M 10 10 C 20 20 80 80 100 100" /></g></svg>`, { obstacles: [] }).svg;
    expect(out).toContain('d="M 10 10 L 10 55 L 100 55 L 100 100"');
  });
});

describe("parseVertices / isOrthogonalRoute", () => {
  it("parses M/L/H/V/C commands", () => {
    expect(parseVertices("M 0 0 L 10 0 V 20 H 30 C 31 21 32 22 40 25")).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 40, y: 25 },
    ]);
  });

  it("treats axis-aligned routes with small rounded corners as orthogonal", () => {
    expect(isOrthogonalRoute(parseVertices("M 0 0 L 100 0 C 104 0 108 4 108 8 L 108 200"))).toBe(true);
    expect(isOrthogonalRoute(parseVertices("M 0 0 L 100 100"))).toBe(false);
  });
});

describe("routeOrthogonal", () => {
  it("picks a split that avoids obstacles", () => {
    // Blocks the midpoint split (x = 50) below y = 20; only a late split clears it.
    const blocker = { x: 40, y: 20, w: 20, h: 100 };
    const route = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 100 }, [blocker]);
    expect(countObstacleHits(route, [blocker])).toBe(0);
    expect(isOrthogonalRoute(route)).toBe(true);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route.at(-1)).toEqual({ x: 100, y: 100 });
  });
});

describe("orthogonalizeConnections", () => {
  const cls = b64("(a -&gt; b)[0]");
  const svg = (d: string) =>
    [
      "<svg>",
      '<mask id="m"><rect x="0" y="0" width="500" height="500" fill="white"></rect><rect x="40" y="40" width="30" height="21" fill="black"></rect></mask>',
      `<g class="${cls}"><path d="${d}" class="connection stroke-B1" fill="none" stroke="#000"/><text x="55" y="56" style="text-anchor:middle;font-size:16px">SQL</text></g>`,
      "</svg>",
    ].join("");

  it("keeps routes ELK already drew orthogonally, including their labels", () => {
    const input = svg("M 0 50 L 200 50");
    const { svg: out, routes } = orthogonalizeConnections(input, { obstacles: [] });
    expect(out).toContain('d="M 0 50 L 200 50"');
    expect(out).toContain('x="55" y="56"');
    expect(routes.get("(a -> b)[0]")).toEqual([
      { x: 0, y: 50 },
      { x: 200, y: 50 },
    ]);
  });

  it("reroutes diagonals and moves the label and its mask cut-out onto the new line", () => {
    const { svg: out, routes } = orthogonalizeConnections(svg("M 0 0 L 300 100"), { obstacles: [] });
    const route = routes.get("(a -> b)[0]")!;
    expect(isOrthogonalRoute(route)).toBe(true);
    // Horizontal-first split at x = 150: longest segments are the horizontal runs.
    const text = /<text x="([\d.]+)" y="([\d.]+)"/.exec(out)!;
    const [x, y] = [Number(text[1]), Number(text[2])];
    const onRoute = route.some((p, i) => i > 0 && Math.min(p.y, route[i - 1].y) <= y - 6 && Math.max(p.y, route[i - 1].y) >= y - 6 && Math.min(p.x, route[i - 1].x) <= x && Math.max(p.x, route[i - 1].x) >= x);
    expect(onRoute).toBe(true);
    const cutout = /<rect x="([\d.-]+)" y="([\d.-]+)" width="30" height="21" fill="black"/.exec(out)!;
    expect(Number(cutout[1])).toBeCloseTo(40 + (x - 55), 5);
    expect(Number(cutout[2])).toBeCloseTo(40 + (y - 56), 5);
  });

  it("shifts descendant tspans by the label dx", () => {
    const input = [
      "<svg>",
      '<mask id="m"><rect x="40" y="40" width="80" height="40" fill="black"></rect></mask>',
      `<g class="${cls}"><path d="M 0 0 L 300 100" class="connection" fill="none" stroke="#000"/><text x="55" y="56" style="font-size:16px"><tspan x="55">SQL</tspan><tspan x="55" dy="16">read</tspan></text></g>`,
      "</svg>",
    ].join("");
    const out = orthogonalizeConnections(input, { obstacles: [] }).svg;
    const textX = Number(/<text x="([\d.]+)"/.exec(out)![1]);
    const tspans = [...out.matchAll(/<tspan x="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(tspans).toEqual([textX, textX]);
  });

  it("does not let two labels claim the same mask cut-out", () => {
    const other = b64("(c -&gt; d)[0]");
    const input = [
      "<svg>",
      '<mask id="m"><rect x="40" y="40" width="80" height="40" fill="black"></rect></mask>',
      `<g class="${cls}"><path d="M 0 0 L 300 100" class="connection" fill="none" stroke="#000"/><text x="55" y="56" style="font-size:16px">A</text></g>`,
      `<g class="${other}"><path d="M 0 10 L 500 110" class="connection" fill="none" stroke="#000"/><text x="55" y="56" style="font-size:16px">B</text></g>`,
      "</svg>",
    ].join("");
    const out = orthogonalizeConnections(input, { obstacles: [] }).svg;
    const textXs = [...out.matchAll(/<text x="([\d.]+)"/g)].map((match) => Number(match[1]));
    const cutout = /<rect x="([\d.-]+)" y="([\d.-]+)" width="80" height="40" fill="black"/.exec(out)!;
    expect(Number(cutout[1])).toBeCloseTo(40 + (textXs[0] - 55), 5);
    expect(Number(cutout[1])).not.toBeCloseTo(40 + (textXs[1] - 55), 5);
  });

  it("does not treat the edge's own endpoint nodes as obstacles", () => {
    const source = { x: -10, y: -10, w: 20, h: 20 };
    const target = { x: 290, y: 90, w: 20, h: 20 };
    const { routes } = orthogonalizeConnections(svg("M 0 0 L 300 100"), { obstacles: [source, target] });
    const route = routes.get("(a -> b)[0]")!;
    expect(route[1]).toEqual({ x: 150, y: 0 });
  });
});
