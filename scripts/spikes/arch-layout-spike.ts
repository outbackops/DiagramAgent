/**
 * U0 falsification spike (docs/plans/2026-09-29-reference-architecture-diagrams-plan.md).
 *
 * Can ELK's layered compound layout, plus a FROZEN set of generic polish passes, lay out
 * materially different architecture topologies within the gate's thresholds? The same
 * topologies also go through D2 (ELK) for the paired baseline. Scratch tooling: never
 * imported by the app.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/spikes/arch-layout-spike.ts --out <dir> [--reserved] [--only 03]
 *
 * Frozen before scoring (anti-overfitting): the option sets in CANDIDATES/FALLBACK, and
 * the polish passes P1–P4 below. Nothing here may look at a topology's name or ids.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { measureText, wrapText } from "@/lib/compose/text";
import type { TextStyle } from "@/lib/compose/theme";
import { modelFromD2Code } from "@/lib/model/from-d2";
import { renderModelSvg } from "@/lib/model/render-svg";
import { routeEdge } from "@/lib/model/route";
import type { Box, Point } from "@/lib/model/types";
import { svgToPng } from "@/lib/svg-raster";

// ---------------------------------------------------------------- spec (draft grammar)

interface SNode { id: string; name: string; icon?: string; detail?: string }
interface SGroup { type: "group"; id: string; name: string; kind: string; facts?: string; items: SItem[] }
type SItem = SNode | SGroup;
interface SConn { from: string; to: string; meaning?: string; label?: string; step?: string }
interface Spec { title: string; items: SItem[]; connections: SConn[]; overlays?: { kind: string; name: string; members: string[] }[] }

const isGroup = (item: SItem): item is SGroup => Array.isArray((item as SGroup).items);

interface Info { id: string; item: SItem; parent: string | null; order: number; group: boolean; shared: boolean; band: boolean }

function indexSpec(spec: Spec): Map<string, Info> {
  const info = new Map<string, Info>();
  let order = 0;
  // shared: inside any shared-services group; band: inside a TOP-LEVEL one (laid out in the bottom band).
  const walk = (items: SItem[], parent: string | null, shared: boolean, band: boolean) => {
    for (const item of items) {
      const group = isGroup(item);
      const isShared = shared || (group && item.kind === "shared");
      const inBand = band || (parent === null && group && item.kind === "shared");
      info.set(item.id, { id: item.id, item, parent, order: order++, group, shared: isShared, band: inBand });
      if (group) walk(item.items, item.id, isShared, inBand);
    }
  };
  walk(spec.items, null, false, false);
  return info;
}

function ancestorsOf(id: string, info: Map<string, Info>): string[] {
  const out: string[] = [];
  let p = info.get(id)?.parent ?? null;
  while (p) {
    out.push(p);
    p = info.get(p)?.parent ?? null;
  }
  return out;
}

// ---------------------------------------------------------------- measurement (frozen)

const T = {
  label: { size: 13, weight: 400 } as TextStyle,
  detail: { size: 11, weight: 400 } as TextStyle,
  title: { size: 13, weight: 600 } as TextStyle,
  facts: { size: 11, weight: 400, mono: true } as TextStyle,
  edge: { size: 11, weight: 400 } as TextStyle,
};
const ICON = 44;
const PAD = 20;
const GAP = 24;

interface NodeGeom { w: number; h: number; lines: string[]; detail?: string }
function nodeGeom(n: SNode): NodeGeom {
  const name = wrapText(n.name, 150, T.label, 2);
  const detail = n.detail ? wrapText(n.detail, 150, T.detail, 1).lines[0] : undefined;
  const textW = Math.max(...name.lines.map((l) => measureText(l, T.label)), detail ? measureText(detail, T.detail) : 0);
  return { w: Math.max(112, Math.ceil(textW) + 16), h: 6 + ICON + 8 + name.lines.length * 17 + (detail ? 15 : 0) + 6, lines: name.lines, detail };
}
function headerTop(g: SGroup): number {
  return g.facts ? 54 : 40;
}
function groupMinWidth(g: SGroup): number {
  return Math.ceil(Math.max(measureText(g.name, T.title), g.facts ? measureText(g.facts, T.facts) : 0) + 12 + 24 + 12 + 12);
}
/** The group's title text area, which no connector may cross. */
function titleBox(g: SGroup, box: Box): Box {
  const w = Math.max(measureText(g.name, T.title), g.facts ? measureText(g.facts, T.facts) : 0) + 24 + 8;
  return { x: box.x + 10, y: box.y + 8, w, h: g.facts ? 38 : 22 };
}

// ---------------------------------------------------------------- P1: pack edge-free subtrees

/** Relative boxes of a packed subtree: children in author order, rows of at most 4. */
interface Packed { w: number; h: number; rel: Map<string, Box> }
function pack(item: SItem): Packed {
  if (!isGroup(item)) {
    const g = nodeGeom(item);
    return { w: g.w, h: g.h, rel: new Map() };
  }
  const kids = item.items.map((child) => ({ child, packed: pack(child) }));
  const rel = new Map<string, Box>();
  const top = headerTop(item);
  let y = top;
  let width = 0;
  for (let i = 0; i < kids.length; i += 4) {
    const row = kids.slice(i, i + 4);
    let x = PAD;
    const rowH = Math.max(...row.map((k) => k.packed.h));
    for (const { child, packed } of row) {
      rel.set(child.id, { x, y, w: packed.w, h: packed.h });
      for (const [id, b] of packed.rel) rel.set(id, { x: x + b.x, y: y + b.y, w: b.w, h: b.h });
      x += packed.w + GAP;
    }
    width = Math.max(width, x - GAP + PAD);
    y += rowH + GAP;
  }
  const w = Math.max(width, groupMinWidth(item));
  return { w, h: kids.length ? y - GAP + PAD : top + PAD, rel };
}

// ---------------------------------------------------------------- ELK (frozen option sets)

const BASE: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  "elk.edgeLabels.placement": "CENTER",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};
// Model-order options only at the root: set on child graphs they crash ELK (spike finding).
const ORDERED: Record<string, string> = {
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
};
const CANDIDATES = [
  { id: "right-ns", dir: "RIGHT", place: "NETWORK_SIMPLEX" },
  { id: "right-bk", dir: "RIGHT", place: "BRANDES_KOEPF" },
  { id: "down-ns", dir: "DOWN", place: "NETWORK_SIMPLEX" },
  { id: "down-bk", dir: "DOWN", place: "BRANDES_KOEPF" },
  // Long flows wrap into rows (ELK layer wrapping works with nested groups; probe: 7.2:1 → 2.0:1).
  { id: "wrap-multi", dir: "RIGHT", place: "NETWORK_SIMPLEX", wrap: "MULTI_EDGE" },
  { id: "wrap-single", dir: "RIGHT", place: "BRANDES_KOEPF", wrap: "SINGLE_EDGE" },
  // Tall flows wrap into columns.
  { id: "down-wrap", dir: "DOWN", place: "NETWORK_SIMPLEX", wrap: "MULTI_EDGE" },
] as const;
const optionsFor = (cand: (typeof CANDIDATES)[number], ordered: boolean): Record<string, string> => ({
  ...BASE,
  ...(ordered ? ORDERED : {}),
  "elk.direction": cand.dir,
  "elk.layered.nodePlacement.strategy": cand.place,
  ...("wrap" in cand ? { "elk.layered.wrapping.strategy": cand.wrap, "elk.aspectRatio": "1.6" } : {}),
});

interface Plan {
  spec: Spec;
  info: Map<string, Info>;
  packed: Map<string, Packed>; // packed group id -> relative layout of its subtree
  elkEdges: SConn[];
  afterEdges: SConn[]; // back-edges, hierarchy edges, visible shared edges: routed after layout
  hidden: SConn[];
}

function planSpec(spec: Spec): Plan {
  const info = indexSpec(spec);
  const touched = new Set<string>();
  for (const c of spec.connections) {
    touched.add(c.from);
    touched.add(c.to);
  }
  // P1: a group whose descendants no connector touches is packed as one block.
  const packed = new Map<string, Packed>();
  const hasTouchedDescendant = (item: SItem): boolean => isGroup(item) && item.items.some((c) => touched.has(c.id) || hasTouchedDescendant(c));
  const findPackable = (items: SItem[]) => {
    for (const item of items) {
      if (!isGroup(item)) continue;
      if (!hasTouchedDescendant(item) && item.items.length > 0) packed.set(item.id, pack(item));
      else findPackable(item.items);
    }
  };
  findPackable(spec.items);

  // P2: connectors into shared services. Monitoring and management links are implied by the band
  // (reference diagrams don't draw one per component); others are hidden when 3+ components use one service.
  const sharedTargets = new Map<string, number>();
  for (const c of spec.connections) if (info.get(c.to)?.shared && !info.get(c.from)?.shared) sharedTargets.set(c.to, (sharedTargets.get(c.to) ?? 0) + 1);
  const hidden: SConn[] = [];
  const afterEdges: SConn[] = [];
  const main: SConn[] = [];
  for (const c of spec.connections) {
    const a = info.get(c.from);
    const b = info.get(c.to);
    if (!a || !b) continue;
    const implied = (c.meaning === "monitoring" || c.meaning === "management") && (a.shared || b.shared);
    if (implied || (b.shared && (sharedTargets.get(c.to) ?? 0) >= 3)) {
      hidden.push(c);
      continue;
    }
    if (a.band || b.band) {
      afterEdges.push(c);
      continue;
    }
    if (ancestorsOf(c.to, info).includes(c.from) || ancestorsOf(c.from, info).includes(c.to)) {
      afterEdges.push(c);
      continue;
    }
    main.push(c);
  }
  // P5: parallel peers. Sibling groups of one kind that a common outside source feeds (zones,
  // spokes, regions) are parallel lanes: connectors between them don't decide the layout.
  const within = (id: string, root: string) => id === root || ancestorsOf(id, info).includes(root);
  const feeders = new Map<string, Set<string>>();
  for (const i of info.values()) {
    if (!i.group) continue;
    const s = new Set<string>();
    for (const c of main) if (within(c.to, i.id) && !within(c.from, i.id)) s.add(c.from);
    feeders.set(i.id, s);
  }
  const blockOf = (id: string, parent: string | null) => {
    const chain = [id, ...ancestorsOf(id, info)];
    const at = parent === null ? chain.length - 1 : chain.indexOf(parent) - 1;
    return at >= 0 ? chain[at] : undefined;
  };
  const peers = (c: SConn): boolean => {
    const up = ancestorsOf(c.to, info);
    const common = ancestorsOf(c.from, info).find((a) => up.includes(a)) ?? null;
    const a = blockOf(c.from, common);
    const b = blockOf(c.to, common);
    if (!a || !b || a === b) return false;
    const ia = info.get(a)!, ib = info.get(b)!;
    if (!ia.group || !ib.group || (ia.item as SGroup).kind !== (ib.item as SGroup).kind) return false;
    const fb = feeders.get(b)!;
    return [...feeders.get(a)!].some((f) => fb.has(f) && !within(f, a) && !within(f, b));
  };
  const flow = main.filter((c) => !peers(c));
  afterEdges.push(...main.filter((c) => peers(c)));
  // P3: a back-edge (target earlier in author order, closing a cycle) is routed after layout.
  const out = new Map<string, string[]>();
  for (const c of flow) out.set(c.from, [...(out.get(c.from) ?? []), c.to]);
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of out.get(cur) ?? []) {
        if (next === to) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  const elkEdges: SConn[] = [];
  for (const c of flow) {
    const back = info.get(c.to)!.order < info.get(c.from)!.order && reaches(c.to, c.from);
    (back ? afterEdges : elkEdges).push(c);
  }
  return { spec, info, packed, elkEdges, afterEdges, hidden };
}

function elkNodeFor(plan: Plan, item: SItem): ElkNode {
  const p = plan.packed.get(item.id);
  if (p) return { id: item.id, width: p.w, height: p.h };
  if (!isGroup(item)) {
    const g = nodeGeom(item);
    return { id: item.id, width: g.w, height: g.h };
  }
  const top = headerTop(item);
  return {
    id: item.id,
    layoutOptions: {
      "elk.padding": `[top=${top},left=${PAD},bottom=${PAD},right=${PAD}]`,
      "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
      "elk.nodeSize.minimum": `(${groupMinWidth(item)}, ${top + PAD})`,
    },
    children: item.items.filter((c) => !plan.info.get(c.id)!.band).map((c) => elkNodeFor(plan, c)),
  };
}

function elkEdgesFor(conns: SConn[]): ElkExtendedEdge[] {
  return conns.map((c, i) => ({
    id: `e${i}`,
    sources: [c.from],
    targets: [c.to],
    labels: c.label ? [{ text: c.label, width: Math.ceil(measureText(c.label, T.edge)) + 10, height: 16 }] : [],
  }));
}

function buildElk(plan: Plan, options: Record<string, string>): ElkNode {
  return { id: "root", layoutOptions: options, children: plan.spec.items.filter((i) => !plan.info.get(i.id)!.band).map((i) => elkNodeFor(plan, i)), edges: elkEdgesFor(plan.elkEdges) };
}

// ---------------------------------------------------------------- geometry

interface Geo {
  boxes: Map<string, Box>; // absolute; groups and leaves
  edges: Array<{ conn: SConn; points: Point[]; label?: Box; after: boolean }>;
  width: number;
  height: number;
}

function extract(plan: Plan, out: ElkNode, conns: SConn[] = plan.elkEdges): Geo {
  const boxes = new Map<string, Box>();
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const c of node.children ?? []) {
      const b = { x: ox + (c.x ?? 0), y: oy + (c.y ?? 0), w: c.width ?? 0, h: c.height ?? 0 };
      boxes.set(c.id, b);
      const p = plan.packed.get(c.id);
      if (p) for (const [id, r] of p.rel) boxes.set(id, { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h });
      walk(c, b.x, b.y);
    }
  };
  walk(out, 0, 0);
  const edges: Geo["edges"] = [];
  (out.edges ?? []).forEach((e, i) => {
    const conn = conns[i];
    const container = (e as ElkExtendedEdge & { container?: string }).container;
    const off = container && container !== "root" ? boxes.get(container) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const points: Point[] = [];
    for (const s of e.sections ?? []) {
      points.push({ x: s.startPoint.x + off.x, y: s.startPoint.y + off.y });
      for (const bp of s.bendPoints ?? []) points.push({ x: bp.x + off.x, y: bp.y + off.y });
      points.push({ x: s.endPoint.x + off.x, y: s.endPoint.y + off.y });
    }
    const l = e.labels?.[0];
    edges.push({ conn, points, label: l ? { x: (l.x ?? 0) + off.x, y: (l.y ?? 0) + off.y, w: l.width ?? 0, h: l.height ?? 0 } : undefined, after: false });
  });
  return { boxes, edges, width: out.width ?? 0, height: out.height ?? 0 };
}

// P2: the shared-services band sits under the main diagram, groups in author order.
function placeBand(plan: Plan, geo: Geo): void {
  const sharedTop = plan.spec.items.filter((i) => plan.info.get(i.id)!.band);
  let x = 24;
  const y = geo.height + 24;
  let bandH = 0;
  for (const item of sharedTop) {
    const p = isGroup(item) ? pack(item) : { w: nodeGeom(item).w, h: nodeGeom(item).h, rel: new Map<string, Box>() };
    geo.boxes.set(item.id, { x, y, w: p.w, h: p.h });
    for (const [id, r] of p.rel) geo.boxes.set(id, { x: x + r.x, y: y + r.y, w: r.w, h: r.h });
    x += p.w + 40;
    bandH = Math.max(bandH, p.h);
  }
  if (sharedTop.length) {
    geo.height = y + bandH + 24;
    geo.width = Math.max(geo.width, x - 40 + 24);
  }
}

// P4: route the edges ELK didn't lay out around every other component and group title.
function routeAfter(plan: Plan, geo: Geo, conns: SConn[] = plan.afterEdges): void {
  const titleBoxes = [...plan.info.values()].filter((i) => i.group && geo.boxes.get(i.id)).map((i) => ({ id: i.id, box: titleBox(i.item as SGroup, geo.boxes.get(i.id)!) }));
  const leaves = [...plan.info.values()].filter((i) => !i.group && geo.boxes.get(i.id)).map((i) => ({ id: i.id, box: geo.boxes.get(i.id)! }));
  for (const conn of conns) {
    const from = geo.boxes.get(conn.from);
    const to = geo.boxes.get(conn.to);
    if (!from || !to) continue;
    const obstacles = [...leaves.filter((l) => l.id !== conn.from && l.id !== conn.to).map((l) => l.box), ...titleBoxes.filter((t) => t.id !== conn.from && t.id !== conn.to).map((t) => t.box)];
    // Facing sides from the relative position keep the search to one side pair; a capped search falls back to all sides.
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const sides = Math.abs(dx) >= Math.abs(dy) ? ([dx >= 0 ? "right" : "left", dx >= 0 ? "left" : "right"] as const) : ([dy >= 0 ? "bottom" : "top", dy >= 0 ? "top" : "bottom"] as const);
    let points = routeEdge(from, to, obstacles, { margin: 12, fromSide: sides[0], toSide: sides[1], maxExpansions: 4000 });
    if (points.length < 2) points = routeEdge(from, to, obstacles, { margin: 12, maxExpansions: 2000 });
    let label: Box | undefined;
    if (conn.label && points.length > 1) {
      const w = Math.ceil(measureText(conn.label, T.edge)) + 10;
      let best = 0;
      let mid = points[0];
      for (let i = 0; i + 1 < points.length; i++) {
        const len = Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
        if (len > best) {
          best = len;
          mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
        }
      }
      label = { x: mid.x - w / 2, y: mid.y - 8, w, h: 16 };
    }
    geo.edges.push({ conn, points, label, after: true });
  }
}

// P6: move each label to the first free spot along its own route (ELK's spot first, then beside
// every segment, longest first), clear of components, boundary titles and labels already placed.
function placeLabels(plan: Plan, geo: Geo): void {
  const leaves = [...plan.info.values()].filter((i) => !i.group).map((i) => geo.boxes.get(i.id)!).filter(Boolean);
  const titles = [...plan.info.values()].filter((i) => i.group && geo.boxes.get(i.id)).map((i) => titleBox(i.item as SGroup, geo.boxes.get(i.id)!));
  const placed: Box[] = [];
  const free = (b: Box) => !leaves.some((l) => hit(b, l, 1)) && !titles.some((t) => hit(b, t, 1)) && !placed.some((p) => hit(b, p, 1));
  for (const e of geo.edges) {
    if (!e.label || !e.conn.label) continue;
    const { w, h } = e.label;
    const options: Box[] = [e.label];
    const segs = e.points.slice(1).map((p, i) => ({ a: e.points[i], b: p, len: Math.abs(p.x - e.points[i].x) + Math.abs(p.y - e.points[i].y) })).sort((s, t) => t.len - s.len);
    for (const { a, b, len } of segs) {
      if (len < 24) continue;
      for (const t of [0.5, 0.25, 0.75]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (Math.abs(a.y - b.y) < 1) options.push({ x: x - w / 2, y: y - h / 2, w, h }, { x: x - w / 2, y: y - h - 3, w, h }, { x: x - w / 2, y: y + 3, w, h });
        else options.push({ x: x + 4, y: y - h / 2, w, h }, { x: x - w - 4, y: y - h / 2, w, h }, { x: x - w / 2, y: y - h / 2, w, h });
      }
    }
    const chosen = options.find(free) ?? e.label;
    e.label = chosen;
    placed.push(chosen);
  }
}

// ---------------------------------------------------------------- scoring

interface Score {
  overlaps: number;
  containment: number;
  through: number;
  labelHits: number;
  titleFit: number;
  aspect: number;
  crossings: number;
  loops: number;
  bends: number;
  length: number;
  overlayClean: boolean | null;
  hard: number;
  details: string[];
  cost: number;
}

const hit = (a: Box, b: Box, pad = 0) => a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;
const inside = (c: Box, p: Box) => c.x >= p.x - 1 && c.y >= p.y - 1 && c.x + c.w <= p.x + p.w + 1 && c.y + c.h <= p.y + p.h + 1;

function segHitsBox(a: Point, b: Point, box: Box): boolean {
  const s = 2;
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return x1 < box.x + box.w - s && x2 > box.x + s && y1 < box.y + box.h - s && y2 > box.y + s;
}
function segCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const shared = [a, b].some((p) => [c, d].some((q) => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1));
  if (shared) return false;
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function score(geo: Geo, groups: Map<string, { name: string; facts?: string }>, parentOf: (id: string) => string | null, isLeaf: (id: string) => boolean, overlays: Spec["overlays"]): Score {
  const ids = [...geo.boxes.keys()];
  const anc = (id: string) => {
    const out: string[] = [];
    let p = parentOf(id);
    while (p) {
      out.push(p);
      p = parentOf(p);
    }
    return out;
  };
  const details: string[] = [];
  let overlaps = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (anc(a).includes(b) || anc(b).includes(a)) continue;
      if (hit(geo.boxes.get(a)!, geo.boxes.get(b)!, 1)) {
        overlaps++;
        details.push(`overlap ${a} / ${b}`);
      }
    }
  let containment = 0;
  for (const id of ids) {
    const p = parentOf(id);
    if (p && geo.boxes.get(p) && !inside(geo.boxes.get(id)!, geo.boxes.get(p)!)) containment++;
  }
  const titles = [...groups.entries()].filter(([id]) => geo.boxes.get(id)).map(([id, g]) => ({ id, box: titleBox({ type: "group", id, name: g.name, facts: g.facts, kind: "", items: [] }, geo.boxes.get(id)!) }));
  let through = 0;
  let bends = 0;
  let length = 0;
  let loops = 0;
  for (const e of geo.edges) {
    const ends = new Set([e.conn.from, e.conn.to, ...anc(e.conn.from), ...anc(e.conn.to)]);
    bends += Math.max(0, e.points.length - 2);
    let len = 0;
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i], b = e.points[i + 1];
      len += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      for (const id of ids) {
        if (ends.has(id) || !isLeaf(id)) continue;
        if (segHitsBox(a, b, geo.boxes.get(id)!)) {
          through++;
          details.push(`edge ${e.conn.from}->${e.conn.to} through ${id}`);
        }
      }
      for (const t of titles)
        if (!ends.has(t.id) && segHitsBox(a, b, t.box)) {
          through++;
          details.push(`edge ${e.conn.from}->${e.conn.to} through title ${t.id}`);
        }
    }
    length += len;
    if (len > geo.width * 1.1) loops++;
  }
  let labelHits = 0;
  const labels = geo.edges.map((e) => e.label).filter((l): l is Box => Boolean(l));
  for (const l of labels) {
    for (const id of ids) if (isLeaf(id) && hit(l, geo.boxes.get(id)!, 1)) labelHits++;
    for (const t of titles) if (hit(l, t.box, 1)) labelHits++;
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j], 1)) labelHits++;
  let titleFit = 0;
  for (const t of titles) {
    const b = geo.boxes.get(t.id)!;
    if (t.box.x + t.box.w > b.x + b.w - 4) titleFit++;
  }
  let crossings = 0;
  for (let i = 0; i < geo.edges.length; i++)
    for (let j = i + 1; j < geo.edges.length; j++) {
      const p = geo.edges[i].points, q = geo.edges[j].points;
      for (let a = 0; a + 1 < p.length; a++) for (let b = 0; b + 1 < q.length; b++) if (segCross(p[a], p[a + 1], q[b], q[b + 1])) crossings++;
    }
  let overlayClean: boolean | null = null;
  for (const o of overlays ?? []) {
    const members = o.members.map((m) => geo.boxes.get(m)).filter((b): b is Box => Boolean(b));
    if (!members.length) continue;
    const x1 = Math.min(...members.map((b) => b.x)) - 10, y1 = Math.min(...members.map((b) => b.y)) - 10;
    const x2 = Math.max(...members.map((b) => b.x + b.w)) + 10, y2 = Math.max(...members.map((b) => b.y + b.h)) + 10;
    const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    const clean = ids.every((id) => !isLeaf(id) || o.members.includes(id) || !hit(box, geo.boxes.get(id)!, 1));
    overlayClean = (overlayClean ?? true) && clean;
  }
  const aspect = geo.width / Math.max(1, geo.height);
  const hard = overlaps + containment + through + labelHits + titleFit;
  // Distance outside [1.3, 2.0] costs more the further out: a 0.3:1 page is unusable, 2.3:1 is merely wide.
  const dev = aspect < 1.3 ? 1.3 - aspect : aspect > 2.0 ? aspect - 2.0 : 0;
  const aspectPenalty = 120 * dev + 400 * dev * dev;
  const cost = hard * 1000 + aspectPenalty + crossings * 6 + loops * 20 + bends * 0.5 + length / 1000 + (overlayClean === false ? 30 : 0);
  return { overlaps, containment, through, labelHits, titleFit, aspect, crossings, loops, bends, length, overlayClean, hard, cost, details: details.slice(0, 8) };
}

// ---------------------------------------------------------------- rendering (spike-quality)

const ICONS_DIR = path.join(process.cwd(), "public", "icons");
const iconCache = new Map<string, string | null>();
function iconHref(key?: string): string | null {
  if (!key) return null;
  if (!iconCache.has(key)) {
    try {
      iconCache.set(key, `data:image/svg+xml;base64,${readFileSync(path.join(ICONS_DIR, `${key}.svg`)).toString("base64")}`);
    } catch {
      iconCache.set(key, null);
    }
  }
  return iconCache.get(key)!;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KIND_STYLE: Record<string, { stroke: string; fill: string; dash?: string; width: number }> = {
  vnet: { stroke: "#1490DF", fill: "#F7FBFF", dash: "6 4", width: 1.5 },
  vpc: { stroke: "#8C4FFF", fill: "#FFFFFF", width: 1.5 },
  subnet: { stroke: "#A5A5A5", fill: "#F2F2F2", width: 1 },
  "public-subnet": { stroke: "#7AA116", fill: "#F2F6E8", width: 1.25 },
  "private-subnet": { stroke: "#00A4A6", fill: "#E6F6F7", width: 1.25 },
  zone: { stroke: "#E0B400", fill: "#FFFDF3", dash: "5 4", width: 1.5 },
  region: { stroke: "#0070C0", fill: "#FFFFFF", dash: "8 4", width: 1.25 },
  "aws-cloud": { stroke: "#232F3E", fill: "#FFFFFF", width: 1.25 },
  cluster: { stroke: "#326CE5", fill: "#F5F8FE", width: 1.5 },
  namespace: { stroke: "#5B6B7F", fill: "#FFFFFF", dash: "5 4", width: 1 },
  onprem: { stroke: "#7D8998", fill: "#F7F8FA", width: 1.25 },
  shared: { stroke: "#BFBFBF", fill: "#FAFAFA", width: 1 },
  subscription: { stroke: "#0078D4", fill: "#F2F8FD", width: 1.25 },
  "gcp-project": { stroke: "#4285F4", fill: "#F8FAFE", width: 1.25 },
};
function renderSpike(plan: Plan, geo: Geo, title: string): string {
  const parts: string[] = [];
  const groups = [...plan.info.values()].filter((i) => i.group).sort((a, b) => ancestorsOf(a.id, plan.info).length - ancestorsOf(b.id, plan.info).length);
  for (const g of groups) {
    const item = g.item as SGroup;
    const b = geo.boxes.get(g.id)!;
    const st = KIND_STYLE[item.kind] ?? { stroke: "#9AA0A6", fill: "#FFFFFF", width: 1 };
    parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/>`);
    parts.push(`<text x="${b.x + 12}" y="${b.y + 24}" font-family="Segoe UI, Arial" font-size="13" font-weight="600" fill="#1B1B1B">${esc(item.name)}</text>`);
    if (item.facts) parts.push(`<text x="${b.x + 12}" y="${b.y + 41}" font-family="Consolas, monospace" font-size="11" fill="#5F6368">${esc(item.facts)}</text>`);
  }
  for (const e of geo.edges) {
    const dash = e.conn.meaning === "async" || e.conn.meaning === "replication" ? ' stroke-dasharray="6 4"' : e.conn.meaning === "monitoring" || e.conn.meaning === "management" ? ' stroke-dasharray="3 3"' : e.conn.meaning === "peering" || e.conn.meaning === "vpn" ? ' stroke-dasharray="2 3"' : "";
    const color = e.conn.meaning === "monitoring" || e.conn.meaning === "management" ? "#7F7F7F" : "#1B1B1B";
    parts.push(`<polyline points="${e.points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="1.4"${dash} marker-end="url(#arrow)"/>`);
    if (e.label && e.conn.label) parts.push(`<rect x="${e.label.x}" y="${e.label.y}" width="${e.label.w}" height="${e.label.h}" rx="3" fill="#FFFFFF"/><text x="${e.label.x + e.label.w / 2}" y="${e.label.y + 12}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="#444">${esc(e.conn.label)}</text>`);
  }
  for (const n of [...plan.info.values()].filter((i) => !i.group)) {
    const item = n.item as SNode;
    const b = geo.boxes.get(n.id)!;
    const g = nodeGeom(item);
    const href = iconHref(item.icon);
    if (href) parts.push(`<image href="${href}" x="${b.x + b.w / 2 - ICON / 2}" y="${b.y + 6}" width="${ICON}" height="${ICON}"/>`);
    g.lines.forEach((line, i) => parts.push(`<text x="${b.x + b.w / 2}" y="${b.y + 6 + ICON + 8 + 13 + i * 17}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="13" fill="#1B1B1B">${esc(line)}</text>`));
    if (g.detail) parts.push(`<text x="${b.x + b.w / 2}" y="${b.y + 6 + ICON + 8 + g.lines.length * 17 + 12}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="11" fill="#5F6368">${esc(g.detail)}</text>`);
  }
  const W = Math.ceil(geo.width), H = Math.ceil(geo.height) + 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 -36 ${W} ${H}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1B1B1B"/></marker></defs><rect x="0" y="-36" width="${W}" height="${H}" fill="#fff"/><text x="24" y="-12" font-family="Segoe UI, Arial" font-size="16" font-weight="600">${esc(title)}</text>${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------- D2 baseline

function toD2(spec: Spec, info: Map<string, Info>, hidden: SConn[]): string {
  const q = (s: string) => JSON.stringify(s);
  const path = (id: string) => [...ancestorsOf(id, info).reverse(), id].map(q).join(".");
  const lines: string[] = ["direction: right"];
  const walk = (items: SItem[], indent: string) => {
    for (const item of items) {
      if (isGroup(item)) {
        lines.push(`${indent}${q(item.id)}: ${q(item.facts ? `${item.name}\n${item.facts}` : item.name)} {`);
        walk(item.items, indent + "  ");
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}${q(item.id)}: ${q(item.detail ? `${item.name}\n${item.detail}` : item.name)}`);
      }
    }
  };
  walk(spec.items, "");
  for (const c of spec.connections) {
    if (hidden.includes(c)) continue;
    lines.push(`${path(c.from)} -> ${path(c.to)}${c.label ? `: ${q(c.label)}` : ""}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- perturbations (reserved)

function reversedOrder(spec: Spec): Spec {
  const rev = (items: SItem[]): SItem[] => [...items].reverse().map((i) => (isGroup(i) ? { ...i, items: rev(i.items) } : i));
  return { ...spec, title: `${spec.title} (reordered)`, items: rev(spec.items), connections: [...spec.connections].reverse() };
}
function deeperWithCycle(spec: Spec): Spec {
  const top = spec.items;
  const groups = top.filter((i) => isGroup(i) && i.kind !== "shared" && i.kind !== "onprem");
  const [first, ...rest] = groups;
  const others = top.filter((i) => !groups.includes(i));
  const region: SGroup = { type: "group", id: "p-region", name: "Primary region", kind: "region", items: [first, { type: "group", id: "p-landing", name: "Landing zone", kind: "group", items: rest }] };
  const leafIds = rest.flatMap(function leaves(i: SItem): string[] { return isGroup(i) ? i.items.flatMap(leaves) : [i.id]; });
  const firstLeaf = (function leaves(i: SItem): string[] { return isGroup(i) ? i.items.flatMap(leaves) : [i.id]; })(first)[0];
  const extra: SConn[] = leafIds.length && firstLeaf ? [{ from: leafIds[leafIds.length - 1], to: firstLeaf, meaning: "request", label: "Return path" }] : [];
  return { ...spec, title: `${spec.title} (deeper + cycle)`, items: [...others.filter((i) => !isGroup(i) || i.kind === "onprem"), region, ...others.filter((i) => isGroup(i) && i.kind === "shared")], connections: [...spec.connections, ...extra] };
}

// ---------------------------------------------------------------- H: arranged top-level blocks

/**
 * Hybrid candidates: each top-level block is laid out on its own (ELK inside groups, only the
 * connectors inside it), then the blocks are placed by ELK over the block graph, then the
 * connectors between blocks are routed. Added as candidates; scoring decides.
 */
const HYBRID = [
  { id: "blocks-right", inner: "RIGHT", outer: { "elk.direction": "RIGHT" } },
  { id: "blocks-wrap", inner: "RIGHT", outer: { "elk.direction": "RIGHT", "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" } },
  { id: "blocks-down", inner: "RIGHT", outer: { "elk.direction": "DOWN" } },
  { id: "blocks-inner-down", inner: "DOWN", outer: { "elk.direction": "RIGHT", "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" } },
] as const;

async function hybridLayout(plan: Plan, elk: InstanceType<typeof ELK>, variant: (typeof HYBRID)[number]): Promise<Geo | null> {
  const blocks = plan.spec.items.filter((i) => !plan.info.get(i.id)!.band);
  if (blocks.length < 3) return null;
  const within = (id: string, root: string) => id === root || ancestorsOf(id, plan.info).includes(root);
  const blockOf = (id: string) => blocks.find((b) => within(id, b.id))?.id;
  const inner = new Map<string, Geo>();
  for (const b of blocks) {
    const internal = plan.elkEdges.filter((c) => blockOf(c.from) === b.id && blockOf(c.to) === b.id);
    const options = { ...BASE, ...ORDERED, "elk.direction": variant.inner, "elk.padding": "[top=0,left=0,bottom=0,right=0]" };
    let out: ElkNode;
    try {
      out = await elk.layout({ id: "root", layoutOptions: options, children: [elkNodeFor(plan, b)], edges: elkEdgesFor(internal) });
    } catch {
      out = await elk.layout({ id: "root", layoutOptions: { ...BASE, "elk.direction": variant.inner, "elk.padding": "[top=0,left=0,bottom=0,right=0]" }, children: [elkNodeFor(plan, b)], edges: elkEdgesFor(internal) });
    }
    const geo = extract(plan, out, internal);
    const origin = geo.boxes.get(b.id)!;
    const shift = (p: Point) => ({ x: p.x - origin.x, y: p.y - origin.y });
    inner.set(b.id, {
      boxes: new Map([...geo.boxes].map(([id, box]) => [id, { ...box, ...shift(box) }])),
      edges: geo.edges.map((e) => ({ ...e, points: e.points.map(shift), label: e.label ? { ...e.label, ...shift(e.label) } : undefined })),
      width: origin.w,
      height: origin.h,
    });
  }
  const pairs = new Map<string, number>();
  for (const c of [...plan.elkEdges, ...plan.afterEdges]) {
    const a = blockOf(c.from), b = blockOf(c.to);
    if (!a || !b || a === b) continue;
    pairs.set(`${a}\u0000${b}`, (pairs.get(`${a}\u0000${b}`) ?? 0) + 1);
  }
  const outerOptions: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "56",
    "elk.layered.spacing.nodeNodeBetweenLayers": "96",
    "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    ...ORDERED,
    ...variant.outer,
  };
  const placed: ElkNode = await elk.layout({
    id: "root",
    layoutOptions: outerOptions,
    children: blocks.map((b) => ({ id: b.id, width: inner.get(b.id)!.width, height: inner.get(b.id)!.height })),
    edges: [...pairs.keys()].map((k, i) => ({ id: `b${i}`, sources: [k.split("\u0000")[0]], targets: [k.split("\u0000")[1]] })),
  } as ElkNode);
  const geo: Geo = { boxes: new Map(), edges: [], width: placed.width ?? 0, height: placed.height ?? 0 };
  for (const child of placed.children ?? []) {
    const g = inner.get(child.id)!;
    const dx = child.x ?? 0, dy = child.y ?? 0;
    for (const [id, box] of g.boxes) geo.boxes.set(id, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
    for (const e of g.edges) geo.edges.push({ ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), label: e.label ? { ...e.label, x: e.label.x + dx, y: e.label.y + dy } : undefined });
  }
  placeBand(plan, geo);
  routeAfter(plan, geo, [...plan.elkEdges.filter((c) => blockOf(c.from) !== blockOf(c.to)), ...plan.afterEdges]);
  return geo;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(process.cwd(), ".spike-out");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
  const reserved = args.includes("--reserved");
  const noD2 = args.includes("--no-d2");
  mkdirSync(outDir, { recursive: true });
  const dir = path.join(process.cwd(), "scripts", "spikes", "topologies");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  let cases: Array<{ name: string; spec: Spec }> = files.map((f) => ({ name: f.replace(/\.json$/, ""), spec: JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Spec }));
  if (reserved) {
    const byPrefix = (p: string) => cases.find((c) => c.name.startsWith(p))!;
    cases = [
      { name: "R1-reordered-" + byPrefix("02").name, spec: reversedOrder(byPrefix("02").spec) },
      { name: "R2-deeper-cycle-" + byPrefix("05").name, spec: deeperWithCycle(byPrefix("05").spec) },
    ];
  }
  if (only) cases = cases.filter((c) => c.name.startsWith(only));
  const elk = new ELK();
  const results: unknown[] = [];
  for (const { name, spec } of cases) {
    const plan = planSpec(spec);
    const groups = new Map([...plan.info.values()].filter((i) => i.group).map((i) => [i.id, { name: (i.item as SGroup).name, facts: (i.item as SGroup).facts }]));
    const parentOf = (id: string) => plan.info.get(id)?.parent ?? null;
    const isLeaf = (id: string) => !plan.info.get(id)?.group;
    const tried: Array<{ id: string; ms: number; elkMs?: number; routeMs?: number; error?: string; score?: Score; geo?: Geo }> = [];
    for (const cand of CANDIDATES) {
      const options = optionsFor(cand, true);
      const t0 = performance.now();
      try {
        let out: ElkNode;
        try {
          out = await elk.layout(buildElk(plan, options));
        } catch (err) {
          // Fallback: the same candidate without the model-order options.
          out = await elk.layout(buildElk(plan, optionsFor(cand, false)));
          tried.push({ id: `${cand.id}(primary)`, ms: 0, error: err instanceof Error ? err.message : String(err) });
        }
        const elkMs = performance.now() - t0;
        const geo = extract(plan, out);
        placeBand(plan, geo);
        const r0 = performance.now();
        routeAfter(plan, geo);
        placeLabels(plan, geo);
        const routeMs = performance.now() - r0;
        tried.push({ id: cand.id, ms: performance.now() - t0, elkMs, routeMs, score: score(geo, groups, parentOf, isLeaf, spec.overlays), geo });
      } catch (err) {
        tried.push({ id: cand.id, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    for (const variant of HYBRID) {
      const t0 = performance.now();
      try {
        const geo = await hybridLayout(plan, elk, variant);
        if (!geo) continue;
        placeLabels(plan, geo);
        tried.push({ id: variant.id, ms: performance.now() - t0, score: score(geo, groups, parentOf, isLeaf, spec.overlays), geo });
      } catch (err) {
        tried.push({ id: variant.id, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const ok = tried.filter((t) => t.score && t.geo);
    ok.sort((a, b) => a.score!.cost - b.score!.cost || a.id.localeCompare(b.id));
    const best = ok[0];
    const totalMs = tried.reduce((s, t) => s + t.ms, 0);
    if (best) {
      const svg = renderSpike(plan, best.geo!, `${spec.title} — ${best.id}`);
      writeFileSync(path.join(outDir, `${name}.svg`), svg);
      writeFileSync(path.join(outDir, `${name}.png`), await svgToPng(svg, { density: 110, maxWidth: 2400, maxHeight: 2400 }));
    }
    // D2 baseline on the same topology and connector set.
    let d2: { ms: number; score?: Score; error?: string } = { ms: 0 };
    if (!noD2) {
      const t0 = performance.now();
      try {
        const code = toD2(spec, plan.info, plan.hidden);
        writeFileSync(path.join(outDir, `${name}.d2`), code);
        const { model } = await modelFromD2Code(code);
        const boxes = new Map(model.nodes.map((n) => [n.id.split(".").at(-1)!.replace(/^"|"$/g, ""), n.box]));
        const parentByLeafId = new Map(model.nodes.map((n) => [n.id.split(".").at(-1)!.replace(/^"|"$/g, ""), n.parent ? n.parent.split(".").at(-1)!.replace(/^"|"$/g, "") : null]));
        const containerIds = new Set(model.nodes.filter((n) => n.container).map((n) => n.id.split(".").at(-1)!.replace(/^"|"$/g, "")));
        const edges: Geo["edges"] = model.edges.map((e) => {
          const from = e.from.split(".").at(-1)!.replace(/^"|"$/g, "");
          const to = e.to.split(".").at(-1)!.replace(/^"|"$/g, "");
          const conn = spec.connections.find((c) => c.from === from && c.to === to) ?? { from, to };
          let label: Box | undefined;
          if (e.label && e.route.length > 1) {
            const w = Math.ceil(measureText(e.label, T.edge)) + 10;
            const total = e.route.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - e.route[i].x, p.y - e.route[i].y), 0);
            let acc = 0;
            let mid = e.route[0];
            for (let i = 0; i + 1 < e.route.length; i++) {
              const seg = Math.hypot(e.route[i + 1].x - e.route[i].x, e.route[i + 1].y - e.route[i].y);
              if (acc + seg >= total / 2) {
                const t = seg ? (total / 2 - acc) / seg : 0;
                mid = { x: e.route[i].x + (e.route[i + 1].x - e.route[i].x) * t, y: e.route[i].y + (e.route[i + 1].y - e.route[i].y) * t };
                break;
              }
              acc += seg;
            }
            label = { x: mid.x - w / 2, y: mid.y - 8, w, h: 16 };
          }
          return { conn, points: e.route, label, after: false };
        });
        const xs = model.nodes.flatMap((n) => [n.box.x, n.box.x + n.box.w]);
        const ys = model.nodes.flatMap((n) => [n.box.y, n.box.y + n.box.h]);
        const geo: Geo = { boxes, edges, width: Math.max(...xs) - Math.min(0, ...xs), height: Math.max(...ys) - Math.min(0, ...ys) };
        // D2 sizes containers to their own labels; its title placement differs, so title checks don't apply.
        const d2Groups = new Map<string, { name: string; facts?: string }>();
        const s = score(geo, d2Groups, (id) => parentByLeafId.get(id) ?? null, (id) => !containerIds.has(id), spec.overlays);
        d2 = { ms: performance.now() - t0, score: s };
        const svg = renderModelSvg(model);
        writeFileSync(path.join(outDir, `${name}.d2.png`), await svgToPng(svg, { density: 110, maxWidth: 2400, maxHeight: 2400 }));
      } catch (err) {
        d2 = { ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
      }
    }
    const row = {
      name,
      best: best?.id ?? null,
      elkMs: Math.round(totalMs),
      candidates: tried.map((t) => ({ id: t.id, ms: Math.round(t.ms), elkMs: t.elkMs ? Math.round(t.elkMs) : undefined, routeMs: t.routeMs ? Math.round(t.routeMs) : undefined, error: t.error, cost: t.score ? Math.round(t.score.cost) : null, hard: t.score?.hard, aspect: t.score ? +t.score.aspect.toFixed(2) : null, crossings: t.score?.crossings })),
      score: best?.score ? { ...best.score, aspect: +best.score.aspect.toFixed(2), length: Math.round(best.score.length), cost: Math.round(best.score.cost) } : null,
      routedAfter: plan.afterEdges.length,
      hidden: plan.hidden.length,
      packed: [...plan.packed.keys()],
      d2: d2.score ? { ms: Math.round(d2.ms), ...d2.score, aspect: +d2.score.aspect.toFixed(2), length: Math.round(d2.score.length), cost: Math.round(d2.score.cost) } : d2,
    };
    results.push(row);
    const s = best?.score;
    if (s && s.hard > 0) for (const d of s.details) console.log(`    · ${d}`);
    console.log(
      `${name.padEnd(44)} best=${String(best?.id).padEnd(9)} hard=${s?.hard} (ov ${s?.overlaps}, cont ${s?.containment}, thru ${s?.through}, lbl ${s?.labelHits}, title ${s?.titleFit}) aspect=${s?.aspect.toFixed(2)} cross=${s?.crossings} loops=${s?.loops} overlay=${s?.overlayClean} ms=${Math.round(totalMs)} [elk ${tried.map((t) => Math.round(t.elkMs ?? 0)).join("/")} route ${tried.map((t) => Math.round(t.routeMs ?? 0)).join("/")}]` +
        (d2.score ? ` | D2 hard=${d2.score.hard} (ov ${d2.score.overlaps}, thru ${d2.score.through}, lbl ${d2.score.labelHits}) aspect=${d2.score.aspect.toFixed(2)} cross=${d2.score.crossings} loops=${d2.score.loops}` : d2.error ? ` | D2 error: ${d2.error}` : ""),
    );
  }
  writeFileSync(path.join(outDir, reserved ? "results-reserved.json" : "results.json"), JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0)) // the D2 WASM worker would otherwise keep Node alive
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
