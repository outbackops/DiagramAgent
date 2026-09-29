import type { ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import { measureText } from "@/lib/compose/text";
import { edgeId } from "@/lib/model/query";
import { routeEdgeAvoiding } from "@/lib/model/route";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, EdgeBadge, Point } from "@/lib/model/types";
import { BASE_OPTIONS, FLAT_CANDIDATES, HYBRID_CANDIDATES, LARGE_CANDIDATE_IDS, ORDERED_OPTIONS, loadElk, runElk, type ElkLike, type FlatCandidate, type HybridCandidate } from "./elk";
import { boundaryMinWidth, componentGeom, headerHeight, pack, titleBox, type Packed } from "./measure";
import { overlayBox } from "./overlays";
import { pageSections, titleBlock, type PageSections } from "./page";
import { allItems, isBoundary, type NBoundary, type NConnection, type NItem, type NOverlay, type NormalizedArchSpec } from "./spec";
import { ARCH_SPACE as S, ARCH_TYPE as T } from "./theme";

/**
 * The Architecture layout engine: a normalised spec in, an editable DiagramModel out.
 * ELK's layered compound layout (plus a hybrid that arranges top-level blocks) proposes
 * candidates; generic polish passes and a score pick the one a designer would draw. Large
 * diagrams try fewer candidates to stay near the two-second budget. The approach, its passes
 * (P1–P8), their evidence and the performance gate: docs/spikes/2026-09-29-architecture-layout-spike.md.
 */

export interface ArchLayoutOptions {
  /** Injected ELK (tests); otherwise loaded on first use. */
  elk?: ElkLike;
  /** Streaming preview: one candidate, no search. */
  quick?: boolean;
}

export interface ArchCandidateReport {
  id: string;
  cost?: number;
  /** After routing, labels and badges (finalists only). */
  finalCost?: number;
  finalCrossings?: number;
  hard?: number;
  aspect?: number;
  crossings?: number;
  error?: string;
  /** ELK time, and the finishing passes' time for finalists. */
  elkMs?: number;
  finishMs?: number;
}

export interface ArchLayoutReport {
  candidate: string;
  width: number;
  height: number;
  aspectRatio: number;
  crossings: number;
  loops: number;
  backward: number;
  hardViolations: number;
  tried: ArchCandidateReport[];
  /** The layout that doesn't use ELK was used (ELK failed to load or threw on every candidate). */
  fallback: boolean;
  warnings: string[];
  ms: number;
}

export interface ArchLayoutResult {
  model: DiagramModel;
  report: ArchLayoutReport;
}

/** Above 60% of the v1 envelope (ARCH_LIMITS), fewer candidates are laid out and finished. */
const LARGE_DIAGRAM = { components: 36, connections: 48 };

export async function layoutArchitecture(spec: NormalizedArchSpec, options: ArchLayoutOptions = {}): Promise<ArchLayoutResult> {
  const started = performance.now();
  const plan = planSpec(spec);
  const large = allItems(spec.items).filter((item) => !isBoundary(item)).length > LARGE_DIAGRAM.components || spec.connections.length > LARGE_DIAGRAM.connections;
  const tryCandidate = (id: string) => !large || LARGE_CANDIDATE_IDS.has(id);
  const warnings: string[] = [];
  const tried: ArchCandidateReport[] = [];
  let elk: ElkLike | null = options.elk ?? null;
  if (!elk) {
    try {
      elk = await loadElk();
    } catch (err) {
      warnings.push(`The layout engine didn't load (${message(err)}); used a simple arrangement`);
    }
  }

  const candidates: Array<Candidate & { elkMs: number }> = [];
  if (elk) {
    const flat = options.quick ? FLAT_CANDIDATES.slice(0, 1) : FLAT_CANDIDATES.filter((c) => tryCandidate(c.id));
    for (const candidate of flat) {
      const t = performance.now();
      try {
        candidates.push({ id: candidate.id, geo: await flatLayout(plan, elk, candidate), elkMs: Math.round(performance.now() - t) });
      } catch (err) {
        tried.push({ id: candidate.id, error: message(err) });
      }
    }
    if (!options.quick && plan.blocks.length >= 3) {
      for (const candidate of HYBRID_CANDIDATES.filter((c) => tryCandidate(c.id))) {
        const t = performance.now();
        try {
          candidates.push({ id: candidate.id, geo: await hybridLayout(plan, elk, candidate), elkMs: Math.round(performance.now() - t) });
        } catch (err) {
          tried.push({ id: candidate.id, error: message(err) });
        }
      }
    }
  }

  let chosen: { id: string; geo: Geo; score: Score } | null = null;
  if (candidates.length > 0) {
    // Score on ELK geometry, then finish (route, labels, badges) only the most promising few.
    const ranked = candidates.map((c) => ({ ...c, score: scoreGeo(plan, c.geo, false) })).sort((a, b) => a.score.cost - b.score.cost || a.id.localeCompare(b.id));
    for (const c of ranked) tried.push({ id: c.id, cost: round(c.score.cost), hard: c.score.hard, aspect: round2(c.score.aspect), crossings: c.score.crossings, elkMs: c.elkMs });
    for (const c of ranked.slice(0, options.quick ? 1 : large ? 3 : 4)) {
      const t = performance.now();
      finish(plan, c.geo, c.geo.afterEdges);
      const final = scoreGeo(plan, c.geo, true);
      const entry = tried.find((t) => t.id === c.id && t.cost !== undefined);
      if (entry) {
        entry.finalCost = round(final.cost);
        entry.finalCrossings = final.crossings;
        entry.finishMs = Math.round(performance.now() - t);
      }
      if (!chosen || final.cost < chosen.score.cost || (final.cost === chosen.score.cost && c.id.localeCompare(chosen.id) < 0)) chosen = { id: c.id, geo: c.geo, score: final };
    }
  }
  let fallback = false;
  if (!chosen) {
    fallback = true;
    if (elk) warnings.push("Every layout attempt failed; used a simple arrangement");
    const geo = packedLayout(plan);
    finish(plan, geo, geo.afterEdges);
    chosen = { id: "packed", geo, score: scoreGeo(plan, geo, true) };
  }

  const model = emitModel(plan, chosen.geo, warnings);
  // Best effort is allowed only with a visible warning (origin R14).
  if (chosen.score.hard > 0) warnings.push(`${chosen.score.hard} overlap${chosen.score.hard === 1 ? "" : "s"} remained in the densest part of the diagram; fewer connectors or labels would help`);
  const bounds = modelBounds(model);
  return {
    model,
    report: {
      candidate: chosen.id,
      width: Math.round(bounds.w),
      height: Math.round(bounds.h),
      aspectRatio: round2(bounds.w / Math.max(1, bounds.h)),
      crossings: chosen.score.crossings,
      loops: chosen.score.loops,
      backward: chosen.score.backward,
      hardViolations: chosen.score.hard,
      tried,
      fallback,
      warnings,
      ms: Math.round(performance.now() - started),
    },
  };
}

// ---------------------------------------------------------------- plan (polish passes P1–P5)

interface Info {
  item: NItem;
  parent: string | null;
  order: number;
  /** Inside any shared-services boundary. */
  shared: boolean;
  /** Inside a top-level shared-services boundary: laid out in the band under the diagram. */
  band: boolean;
  path: string;
}

interface Plan {
  spec: NormalizedArchSpec;
  info: Map<string, Info>;
  /** Subtrees no connector touches, packed as blocks (P1). */
  packed: Map<string, Packed>;
  /** Connectors ELK lays out. */
  elkEdges: NConnection[];
  /** Connectors routed after the layout (P2–P5). */
  afterEdges: NConnection[];
  /** Links implied by the shared-services band (P2): kept in the model, not drawn. */
  hidden: Set<NConnection>;
  /** Top-level items outside the band. */
  blocks: NItem[];
  ancestors: (id: string) => string[];
  within: (id: string, root: string) => boolean;
}

function planSpec(spec: NormalizedArchSpec): Plan {
  const info = new Map<string, Info>();
  let order = 0;
  const walk = (items: NItem[], parent: Info | null, shared: boolean, band: boolean) => {
    for (const item of items) {
      const isShared = shared || (isBoundary(item) && item.kind === "shared");
      const inBand = band || (parent === null && isBoundary(item) && item.kind === "shared");
      const entry: Info = { item, parent: parent ? (parent.item.id) : null, order: order++, shared: isShared, band: inBand, path: parent ? `${parent.path}.${item.id}` : item.id };
      info.set(item.id, entry);
      if (isBoundary(item)) walk(item.items, entry, isShared, inBand);
    }
  };
  walk(spec.items, null, false, false);
  const ancestorCache = new Map<string, string[]>();
  const ancestors = (id: string): string[] => {
    const hit = ancestorCache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    for (let p = info.get(id)?.parent ?? null; p; p = info.get(p)?.parent ?? null) out.push(p);
    ancestorCache.set(id, out);
    return out;
  };
  const within = (id: string, root: string) => id === root || ancestors(id).includes(root);

  // P1: a boundary whose descendants no connector touches is one packed block.
  const touched = new Set(spec.connections.flatMap((c) => [c.from, c.to]));
  const packed = new Map<string, Packed>();
  const hasTouched = (item: NItem): boolean => isBoundary(item) && item.items.some((c) => touched.has(c.id) || hasTouched(c));
  const findPackable = (items: NItem[]) => {
    for (const item of items) {
      if (!isBoundary(item)) continue;
      if (!hasTouched(item)) packed.set(item.id, pack(item));
      else findPackable(item.items);
    }
  };
  findPackable(spec.items);

  // P2: unlabelled monitoring and management links into shared services are implied by the band;
  // other unlabelled links into one shared service are hidden once three or more components use it.
  // A labelled link or one carrying a workflow step was drawn on purpose and always stays, and so
  // does the first link of each shared service, so no shared service ever looks disconnected.
  const intoShared = new Map<string, number>();
  for (const c of spec.connections) if (info.get(c.to)?.shared && !info.get(c.from)?.shared) intoShared.set(c.to, (intoShared.get(c.to) ?? 0) + 1);
  const hidden = new Set<NConnection>();
  const linkedShared = new Set<string>();
  const afterEdges: NConnection[] = [];
  const main: NConnection[] = [];
  for (const c of spec.connections) {
    const a = info.get(c.from)!;
    const b = info.get(c.to)!;
    const implied = (c.meaning === "monitoring" || c.meaning === "management") && (a.shared || b.shared);
    const crowded = b.shared && !a.shared && (intoShared.get(c.to) ?? 0) >= 3;
    const sharedEnd = b.shared ? c.to : a.shared ? c.from : null;
    const keep = Boolean(c.step) || Boolean(c.label) || (sharedEnd !== null && !linkedShared.has(sharedEnd));
    if ((implied || crowded) && !keep) {
      hidden.add(c);
      continue;
    }
    if (sharedEnd) linkedShared.add(sharedEnd);
    // P3: links to a node's own ancestor, and links into the band, are routed after layout.
    if (a.band || b.band || ancestors(c.to).includes(c.from) || ancestors(c.from).includes(c.to)) {
      afterEdges.push(c);
      continue;
    }
    main.push(c);
  }

  // P5: sibling boundaries of one kind fed by a common outside source are parallel lanes
  // (zones, spokes, regions): links between them don't decide the layout.
  const feeders = new Map<string, Set<string>>();
  for (const [id, entry] of info) {
    if (!isBoundary(entry.item)) continue;
    const s = new Set<string>();
    for (const c of main) if (within(c.to, id) && !within(c.from, id)) s.add(c.from);
    feeders.set(id, s);
  }
  const blockOf = (id: string, parent: string | null) => {
    const chain = [id, ...ancestors(id)];
    const at = parent === null ? chain.length - 1 : chain.indexOf(parent) - 1;
    return at >= 0 ? chain[at] : undefined;
  };
  const betweenPeers = (c: NConnection): boolean => {
    const up = ancestors(c.to);
    const common = ancestors(c.from).find((a) => up.includes(a)) ?? null;
    const a = blockOf(c.from, common);
    const b = blockOf(c.to, common);
    if (!a || !b || a === b) return false;
    const ia = info.get(a)!.item;
    const ib = info.get(b)!.item;
    if (!isBoundary(ia) || !isBoundary(ib) || ia.kind !== ib.kind) return false;
    const fb = feeders.get(b)!;
    return [...feeders.get(a)!].some((f) => fb.has(f) && !within(f, a) && !within(f, b));
  };
  const flow = main.filter((c) => !betweenPeers(c));
  afterEdges.push(...main.filter((c) => betweenPeers(c)));

  // P3: a back-edge (its target earlier in author order, closing a cycle) is routed after layout.
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
  const elkEdges: NConnection[] = [];
  for (const c of flow) {
    const back = info.get(c.to)!.order < info.get(c.from)!.order && reaches(c.to, c.from);
    (back ? afterEdges : elkEdges).push(c);
  }
  const blocks = spec.items.filter((i) => !info.get(i.id)!.band);
  return { spec, info, packed, elkEdges, afterEdges, hidden, blocks, ancestors, within };
}

// ---------------------------------------------------------------- ELK candidates

interface GeoEdge {
  conn: NConnection;
  points: Point[];
  label?: Box;
  badge?: Point;
}

interface Geo {
  boxes: Map<string, Box>;
  edges: GeoEdge[];
  width: number;
  height: number;
  /** Connectors this candidate routes after layout. */
  afterEdges: NConnection[];
}

interface Candidate {
  id: string;
  geo: Geo;
}

function elkNode(plan: Plan, item: NItem): ElkNode {
  const packed = plan.packed.get(item.id);
  if (packed) return { id: item.id, width: packed.w, height: packed.h };
  if (!isBoundary(item)) {
    const g = componentGeom(item);
    return { id: item.id, width: g.w, height: g.h };
  }
  const top = headerHeight(item);
  return {
    id: item.id,
    layoutOptions: {
      "elk.padding": `[top=${top},left=${S.groupPad},bottom=${S.groupPad},right=${S.groupPad}]`,
      "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
      "elk.nodeSize.minimum": `(${boundaryMinWidth(item)}, ${top + S.groupPad})`,
    },
    children: item.items.filter((c) => !plan.info.get(c.id)!.band).map((c) => elkNode(plan, c)),
  };
}

function elkEdges(conns: NConnection[]): ElkExtendedEdge[] {
  return conns.map((c, i) => ({
    id: `e${i}`,
    sources: [c.from],
    targets: [c.to],
    labels: c.label ? [{ text: c.label, width: labelWidth(c.label), height: S.edgeLabelHeight }] : [],
  }));
}

async function layoutWithFallback(elk: ElkLike, graph: ElkNode, ordered: boolean): Promise<ElkNode> {
  try {
    return await runElk(elk, graph);
  } catch (err) {
    if (!ordered) throw err;
    // Author-order options occasionally throw inside ELK; the same graph without them is the fallback.
    const options = Object.fromEntries(Object.entries(graph.layoutOptions ?? {}).filter(([key]) => !(key in ORDERED_OPTIONS)));
    return runElk(elk, { ...graph, layoutOptions: options });
  }
}

async function flatLayout(plan: Plan, elk: ElkLike, candidate: FlatCandidate): Promise<Geo> {
  const options: LayoutOptions = { ...BASE_OPTIONS, ...(candidate.ordered ? ORDERED_OPTIONS : {}), ...candidate.options };
  const graph: ElkNode = { id: "root", layoutOptions: options, children: plan.blocks.map((i) => elkNode(plan, i)), edges: elkEdges(plan.elkEdges) };
  const out = await layoutWithFallback(elk, graph, candidate.ordered);
  const geo = extract(plan, out, plan.elkEdges);
  geo.afterEdges = [...plan.afterEdges];
  orderLanes(plan, geo);
  straighten(plan, geo);
  placeBand(plan, geo);
  return geo;
}

/**
 * P8: a connector between two components that are almost level gets straightened: the
 * component with fewer connections moves (≤ 24 px) to line up, when nothing else is in the way
 * and it stays inside its boundary. Its connectors are re-routed after layout.
 */
function straighten(plan: Plan, geo: Geo): void {
  const degree = new Map<string, number>();
  for (const c of plan.spec.connections) if (!plan.hidden.has(c)) for (const id of [c.from, c.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const inPacked = (id: string) => [...plan.packed.keys()].some((p) => p !== id && plan.within(id, p));
  const moved = new Set<string>();
  // Terminal pairs first (one end has a single connection, e.g. private endpoint → service).
  const terminal = (e: GeoEdge) => Math.min(degree.get(e.conn.from) ?? 0, degree.get(e.conn.to) ?? 0) === 1;
  const ordered = [...geo.edges].sort((x, y) => Number(terminal(y)) - Number(terminal(x)));
  for (const e of ordered) {
    const { from, to } = e.conn;
    if (isBoundary(plan.info.get(from)!.item) || isBoundary(plan.info.get(to)!.item)) continue;
    const a = geo.boxes.get(from);
    const b = geo.boxes.get(to);
    if (!a || !b) continue;
    const horizontal = Math.abs(b.x + b.w / 2 - (a.x + a.w / 2)) >= Math.abs(b.y + b.h / 2 - (a.y + a.h / 2));
    const delta = horizontal ? a.y + a.h / 2 - (b.y + b.h / 2) : a.x + a.w / 2 - (b.x + b.w / 2);
    if (Math.abs(delta) < 0.5) {
      // Already straight: keep it so, whichever other connector wants to move these ends.
      moved.add(from);
      moved.add(to);
      continue;
    }
    if (Math.abs(delta) > 24) continue;
    if (moved.has(from) || moved.has(to)) continue;
    // Prefer moving the end with fewer connections; if it's boxed in, try the other end.
    const preferTo = (degree.get(to) ?? 0) <= (degree.get(from) ?? 0);
    const attempts: Array<[string, number]> = preferTo ? [[to, delta], [from, -delta]] : [[from, -delta], [to, delta]];
    const fits = (mover: string, shift: number): Box | null => {
      if (inPacked(mover)) return null;
      const box = geo.boxes.get(mover)!;
      const next = horizontal ? { ...box, y: box.y + shift } : { ...box, x: box.x + shift };
      const parent = plan.info.get(mover)!.parent;
      if (parent) {
        const p = geo.boxes.get(parent)!;
        const top = p.y + headerHeight(plan.info.get(parent)!.item as NBoundary);
        if (next.x < p.x + 4 || next.x + next.w > p.x + p.w - 4 || next.y < top || next.y + next.h > p.y + p.h - 4) return null;
      }
      const clear = [...geo.boxes].every(([id, other]) => id === mover || plan.within(mover, id) || !overlaps(next, other, -8));
      return clear ? next : null;
    };
    const attempt = attempts.map(([mover, shift]) => ({ mover, next: fits(mover, shift) })).find((a) => a.next);
    if (!attempt) continue;
    const { mover } = attempt;
    geo.boxes.set(mover, attempt.next!);
    moved.add(from);
    moved.add(to);
    const keep: GeoEdge[] = [];
    for (const edge of geo.edges) {
      if (edge.conn.from === mover || edge.conn.to === mover) geo.afterEdges.push(edge.conn);
      else keep.push(edge);
    }
    geo.edges = keep;
  }
}

/**
 * P7: parallel lanes follow author order. When ELK stacks sibling boundaries of one kind
 * (zones, regions, spokes) against the order they were listed, the lanes swap slots — only
 * when nothing else sits in their span. Connectors into a moved lane are re-routed after layout.
 */
function orderLanes(plan: Plan, geo: Geo): void {
  const groups: NItem[][] = [plan.blocks];
  for (const [id, entry] of plan.info) if (isBoundary(entry.item) && !plan.packed.has(id)) groups.push(entry.item.items);
  for (const items of groups) {
    const byKind = new Map<string, NBoundary[]>();
    for (const item of items) if (isBoundary(item) && geo.boxes.get(item.id)) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    for (const lanes of byKind.values()) {
      if (lanes.length < 2) continue;
      const boxOf = (l: NBoundary) => geo.boxes.get(l.id)!;
      const axis = stackAxis(lanes.map(boxOf));
      if (!axis) continue;
      const current = [...lanes].sort((a, b) => boxOf(a)[axis] - boxOf(b)[axis]);
      const author = [...lanes].sort((a, b) => plan.info.get(a.id)!.order - plan.info.get(b.id)!.order);
      if (current.every((l, i) => l.id === author[i].id)) continue;
      const size = (b: Box) => (axis === "y" ? b.h : b.w);
      const span = { from: boxOf(current[0])[axis], to: boxOf(current[current.length - 1])[axis] + size(boxOf(current[current.length - 1])) };
      const region = union(lanes.map(boxOf));
      const others = items.filter((i) => !lanes.includes(i as NBoundary) && geo.boxes.get(i.id) && overlaps(geo.boxes.get(i.id)!, region, 0));
      if (others.length > 0) continue;
      const gap = current.length > 1 ? (span.to - span.from - current.reduce((s, l) => s + size(boxOf(l)), 0)) / (current.length - 1) : 0;
      let cursor = span.from;
      const moved = new Map<string, number>();
      for (const lane of author) {
        const box = boxOf(lane);
        moved.set(lane.id, cursor - box[axis]);
        cursor += size(box) + gap;
      }
      for (const [id, delta] of moved) if (delta !== 0) shiftSubtree(plan, geo, id, axis === "x" ? delta : 0, axis === "y" ? delta : 0);
    }
  }
}

/** "y" when boxes are stacked top to bottom in one column, "x" when side by side in one row. */
function stackAxis(boxes: Box[]): "x" | "y" | null {
  const pairs = boxes.flatMap((a, i) => boxes.slice(i + 1).map((b) => [a, b] as const));
  const overlapRatio = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, Math.min(a1 - a0, b1 - b0));
  if (pairs.every(([a, b]) => overlapRatio(a.x, a.x + a.w, b.x, b.x + b.w) > 0.5 && overlapRatio(a.y, a.y + a.h, b.y, b.y + b.h) === 0)) return "y";
  if (pairs.every(([a, b]) => overlapRatio(a.y, a.y + a.h, b.y, b.y + b.h) > 0.5 && overlapRatio(a.x, a.x + a.w, b.x, b.x + b.w) === 0)) return "x";
  return null;
}

/** Moves a boundary's subtree; connectors crossing its border are re-routed later. */
function shiftSubtree(plan: Plan, geo: Geo, rootId: string, dx: number, dy: number): void {
  const inSub = (id: string) => plan.within(id, rootId);
  for (const [id, box] of geo.boxes) if (inSub(id)) geo.boxes.set(id, { ...box, x: box.x + dx, y: box.y + dy });
  const keep: GeoEdge[] = [];
  for (const e of geo.edges) {
    const a = inSub(e.conn.from);
    const b = inSub(e.conn.to);
    if (a && b) keep.push({ ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), label: e.label ? { ...e.label, x: e.label.x + dx, y: e.label.y + dy } : undefined });
    else if (a || b) geo.afterEdges.push(e.conn);
    else keep.push(e);
  }
  geo.edges = keep;
}

/**
 * Hybrid: each top-level block is laid out on its own (only the connectors inside it), then
 * ELK places the blocks as boxes, then the connectors between blocks are routed.
 */
async function hybridLayout(plan: Plan, elk: ElkLike, candidate: HybridCandidate): Promise<Geo> {
  const blockOf = (id: string) => plan.blocks.find((b) => plan.within(id, b.id))?.id;
  const inner = new Map<string, Geo>();
  for (const block of plan.blocks) {
    const internal = plan.elkEdges.filter((c) => blockOf(c.from) === block.id && blockOf(c.to) === block.id);
    const graph: ElkNode = {
      id: "root",
      layoutOptions: { ...BASE_OPTIONS, ...ORDERED_OPTIONS, "elk.direction": candidate.inner, "elk.padding": "[top=0,left=0,bottom=0,right=0]" },
      children: [elkNode(plan, block)],
      edges: elkEdges(internal),
    };
    const geo = extract(plan, await layoutWithFallback(elk, graph, true), internal);
    const origin = geo.boxes.get(block.id)!;
    const shift = (p: Point): Point => ({ x: p.x - origin.x, y: p.y - origin.y });
    inner.set(block.id, {
      boxes: new Map([...geo.boxes].map(([id, box]) => [id, { ...box, ...shift(box) }])),
      edges: geo.edges.map((e) => ({ ...e, points: e.points.map(shift), label: e.label ? { ...e.label, ...shift(e.label) } : undefined })),
      width: origin.w,
      height: origin.h,
      afterEdges: [],
    });
  }
  const pairs = new Map<string, [string, string]>();
  for (const c of [...plan.elkEdges, ...plan.afterEdges]) {
    const a = blockOf(c.from);
    const b = blockOf(c.to);
    if (a && b && a !== b) pairs.set(`${a}\u0000${b}`, [a, b]);
  }
  const placed = await layoutWithFallback(
    elk,
    {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "56",
        "elk.layered.spacing.nodeNodeBetweenLayers": "96",
        "elk.padding": "[top=24,left=24,bottom=24,right=24]",
        ...ORDERED_OPTIONS,
        ...candidate.outer,
      },
      children: plan.blocks.map((b) => ({ id: b.id, width: inner.get(b.id)!.width, height: inner.get(b.id)!.height })),
      edges: [...pairs.values()].map(([a, b], i) => ({ id: `b${i}`, sources: [a], targets: [b] })),
    },
    true,
  );
  const geo: Geo = { boxes: new Map(), edges: [], width: placed.width ?? 0, height: placed.height ?? 0, afterEdges: [] };
  for (const child of placed.children ?? []) {
    const g = inner.get(child.id)!;
    const dx = child.x ?? 0;
    const dy = child.y ?? 0;
    for (const [id, box] of g.boxes) geo.boxes.set(id, { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h });
    for (const e of g.edges) geo.edges.push({ ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), label: e.label ? { ...e.label, x: e.label.x + dx, y: e.label.y + dy } : undefined });
  }
  geo.afterEdges = [...plan.elkEdges.filter((c) => blockOf(c.from) !== blockOf(c.to)), ...plan.afterEdges];
  orderLanes(plan, geo);
  straighten(plan, geo);
  placeBand(plan, geo);
  return geo;
}

function extract(plan: Plan, out: ElkNode, conns: NConnection[]): Geo {
  const boxes = new Map<string, Box>();
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const box = { x: ox + (child.x ?? 0), y: oy + (child.y ?? 0), w: child.width ?? 0, h: child.height ?? 0 };
      boxes.set(child.id, box);
      const packed = plan.packed.get(child.id);
      if (packed) for (const [id, r] of packed.rel) boxes.set(id, { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h });
      walk(child, box.x, box.y);
    }
  };
  walk(out, 0, 0);
  const edges: GeoEdge[] = [];
  (out.edges ?? []).forEach((e, i) => {
    const conn = conns[i];
    if (!conn) return;
    const container = (e as ElkExtendedEdge & { container?: string }).container;
    const off = container && container !== "root" ? boxes.get(container) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const points: Point[] = [];
    for (const s of e.sections ?? []) {
      points.push({ x: s.startPoint.x + off.x, y: s.startPoint.y + off.y });
      for (const bp of s.bendPoints ?? []) points.push({ x: bp.x + off.x, y: bp.y + off.y });
      points.push({ x: s.endPoint.x + off.x, y: s.endPoint.y + off.y });
    }
    const l = e.labels?.[0];
    edges.push({ conn, points: dedupe(points), label: l ? { x: (l.x ?? 0) + off.x, y: (l.y ?? 0) + off.y, w: l.width ?? 0, h: l.height ?? 0 } : undefined });
  });
  return { boxes, edges, width: out.width ?? 0, height: out.height ?? 0, afterEdges: [] };
}

/** P2: top-level shared services sit in a band under the diagram, in author order. */
function placeBand(plan: Plan, geo: Geo): void {
  const band = plan.spec.items.filter((i) => plan.info.get(i.id)!.band);
  if (band.length === 0) return;
  let x = 24;
  const y = geo.height + 8;
  let h = 0;
  for (const item of band) {
    const p = pack(item);
    geo.boxes.set(item.id, { x, y, w: p.w, h: p.h });
    for (const [id, r] of p.rel) geo.boxes.set(id, { x: x + r.x, y: y + r.y, w: r.w, h: r.h });
    x += p.w + S.blockGap;
    h = Math.max(h, p.h);
  }
  geo.height = y + h + 24;
  geo.width = Math.max(geo.width, x - S.blockGap + 24);
}

/**
 * The layout that doesn't use ELK: every block packed in author order, blocks in rows sized
 * for a 1.6:1 page. Always succeeds; used when ELK can't load or throws on every candidate.
 */
function packedLayout(plan: Plan): Geo {
  const blocks = plan.blocks.map((item) => ({ item, packed: pack(item) }));
  const area = blocks.reduce((sum, b) => sum + (b.packed.w + S.blockGap) * (b.packed.h + S.blockGap), 0);
  const rowWidth = Math.max(...blocks.map((b) => b.packed.w), Math.sqrt(area * 1.6));
  const geo: Geo = { boxes: new Map(), edges: [], width: 0, height: 0, afterEdges: plan.spec.connections.filter((c) => !plan.hidden.has(c)) };
  let x = 24;
  let y = 24;
  let rowH = 0;
  for (const { item, packed } of blocks) {
    if (x > 24 && x + packed.w > rowWidth + 24) {
      x = 24;
      y += rowH + S.blockGap;
      rowH = 0;
    }
    geo.boxes.set(item.id, { x, y, w: packed.w, h: packed.h });
    for (const [id, r] of packed.rel) geo.boxes.set(id, { x: x + r.x, y: y + r.y, w: r.w, h: r.h });
    x += packed.w + S.blockGap;
    rowH = Math.max(rowH, packed.h);
    geo.width = Math.max(geo.width, x - S.blockGap + 24);
  }
  geo.height = y + rowH + 24;
  placeBand(plan, geo);
  return geo;
}

// ---------------------------------------------------------------- finishing: routes (P4), labels (P6), badges

function finish(plan: Plan, geo: Geo, after: NConnection[]): void {
  rerouteBlocked(plan, geo, after);
  routeAfter(plan, geo, after);
  placeLabels(plan, geo);
  placeBadges(plan, geo);
}

/**
 * P9: the passes after ELK move nodes (P7 lanes, P8 straightening, the shared band), which can
 * leave another connector's ELK route running through a component or a boundary title. Those
 * connectors are routed again after layout, like the ones ELK never laid out.
 */
function rerouteBlocked(plan: Plan, geo: Geo, after: NConnection[]): void {
  const leaves = leafObstacles(plan, geo);
  const titles = titleObstacles(plan, geo);
  const keep: GeoEdge[] = [];
  for (const edge of geo.edges) {
    const ends = new Set([edge.conn.from, edge.conn.to, ...plan.ancestors(edge.conn.from), ...plan.ancestors(edge.conn.to)]);
    const hits = (box: Box) => edge.points.some((p, i) => i > 0 && segmentHits(edge.points[i - 1], p, box));
    // Its own boundaries' title text counts too: the router can usually enter beside it.
    const blocked = leaves.some((l) => !ends.has(l.id) && hits(l.box)) || titles.some((t) => t.id !== edge.conn.from && t.id !== edge.conn.to && hits(t.box));
    if (blocked && !after.includes(edge.conn)) after.push(edge.conn);
    else if (!blocked) keep.push(edge);
  }
  geo.edges = keep;
}

function leafObstacles(plan: Plan, geo: Geo): Array<{ id: string; box: Box }> {
  return [...plan.info.values()].filter((i) => !isBoundary(i.item) && geo.boxes.get(i.item.id)).map((i) => ({ id: i.item.id, box: geo.boxes.get(i.item.id)! }));
}

function titleObstacles(plan: Plan, geo: Geo): Array<{ id: string; box: Box }> {
  return [...plan.info.values()].filter((i) => isBoundary(i.item) && geo.boxes.get(i.item.id)).map((i) => ({ id: i.item.id, box: titleBox(i.item as NBoundary, geo.boxes.get(i.item.id)!) }));
}

/**
 * P4: connectors ELK didn't lay out are routed around every other component and boundary
 * title, steering clear of the routes already drawn. Steps and requests go first.
 */
function routeAfter(plan: Plan, geo: Geo, conns: NConnection[]): void {
  const leaves = leafObstacles(plan, geo);
  const titles = titleObstacles(plan, geo);
  const lines: Array<[Point, Point]> = [];
  for (const e of geo.edges) for (let i = 0; i + 1 < e.points.length; i++) lines.push([e.points[i], e.points[i + 1]]);
  const ordered = [...conns].sort((a, b) => rank(a) - rank(b));
  for (const conn of ordered) {
    const from = geo.boxes.get(conn.from);
    const to = geo.boxes.get(conn.to);
    if (!from || !to) continue;
    const skip = new Set([conn.from, conn.to]);
    const own = (t: { id: string }) => plan.within(conn.from, t.id) || plan.within(conn.to, t.id);
    const obstacles = [...leaves.filter((l) => !skip.has(l.id)).map((l) => l.box), ...titles.filter((t) => !skip.has(t.id) && !own(t)).map((t) => t.box)];
    // The connector has to cross its own boundaries' borders, but not their title text if a nearby way in exists.
    const soft = { softObstacles: titles.filter((t) => !skip.has(t.id) && own(t)).map((t) => t.box), softPenalty: 400 };
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const [fromSide, toSide] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? (["right", "left"] as const) : (["left", "right"] as const)) : dy >= 0 ? (["bottom", "top"] as const) : (["top", "bottom"] as const);
    // Expansions are O(1) (the router rasterises obstacles once per search), so the budget can cover
    // the large grids of envelope-size diagrams; running out falls back to a route that ignores obstacles.
    // Tried in order until a route stays clear of components (and, preferably, of its own titles):
    // facing sides first, then any side; own titles as soft obstacles, then without them, since the
    // extra cost can exhaust the search on dense pages and its fallback ignores obstacles.
    const hitsAny = (route: Point[], boxes: Box[]) => boxes.some((box) => route.some((p, i) => i > 0 && segmentHits(route[i - 1], p, box)));
    const attempts = [{ fromSide, toSide, ...soft }, { ...soft }, { fromSide, toSide }, {}];
    let points: Point[] = [];
    let fallback: Point[] = [];
    for (const extra of attempts) {
      const route = routeEdgeAvoiding(from, to, obstacles, { margin: 12, maxExpansions: 40_000, crossLines: lines, ...extra });
      if (route.length < 2) continue;
      if (fallback.length < 2) fallback = route;
      if (hitsAny(route, obstacles)) continue;
      if (!hitsAny(route, soft.softObstacles)) {
        points = route;
        break;
      }
      if (points.length < 2) points = route;
    }
    if (points.length < 2) points = fallback;
    points = dedupe(points);
    geo.edges.push({ conn, points });
    for (let i = 0; i + 1 < points.length; i++) lines.push([points[i], points[i + 1]]);
  }
}

function rank(conn: NConnection): number {
  if (conn.step) return 0;
  return conn.meaning === "request" ? 1 : conn.meaning === "async" || conn.meaning === "private-link" ? 2 : 3;
}

/**
 * P6: each label goes to the first free spot along its own route (ELK's spot first, then beside
 * every segment, longest first), clear of components, boundary titles, other labels, and not
 * straddling a boundary's border.
 */
function placeLabels(plan: Plan, geo: Geo): void {
  const leaves = leafObstacles(plan, geo).map((l) => l.box);
  const titles = titleObstacles(plan, geo).map((t) => t.box);
  const borders = [...plan.info.values()].filter((i) => isBoundary(i.item)).map((i) => geo.boxes.get(i.item.id)).filter((b): b is Box => Boolean(b));
  const placed: Box[] = [];
  // As strict as the quality scorer: no overlap with components or titles, and a small gap between labels.
  const free = (b: Box) =>
    !leaves.some((l) => overlaps(b, l, 0)) && !titles.some((t) => overlaps(b, t, 0)) && !placed.some((p) => overlaps(b, p, -2)) && !borders.some((g) => straddles(b, g));
  for (const e of geo.edges) {
    if (!e.conn.label || e.points.length < 2) continue;
    const w = labelWidth(e.conn.label);
    const h = S.edgeLabelHeight;
    const options: Box[] = e.label ? [{ ...e.label, w, h }] : [];
    const segments = e.points
      .slice(1)
      .map((p, i) => ({ a: e.points[i], b: p, len: Math.abs(p.x - e.points[i].x) + Math.abs(p.y - e.points[i].y) }))
      .sort((s, t) => t.len - s.len);
    for (const { a, b, len } of segments) {
      // A short link between neighbours still gets its midpoint (a label can sit beside it).
      const fractions = len < 24 ? [0.5] : [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.25, 0.75];
      for (const t of fractions) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (Math.abs(a.y - b.y) < 1) options.push({ x: x - w / 2, y: y - h / 2, w, h }, { x: x - w / 2, y: y - h - 3, w, h }, { x: x - w / 2, y: y + 3, w, h }, { x: x - w / 2, y: y - h - 14, w, h }, { x: x - w / 2, y: y + 14, w, h }, { x: x - w / 2, y: y - h - 28, w, h }, { x: x - w / 2, y: y + 28, w, h });
        else options.push({ x: x + 4, y: y - h / 2, w, h }, { x: x - w - 4, y: y - h / 2, w, h }, { x: x - w / 2, y: y - h / 2, w, h }, { x: x + 16, y: y - h / 2, w, h }, { x: x - w - 16, y: y - h / 2, w, h }, { x: x + 32, y: y - h / 2, w, h }, { x: x - w - 32, y: y - h / 2, w, h });
      }
    }
    // Last resort before overlapping: clear of the cards beside a short link (above or below the row).
    for (const { a, b } of segments.slice(0, 2)) {
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      if (Math.abs(a.y - b.y) < 1) for (const d of [44, 60, 76]) options.push({ x: x - w / 2, y: y - h - d, w, h }, { x: x - w / 2, y: y + d, w, h });
      else for (const d of [48, 72]) options.push({ x: x + d, y: y - h / 2, w, h }, { x: x - w - d, y: y - h / 2, w, h });
    }
    // Crowded routes: the spot that overlaps least.
    const cost = (b: Box) =>
      leaves.reduce((s, l) => s + area(b, l), 0) * 4 + titles.reduce((s, t) => s + area(b, t), 0) * 4 + placed.reduce((s, p) => s + area(b, p), 0) * 2 + (borders.some((g) => straddles(b, g)) ? 50 : 0);
    const chosen = options.find(free) ?? [...options].sort((p, q) => cost(p) - cost(q))[0];
    if (!chosen) continue;
    e.label = chosen;
    placed.push(chosen);
  }
}

/** One badge per step, on the first connector carrying it, near where its arrow starts. */
function placeBadges(plan: Plan, geo: Geo): void {
  const leaves = leafObstacles(plan, geo).map((l) => l.box);
  const titles = titleObstacles(plan, geo).map((t) => t.box);
  const borders = [...plan.info.values()].filter((i) => isBoundary(i.item)).map((i) => geo.boxes.get(i.item.id)).filter((b): b is Box => Boolean(b));
  const labels = geo.edges.map((e) => e.label).filter((l): l is Box => Boolean(l));
  const placed: Box[] = [];
  const seen = new Set<string>();
  const r = S.badge / 2;
  const free = (c: Point) => {
    const box = { x: c.x - r, y: c.y - r, w: S.badge, h: S.badge };
    return (
      !leaves.some((l) => overlaps(box, l, 0)) &&
      !titles.some((t) => overlaps(box, t, 0)) &&
      !labels.some((l) => overlaps(box, l, 0)) &&
      !placed.some((p) => overlaps(box, p, 2)) &&
      !borders.some((g) => straddles(box, g))
    );
  };
  for (const e of geo.edges) {
    const step = e.conn.step;
    if (!step || e.points.length < 2) continue;
    const key = `${step.sequence}.${step.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Near where the arrow starts first; then anywhere along the route.
    const near: Point[] = [];
    const farther: Point[] = [];
    let walked = 0;
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i];
      const b = e.points[i + 1];
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      for (const d of [24, 44, 64, 90, 120, 160, 200, 260, 320]) {
        if (d > len - 6) break;
        const t = d / len;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const horizontal = Math.abs(a.y - b.y) < 1;
        const spots = [horizontal ? { x: p.x, y: p.y - r - 4 } : { x: p.x + r + 4, y: p.y }, horizontal ? { x: p.x, y: p.y + r + 4 } : { x: p.x - r - 4, y: p.y }, p];
        (walked < 400 && d <= 120 ? near : farther).push(...spots);
      }
      walked += len;
    }
    const box = (c: Point) => ({ x: c.x - r, y: c.y - r, w: S.badge, h: S.badge });
    const cost = (c: Point) => {
      const b = box(c);
      return leaves.reduce((s, l) => s + area(b, l), 0) * 4 + titles.reduce((s, t) => s + area(b, t), 0) * 4 + labels.reduce((s, l) => s + area(b, l), 0) * 2 + placed.reduce((s, p) => s + area(b, p), 0) * 2 + (borders.some((g) => straddles(b, g)) ? 50 : 0);
    };
    const at = near.find(free) ?? farther.find(free) ?? [...near, ...farther].sort((p, q) => cost(p) - cost(q))[0];
    if (!at) continue;
    e.badge = at;
    placed.push(box(at));
  }
}

// ---------------------------------------------------------------- scoring

interface Score {
  hard: number;
  aspect: number;
  crossings: number;
  loops: number;
  backward: number;
  cost: number;
}

/**
 * Hard constraints first (overlaps, containment, connectors through components or titles,
 * labels on components, titles, other labels or borders), then a steep aspect penalty outside
 * 1.3–2.0 for the whole page, crossings, long loops, connectors against the reading direction,
 * bends, length and overlays that can't be drawn cleanly.
 */
function scoreGeo(plan: Plan, geo: Geo, final: boolean): Score {
  const ids = [...geo.boxes.keys()];
  const anc = plan.ancestors;
  let hard = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      if (anc(a).includes(b) || anc(b).includes(a)) continue;
      if (overlaps(geo.boxes.get(a)!, geo.boxes.get(b)!, 1)) hard++;
    }
    const parent = plan.info.get(ids[i])?.parent;
    if (parent && geo.boxes.get(parent) && !inside(geo.boxes.get(ids[i])!, geo.boxes.get(parent)!)) hard++;
  }
  const leaves = leafObstacles(plan, geo);
  const titles = titleObstacles(plan, geo);
  for (const t of titles) {
    const box = geo.boxes.get(t.id)!;
    if (t.box.x + t.box.w > box.x + box.w - 2) hard++;
  }
  let crossings = 0;
  let loops = 0;
  let bends = 0;
  let length = 0;
  let backward = 0;
  const segs: Array<{ edge: number; a: Point; b: Point }> = [];
  geo.edges.forEach((e, index) => {
    const ends = new Set([e.conn.from, e.conn.to, ...anc(e.conn.from), ...anc(e.conn.to)]);
    let len = 0;
    for (let i = 0; i + 1 < e.points.length; i++) {
      const a = e.points[i];
      const b = e.points[i + 1];
      len += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      segs.push({ edge: index, a, b });
      for (const l of leaves) if (!ends.has(l.id) && segmentHits(a, b, l.box)) hard++;
      for (const t of titles) if (!ends.has(t.id) && segmentHits(a, b, t.box)) hard++;
    }
    bends += Math.max(0, e.points.length - 2);
    length += len;
    if (len > geo.width * 1.1) loops++;
    const from = geo.boxes.get(e.conn.from);
    const to = geo.boxes.get(e.conn.to);
    if (from && to) {
      // Against the reading direction: mostly leftward, or mostly upward.
      const dx = to.x + to.w / 2 - (from.x + from.w / 2);
      const dy = to.y + to.h / 2 - (from.y + from.h / 2);
      if ((dx < -40 && -dx > Math.abs(dy)) || (dy < -40 && -dy > Math.abs(dx))) backward++;
    }
  });
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i].edge !== segs[j].edge && properCross(segs[i].a, segs[i].b, segs[j].a, segs[j].b)) crossings++;
  const labels = geo.edges.map((e) => e.label).filter((l): l is Box => Boolean(l));
  for (let i = 0; i < labels.length; i++) {
    for (const l of leaves) if (overlaps(labels[i], l.box, 0)) hard++;
    for (const t of titles) if (overlaps(labels[i], t.box, 0)) hard++;
    for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i], labels[j], 0)) hard++;
  }
  let overlayPenalty = 0;
  for (const overlay of plan.spec.overlays) if (!overlayClean(plan, geo, overlay)) overlayPenalty += 30;
  // Page aspect: the title above and the workflow, legend and assumptions below count too.
  const page = pageSize(plan, geo.width, geo.height);
  const aspect = page.w / Math.max(1, page.h);
  const dev = aspect < 1.3 ? 1.3 - aspect : aspect > 2.0 ? aspect - 2.0 : 0;
  // Before routing, estimate the connectors left for later as straight lines between their ends:
  // their crossings with the routes already there (and each other) predict the routed result.
  const pending = final ? 0 : pendingCrossings(geo, segs) * 6 + geo.afterEdges.length;
  // A connector that wraps around the page (a "loop") reads worse than a slightly wide page.
  const cost = hard * 1000 + 120 * dev + 400 * dev * dev + crossings * 6 + loops * 150 + backward * 30 + bends * 0.5 + length / 1000 + overlayPenalty + pending;
  return { hard, aspect, crossings, loops, backward, cost };
}

function pendingCrossings(geo: Geo, segs: Array<{ a: Point; b: Point }>): number {
  const centre = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const lines = geo.afterEdges
    .map((c) => [geo.boxes.get(c.from), geo.boxes.get(c.to)] as const)
    .filter((pair): pair is readonly [Box, Box] => Boolean(pair[0] && pair[1]))
    .map(([f, t]) => ({ a: centre(f), b: centre(t) }));
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    for (const s of segs) if (properCross(lines[i].a, lines[i].b, s.a, s.b)) count++;
    for (let j = i + 1; j < lines.length; j++) if (properCross(lines[i].a, lines[i].b, lines[j].a, lines[j].b)) count++;
  }
  return count;
}

function overlayClean(plan: Plan, geo: Geo, overlay: NOverlay): boolean {
  const members = overlay.members.map((m) => geo.boxes.get(m)).filter((b): b is Box => Boolean(b));
  if (members.length < 2) return true;
  const box = overlayBox(members);
  // Same rule as the renderer (overlays.ts): no other component inside, no boundary title cut.
  return leafObstacles(plan, geo).every((l) => overlay.members.includes(l.id) || !overlaps(box, l.box, 0)) && titleObstacles(plan, geo).every((t) => !overlaps(box, t.box, 0));
}

function pageSize(plan: Plan, width: number, height: number): { w: number; h: number } {
  const title = titleBlock(plan.spec.title, plan.spec.subtitle, Math.max(480, width));
  const sections = pageSections(width, plan.spec.sequences, plan.spec.assumptions, { meanings: visibleMeanings(plan), sequences: plan.spec.sequences, taggedOverlays: [] });
  return { w: Math.max(width, title.w) + S.pageMargin * 2, h: title.h + 20 + height + sections.height + S.pageMargin * 2 };
}

function visibleMeanings(plan: Plan): NConnection["meaning"][] {
  return [...new Set(plan.spec.connections.filter((c) => !plan.hidden.has(c)).map((c) => c.meaning))];
}

// ---------------------------------------------------------------- model

function emitModel(plan: Plan, geo: Geo, warnings: string[]): DiagramModel {
  // Page: title top-left, the diagram under it, the workflow, legend and assumptions under that.
  const contentBoxes = [...geo.boxes.values()];
  const contentPoints = geo.edges.flatMap((e) => e.points);
  const minX = Math.min(...contentBoxes.map((b) => b.x), ...contentPoints.map((p) => p.x));
  const minY = Math.min(...contentBoxes.map((b) => b.y), ...contentPoints.map((p) => p.y));
  const maxX = Math.max(...contentBoxes.map((b) => b.x + b.w), ...contentPoints.map((p) => p.x));
  const maxY = Math.max(...contentBoxes.map((b) => b.y + b.h), ...contentPoints.map((p) => p.y));
  const diagramW = maxX - minX;
  const title = titleBlock(plan.spec.title, plan.spec.subtitle, Math.max(480, diagramW));
  const dx = S.pageMargin - minX;
  const dy = S.pageMargin + title.h + 20 - minY;
  const move = (p: Point): Point => ({ x: round(p.x + dx), y: round(p.y + dy) });
  const moveBox = (b: Box): Box => ({ x: round(b.x + dx), y: round(b.y + dy), w: round(b.w), h: round(b.h) });

  const nodes: DiagramNode[] = [];
  nodes.push({
    id: "__title",
    parent: null,
    label: plan.spec.title,
    shape: "text",
    box: { x: S.pageMargin, y: S.pageMargin, w: Math.max(1, title.w), h: title.h },
    style: {},
    container: false,
    role: "title",
    generated: true,
  });
  const pathOf = (id: string) => plan.info.get(id)!.path;
  for (const item of allItems(plan.spec.items)) {
    const box = geo.boxes.get(item.id);
    if (!box) continue;
    const parent = plan.info.get(item.id)!.parent;
    if (isBoundary(item)) {
      const node: DiagramNode = { id: pathOf(item.id), parent: parent ? pathOf(parent) : null, label: item.name, shape: "rectangle", box: moveBox(box), style: {}, container: true, role: "boundary", arch: { id: item.id, kind: item.kind } };
      if (item.facts) node.arch!.facts = item.facts;
      if (item.platform) node.arch!.platform = item.platform;
      nodes.push(node);
    } else {
      const node: DiagramNode = { id: pathOf(item.id), parent: parent ? pathOf(parent) : null, label: item.name, shape: "rectangle", box: moveBox(box), style: {}, container: false, role: "service", arch: { id: item.id } };
      if (item.icon) {
        node.icon = `/icons/${item.icon}.svg`;
        node.arch!.iconKey = item.icon;
      }
      if (item.detail) node.arch!.detail = item.detail;
      nodes.push(node);
    }
  }

  const drawn = new Map(geo.edges.map((e) => [e.conn, e]));
  const counts = new Map<string, number>();
  const edges: DiagramEdge[] = [];
  for (const conn of plan.spec.connections) {
    const from = pathOf(conn.from);
    const to = pathOf(conn.to);
    const pair = `${from}\u0000${to}`;
    const n = counts.get(pair) ?? 0;
    counts.set(pair, n + 1);
    const both = conn.meaning === "peering" || conn.meaning === "vpn";
    const edge: DiagramEdge = { id: edgeId(from, to, n), from, to, srcArrow: both ? "triangle" : "none", dstArrow: "triangle", style: {}, route: [], meaning: conn.meaning };
    if (conn.label) {
      edge.label = conn.label;
      edge.labelSize = { w: labelWidth(conn.label), h: S.edgeLabelHeight };
    }
    const g = drawn.get(conn);
    if (plan.hidden.has(conn) || !g) {
      if (plan.hidden.has(conn)) edge.hidden = true;
    } else {
      edge.route = g.points.map(move);
      if (g.label && conn.label) edge.labelAt = move({ x: g.label.x + g.label.w / 2, y: g.label.y + g.label.h / 2 });
    }
    if (conn.step) {
      const badge: EdgeBadge = { sequence: conn.step.sequence, number: conn.step.number };
      if (g?.badge) badge.at = move(g.badge);
      edge.badges = [badge];
    }
    edges.push(edge);
  }

  const diagramBottom = maxY + dy;
  const sections: PageSections = pageSections(round(diagramW), plan.spec.sequences, plan.spec.assumptions, {
    meanings: visibleMeanings(plan),
    sequences: plan.spec.sequences,
    taggedOverlays: plan.spec.overlays.filter((o) => !overlayClean(plan, geo, o)),
  });
  const sectionTop = diagramBottom + 32;
  const addSection = (role: "workflow" | "legend" | "assumptions", block: PageSections["workflow"], at: { x: number; y: number } | undefined) => {
    if (!block || !at) return;
    nodes.push({ id: `__${role}`, parent: null, label: role === "workflow" ? "Workflow" : role === "legend" ? "Legend" : "Assumptions", shape: "text", box: { x: round(S.pageMargin + at.x), y: round(sectionTop + at.y), w: block.w, h: block.h }, style: {}, container: false, role, generated: true });
  };
  addSection("workflow", sections.workflow, sections.at.workflow);
  addSection("legend", sections.legend, sections.at.legend);
  addSection("assumptions", sections.assumptions, sections.at.assumptions);
  for (const o of plan.spec.overlays) if (!overlayClean(plan, geo, o)) warnings.push(`${o.name} couldn't be drawn around its members; tagged them instead`);

  const model: DiagramModel = {
    version: 1,
    kind: "architecture",
    nodes,
    edges,
    arch: { title: plan.spec.title, sequences: plan.spec.sequences, assumptions: plan.spec.assumptions, overlays: plan.spec.overlays },
  };
  if (plan.spec.subtitle) model.arch!.subtitle = plan.spec.subtitle;
  if (plan.spec.platform) model.arch!.platform = plan.spec.platform;
  if (plan.spec.view) model.arch!.view = plan.spec.view;
  return model;
}

function modelBounds(model: DiagramModel): Box {
  const boxes = model.nodes.map((n) => n.box);
  const w = Math.max(...boxes.map((b) => b.x + b.w)) + S.pageMargin;
  const h = Math.max(...boxes.map((b) => b.y + b.h)) + S.pageMargin;
  return { x: 0, y: 0, w, h };
}

// ---------------------------------------------------------------- geometry helpers

function labelWidth(label: string): number {
  return Math.ceil(measureText(label, T.edgeLabel)) + S.edgeLabelPad * 2;
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.x + pad < b.x + b.w && b.x + pad < a.x + a.w && a.y + pad < b.y + b.h && b.y + pad < a.y + a.h;
}

function area(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function inside(child: Box, parent: Box): boolean {
  return child.x >= parent.x - 1 && child.y >= parent.y - 1 && child.x + child.w <= parent.x + parent.w + 1 && child.y + child.h <= parent.y + parent.h + 1;
}

/** A label that crosses a boundary's border line (partly inside, partly outside). */
function straddles(label: Box, group: Box): boolean {
  if (!overlaps(label, group, 0)) return false;
  return !inside(label, group);
}

function segmentHits(a: Point, b: Point, box: Box): boolean {
  const s = 2;
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x1 < box.x + box.w - s && x2 > box.x + s && y1 < box.y + box.h - s && y2 > box.y + s;
}

function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const shared = [a, b].some((p) => [c, d].some((q) => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1));
  if (shared) return false;
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  // Drop collinear middle points.
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const b = out[i + 1];
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) || (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5));
  });
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function union(boxes: Box[]): Box {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
