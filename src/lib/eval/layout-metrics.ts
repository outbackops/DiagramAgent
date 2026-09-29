import { segmentHitsBox, unionBoxes } from "@/lib/model/geometry";
import type { Box, DiagramModel, DiagramNode, Point } from "@/lib/model/types";
import type { LayoutMetrics } from "./paired";

/**
 * Engine-neutral layout metrics for the paired Graph/Architecture comparison (plan U11 (a)): the
 * same checks on a D2-laid-out graph model and on an Architecture model. Only content counts —
 * components, boundaries and visible connectors — since page blocks (title, legend, workflow)
 * exist in one engine only.
 *
 * - hard: overlapping components (outside each other's ancestry), connector segments through a
 *   component that isn't an endpoint or an ancestor of one, and connector labels over components
 * - aspect: width over height of the content bounds
 * - crossings: pairs of connector segments from different connectors that properly cross
 */
export function layoutMetrics(model: DiagramModel): LayoutMetrics & { overlaps: number; through: number; labelHits: number } {
  const nodes = model.nodes.filter((n) => !n.generated);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let cur = byId.get(id)?.parent ?? null; cur; cur = byId.get(cur)?.parent ?? null) out.push(cur);
    return out;
  };
  const leaves = nodes.filter((n) => !n.container);
  const edges = model.edges.filter((e) => !e.hidden && e.route.length >= 2);

  let overlaps = 0;
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      if (boxOverlap(leaves[i].box, leaves[j].box) > 1) overlaps++;
    }
  }

  let through = 0;
  const segments: Array<{ edge: number; a: Point; b: Point }> = [];
  edges.forEach((edge, index) => {
    const ends = new Set([edge.from, edge.to, ...ancestors(edge.from), ...ancestors(edge.to)]);
    const hit = new Set<string>();
    for (let i = 0; i + 1 < edge.route.length; i++) {
      const a = edge.route[i];
      const b = edge.route[i + 1];
      segments.push({ edge: index, a, b });
      for (const leaf of leaves) if (!ends.has(leaf.id) && !hit.has(leaf.id) && segmentHitsBox(a, b, inset(leaf.box, 2))) hit.add(leaf.id);
    }
    through += hit.size;
  });

  let labelHits = 0;
  for (const edge of edges) {
    if (!edge.labelAt || !edge.labelSize) continue;
    const label = { x: edge.labelAt.x - edge.labelSize.w / 2, y: edge.labelAt.y - edge.labelSize.h / 2, w: edge.labelSize.w, h: edge.labelSize.h };
    for (const leaf of leaves) if (boxOverlap(label, leaf.box) > 1) labelHits++;
  }

  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[i].edge !== segments[j].edge && properIntersect(segments[i].a, segments[i].b, segments[j].a, segments[j].b)) crossings++;
    }
  }

  const bounds = contentBounds(nodes, edges.flatMap((e) => e.route));
  return { hard: overlaps + through + labelHits, overlaps, through, labelHits, aspect: bounds.h > 0 ? Math.round((bounds.w / bounds.h) * 100) / 100 : 0, crossings };
}

function contentBounds(nodes: DiagramNode[], points: Point[]): Box {
  const boxes = [...nodes.map((n) => n.box), ...points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))];
  return unionBoxes(boxes) ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** Segments that cross at a single interior point (touching or overlapping ends don't count). */
function properIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function boxOverlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}

function inset(box: Box, by: number): Box {
  return { x: box.x + by, y: box.y + by, w: Math.max(0, box.w - by * 2), h: Math.max(0, box.h - by * 2) };
}
