import type { CompiledConnection, CompiledDiagram, CompiledShape } from "@/lib/d2-render";
import { iconRegistry } from "@/lib/icon-registry";

/**
 * Deterministic diagram quality scoring. Runs on every render (no model
 * calls) and powers the UI quality panel, the refine loop's preflight, the
 * fixture tests, and the eval harness.
 */

export type CheckSeverity = "critical" | "major" | "minor";
export type CheckStatus = "pass" | "warn" | "fail";

export interface QualityCheck {
  id: string;
  label: string;
  severity: CheckSeverity;
  status: CheckStatus;
  detail: string;
}

export interface QualityMetrics {
  nodes: number;
  containers: number;
  connections: number;
  maxDepth: number;
  width: number;
  height: number;
  aspectRatio: number;
  iconCoverage: number;
  labelCoverage: number;
  crossings: number;
  orphans: number;
  edgesThroughNodes: number;
}

export type QualityGrade = "A" | "B" | "C" | "D" | "F";

export interface QualityReport {
  score: number;
  grade: QualityGrade;
  checks: QualityCheck[];
  metrics: QualityMetrics;
}

const WEIGHTS: Record<CheckSeverity, number> = { critical: 20, major: 10, minor: 4 };
const NOTE_LIKE = /(^|\.)(legend|notes?|key|title)$/i;
// Components usually drawn attached to a resource rather than wired to it.
const ATTACHMENT_LIKE = /(nsg|network[\s_-]?security[\s_-]?group|udr|route[\s_-]?table|routes?\b|polic(y|ies)|role|iam|identity|tags?\b|waf[\s_-]?policy)/i;

interface ShapeInfo {
  shape: CompiledShape;
  parent: string | null;
  isLeaf: boolean;
  lastSegment: string;
}

function parentOf(id: string): string | null {
  const i = id.lastIndexOf(".");
  return i > 0 ? id.slice(0, i) : null;
}

function describeShapes(shapes: CompiledShape[]): ShapeInfo[] {
  const ids = shapes.map((s) => s.id);
  return shapes.map((shape) => ({
    shape,
    parent: parentOf(shape.id),
    isLeaf: !ids.some((other) => other.startsWith(`${shape.id}.`)),
    lastSegment: shape.id.slice(shape.id.lastIndexOf(".") + 1),
  }));
}

/** Icon values that will not resolve: not a registry key and not a URL/path. */
export function findUnknownIcons(code: string): string[] {
  const unknown = new Set<string>();
  for (const match of code.matchAll(/(?:^|[\s{;.])icon:[ \t]*([^;{}\n#]+)(?:#.*)?/gm)) {
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (/^(https?:)?\/\//.test(value) || value.startsWith("/")) continue;
    if (!iconRegistry[value]) unknown.add(value);
  }
  return [...unknown];
}

/** Top-level leaves that duplicate a nested node's name — the classic unqualified-connection bug. */
export function findPhantomNodes(infos: ShapeInfo[], connections: CompiledConnection[]): string[] {
  const nestedNames = new Set(infos.filter((i) => i.shape.level > 1).map((i) => i.lastSegment));
  const connected = new Set(connections.flatMap((c) => [c.src, c.dst]));
  return infos
    .filter((i) => i.shape.level === 1 && i.isLeaf && !i.shape.icon && nestedNames.has(i.lastSegment) && connected.has(i.shape.id))
    .map((i) => i.shape.id);
}

type Segment = [{ x: number; y: number }, { x: number; y: number }];

function segments(route: Array<{ x: number; y: number }>): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < route.length; i++) out.push([route[i - 1], route[i]]);
  return out;
}

function properlyIntersect(a: Segment, b: Segment): boolean {
  const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(b[0], b[1], a[0]);
  const d2 = cross(b[0], b[1], a[1]);
  const d3 = cross(a[0], a[1], b[0]);
  const d4 = cross(a[0], a[1], b[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Caps on geometric work so a huge (or hostile) diagram can't stall scoring.
 * Past the cap the counts are underestimates, which is fine for an advisory score.
 */
const PAIR_BUDGET = 2_000_000;

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function extentOf(points: Array<{ x: number; y: number }>): Extent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const extentsOverlap = (a: Extent, b: Extent) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export function countCrossings(connections: CompiledConnection[]): number {
  const prepared = connections.map((c) => ({ c, segs: segments(c.route ?? []), extent: extentOf(c.route ?? []) }));
  let crossings = 0;
  let budget = PAIR_BUDGET;
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      // Edges that share an endpoint meet by design.
      if (a.c.src === b.c.src || a.c.src === b.c.dst || a.c.dst === b.c.src || a.c.dst === b.c.dst) continue;
      if (!extentsOverlap(a.extent, b.extent)) continue;
      budget -= a.segs.length * b.segs.length;
      if (budget < 0) return crossings;
      if (a.segs.some((x) => b.segs.some((y) => properlyIntersect(x, y)))) crossings++;
    }
  }
  return crossings;
}

function segmentCrossesBox(a: { x: number; y: number }, b: { x: number; y: number }, box: { x: number; y: number; w: number; h: number }): boolean {
  // Liang–Barsky clip: does the segment enter the box interior?
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/** Connections whose route runs through a component that is neither its source nor its target. */
export function findEdgesThroughNodes(diagram: CompiledDiagram, inset = 6): string[] {
  const ids = diagram.shapes.map((s) => s.id);
  const leaves = diagram.shapes.filter((s) => !ids.some((other) => other.startsWith(`${s.id}.`)));
  const hits: string[] = [];
  let budget = PAIR_BUDGET;
  for (const c of diagram.connections) {
    const route = c.route ?? [];
    const extent = extentOf(route);
    const through = leaves.some((leaf) => {
      if (leaf.id === c.src || leaf.id === c.dst) return false;
      const box = { x: leaf.pos.x + inset, y: leaf.pos.y + inset, w: leaf.width - inset * 2, h: leaf.height - inset * 2 };
      if (box.w <= 0 || box.h <= 0) return false;
      if (!extentsOverlap(extent, { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h })) return false;
      budget -= route.length;
      if (budget < 0) return false;
      for (let i = 1; i < route.length; i++) if (segmentCrossesBox(route[i - 1], route[i], box)) return true;
      return false;
    });
    if (through) hits.push(c.id);
    if (budget < 0) break;
  }
  return hits;
}

function overlapArea(a: CompiledShape, b: CompiledShape): number {
  const w = Math.min(a.pos.x + a.width, b.pos.x + b.width) - Math.max(a.pos.x, b.pos.x);
  const h = Math.min(a.pos.y + a.height, b.pos.y + b.height) - Math.max(a.pos.y, b.pos.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function findOverlaps(infos: ShapeInfo[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < infos.length; i++) {
    for (let j = i + 1; j < infos.length; j++) {
      if (infos[i].parent !== infos[j].parent) continue;
      if (overlapArea(infos[i].shape, infos[j].shape) > 4) out.push(`${infos[i].shape.id} ↔ ${infos[j].shape.id}`);
    }
  }
  return out;
}

function band(value: number, passAt: number, warnAt: number, higherIsBetter = true): CheckStatus {
  if (higherIsBetter) return value >= passAt ? "pass" : value >= warnAt ? "warn" : "fail";
  return value <= passAt ? "pass" : value <= warnAt ? "warn" : "fail";
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function scoreDiagram(code: string, diagram: CompiledDiagram): QualityReport {
  const infos = describeShapes(diagram.shapes);
  const leaves = infos.filter((i) => i.isLeaf && !NOTE_LIKE.test(i.shape.id));
  const containers = infos.filter((i) => !i.isLeaf);
  const connections = diagram.connections;
  const checks: QualityCheck[] = [];
  const add = (check: QualityCheck) => checks.push(check);

  // Size & connectivity
  add({
    id: "size",
    label: "Enough components",
    severity: "major",
    status: band(leaves.length, 3, 2),
    detail: `${leaves.length} components`,
  });
  add({
    id: "connections",
    label: "Components are connected",
    severity: "critical",
    status: leaves.length < 2 || connections.length > 0 ? "pass" : "fail",
    detail: `${connections.length} connections`,
  });

  const phantoms = findPhantomNodes(infos, connections);
  add({
    id: "phantom_nodes",
    label: "No duplicate nodes from unqualified connections",
    severity: "critical",
    status: phantoms.length === 0 ? "pass" : "fail",
    detail: phantoms.length === 0 ? "All connection endpoints resolve to declared nodes" : `Duplicated: ${phantoms.slice(0, 5).join(", ")}`,
  });

  const unknownIcons = findUnknownIcons(code);
  add({
    id: "unknown_icons",
    label: "Icons resolve",
    severity: "major",
    status: unknownIcons.length === 0 ? "pass" : "fail",
    detail: unknownIcons.length === 0 ? "Every icon key is known" : `Unknown icon keys: ${unknownIcons.slice(0, 5).join(", ")}`,
  });

  const iconCoverage = leaves.length ? leaves.filter((l) => l.shape.icon).length / leaves.length : 1;
  add({
    id: "icon_coverage",
    label: "Components have icons",
    severity: "major",
    status: band(iconCoverage, 0.8, 0.5),
    detail: `${pct(iconCoverage)} of components have an icon`,
  });

  const labeled = connections.filter((c) => c.label && c.label.trim().length > 0).length;
  const labelCoverage = connections.length ? labeled / connections.length : 1;
  add({
    id: "connection_labels",
    label: "Connections are labelled",
    severity: "minor",
    status: band(labelCoverage, 0.6, 0.3),
    detail: `${pct(labelCoverage)} of connections have a protocol/label`,
  });

  const connectedIds = new Set(connections.flatMap((c) => [c.src, c.dst]));
  const orphanList = leaves.filter(
    (l) =>
      !ATTACHMENT_LIKE.test(`${l.lastSegment} ${l.shape.label ?? ""}`) &&
      ![...connectedIds].some((id) => id === l.shape.id || id.startsWith(`${l.shape.id}.`)),
  );
  const orphanRatio = leaves.length ? orphanList.length / leaves.length : 0;
  add({
    id: "orphans",
    label: "Few unconnected components",
    severity: "major",
    status: band(orphanRatio, 0.15, 0.3, false),
    detail:
      orphanList.length === 0
        ? "Every component is connected"
        : `${orphanList.length} unconnected: ${orphanList.slice(0, 4).map((o) => o.lastSegment).join(", ")}`,
  });

  const maxDepth = infos.reduce((m, i) => Math.max(m, i.shape.level), 0);
  add({
    id: "nesting",
    label: "Reasonable nesting depth",
    severity: "minor",
    status: band(maxDepth, 6, 7, false),
    detail: `${maxDepth} levels deep`,
  });

  const fanout = containers.map((c) => ({ id: c.shape.id, n: infos.filter((i) => i.parent === c.shape.id).length }));
  const crowded = fanout.filter((f) => f.n > 12);
  add({
    id: "container_fanout",
    label: "Containers are not overcrowded",
    severity: "minor",
    status: crowded.length === 0 ? "pass" : "warn",
    detail: crowded.length === 0 ? "No container has more than 12 children" : `Crowded: ${crowded.map((c) => `${c.id} (${c.n})`).join(", ")}`,
  });

  add({
    id: "direction",
    label: "Layout direction is set",
    severity: "minor",
    status: /^direction:\s*\w+/m.test(code) ? "pass" : "warn",
    detail: /^direction:\s*(\w+)/m.exec(code)?.[1] ?? "not set",
  });

  // Layout geometry
  const minX = Math.min(...diagram.shapes.map((s) => s.pos.x));
  const minY = Math.min(...diagram.shapes.map((s) => s.pos.y));
  const maxX = Math.max(...diagram.shapes.map((s) => s.pos.x + s.width));
  const maxY = Math.max(...diagram.shapes.map((s) => s.pos.y + s.height));
  const width = diagram.shapes.length ? maxX - minX : 0;
  const height = diagram.shapes.length ? maxY - minY : 0;
  const aspectRatio = height > 0 ? width / height : 0;
  // Wide strips and tall towers both end up unreadably small when fitted to a screen.
  add({
    id: "aspect_ratio",
    label: "Balanced aspect ratio",
    severity: "major",
    status: aspectRatio >= 0.6 && aspectRatio <= 2.6 ? "pass" : aspectRatio >= 0.4 && aspectRatio <= 3.6 ? "warn" : "fail",
    detail: `${aspectRatio.toFixed(2)}:1 (${Math.round(width)}×${Math.round(height)})`,
  });

  const throughNodes = findEdgesThroughNodes(diagram);
  const throughRate = connections.length ? throughNodes.length / connections.length : 0;
  add({
    id: "edges_through_nodes",
    label: "Connections route around components",
    severity: "major",
    status: throughNodes.length === 0 ? "pass" : throughRate <= 0.1 ? "warn" : "fail",
    detail:
      throughNodes.length === 0
        ? "No connection passes through an unrelated component"
        : `${throughNodes.length} connection${throughNodes.length === 1 ? "" : "s"} pass through unrelated components`,
  });

  const overlaps = findOverlaps(infos);
  add({
    id: "overlaps",
    label: "No overlapping shapes",
    severity: "critical",
    status: overlaps.length === 0 ? "pass" : "fail",
    detail: overlaps.length === 0 ? "No sibling shapes overlap" : overlaps.slice(0, 3).join("; "),
  });

  const crossings = countCrossings(connections);
  const crossingRate = connections.length ? crossings / connections.length : 0;
  add({
    id: "crossings",
    label: "Few crossing connections",
    severity: "minor",
    status: band(crossingRate, 0.25, 0.6, false),
    detail: `${crossings} crossing pair${crossings === 1 ? "" : "s"} across ${connections.length} connections`,
  });

  const direction = /^direction:\s*(\w+)/m.exec(code)?.[1] ?? "down";
  const byId = new Map(diagram.shapes.map((s) => [s.id, s]));
  const center = (s: CompiledShape) => ({ x: s.pos.x + s.width / 2, y: s.pos.y + s.height / 2 });
  const backward = connections.filter((c) => {
    const a = byId.get(c.src);
    const b = byId.get(c.dst);
    if (!a || !b) return false;
    const ca = center(a);
    const cb = center(b);
    if (direction === "down") return cb.y < ca.y - 20;
    if (direction === "up") return cb.y > ca.y + 20;
    if (direction === "left") return cb.x > ca.x + 20;
    return cb.x < ca.x - 20;
  }).length;
  const backwardRate = connections.length ? backward / connections.length : 0;
  add({
    id: "flow",
    label: "Connections follow the layout direction",
    severity: "minor",
    status: band(backwardRate, 0.2, 0.4, false),
    detail: `${pct(backwardRate)} of connections flow against "${direction}"`,
  });

  const longLabels = leaves.filter((l) => (l.shape.label ?? "").length > 40);
  add({
    id: "label_length",
    label: "Concise node labels",
    severity: "minor",
    status: longLabels.length === 0 ? "pass" : "warn",
    detail: longLabels.length === 0 ? "All labels ≤ 40 characters" : `${longLabels.length} long label(s)`,
  });

  let score = 100;
  for (const check of checks) {
    if (check.status === "fail") score -= WEIGHTS[check.severity];
    else if (check.status === "warn") score -= WEIGHTS[check.severity] / 2;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade: QualityGrade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return {
    score,
    grade,
    checks,
    metrics: {
      nodes: leaves.length,
      containers: containers.length,
      connections: connections.length,
      maxDepth,
      width: Math.round(width),
      height: Math.round(height),
      aspectRatio: Number(aspectRatio.toFixed(2)),
      iconCoverage: Number(iconCoverage.toFixed(2)),
      labelCoverage: Number(labelCoverage.toFixed(2)),
      crossings,
      orphans: orphanList.length,
      edgesThroughNodes: throughNodes.length,
    },
  };
}

export { hasCriticalFailure, qualityFeedback } from "./report";
