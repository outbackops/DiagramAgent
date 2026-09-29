import { boxesOverlap, center, expand, polylineLength, simplifyPolyline, unionBoxes } from "./geometry";
import { descendants, indexModel, isGroup, isWithin, leafNodes } from "./query";
import type { Box, DiagramModel, Point } from "./types";

export type Side = "top" | "right" | "bottom" | "left";

type Dir = "up" | "right" | "down" | "left";

interface RouteOptions {
  margin?: number;
  bendPenalty?: number;
  fromSide?: Side;
  toSide?: Side;
  fromOffset?: number;
  toOffset?: number;
  maxExpansions?: number;
}

interface InternalRouteOptions extends RouteOptions {
  softObstacles?: Box[];
  softPenalty?: number;
  fallbackOnly?: boolean;
  budget?: { remaining: number };
  /** Existing routes: crossing one costs `crossPenalty`, running along one half of it. Adds no grid lines. */
  crossLines?: Array<[Point, Point]>;
  crossPenalty?: number;
}

const DEFAULT_MARGIN = 12;
const DEFAULT_BEND_PENALTY = 30;
const DEFAULT_MAX_EXPANSIONS = 20_000;
const DEFAULT_TOTAL_EXPANSIONS = 50_000;
const STUB = 8;
const EPSILON = 0.001;

const sides: Side[] = ["top", "right", "bottom", "left"];

function right(b: Box): number {
  return b.x + b.w;
}

function bottom(b: Box): number {
  return b.y + b.h;
}

function sideDir(side: Side): Dir {
  if (side === "top") return "up";
  if (side === "right") return "right";
  if (side === "bottom") return "down";
  return "left";
}

function oppositeDir(dir: Dir): Dir {
  if (dir === "up") return "down";
  if (dir === "right") return "left";
  if (dir === "down") return "up";
  return "right";
}

function dirVector(dir: Dir): Point {
  if (dir === "up") return { x: 0, y: -1 };
  if (dir === "right") return { x: 1, y: 0 };
  if (dir === "down") return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

function port(box: Box, side: Side, offset = 0): Point {
  if (side === "top" || side === "bottom") {
    const half = Math.max(0, box.w / 2 - 1);
    const x = box.x + box.w / 2 + Math.max(-half, Math.min(half, offset));
    return { x, y: side === "top" ? box.y : bottom(box) };
  }
  const half = Math.max(0, box.h / 2 - 1);
  const y = box.y + box.h / 2 + Math.max(-half, Math.min(half, offset));
  return { x: side === "left" ? box.x : right(box), y };
}

function stubPoint(p: Point, side: Side): Point {
  const v = dirVector(sideDir(side));
  return { x: p.x + v.x * STUB, y: p.y + v.y * STUB };
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map(snapGrid))].sort((a, b) => a - b);
}

function snapGrid(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function addCoordinate(values: number[], value: number): void {
  if (Number.isFinite(value)) values.push(value);
}

function addMidlines(values: number[]): void {
  const sorted = uniqueSorted(values);
  for (let i = 1; i < sorted.length; i++) values.push((sorted[i - 1] + sorted[i]) / 2);
}

class MinHeap<T> {
  private readonly items: { item: T; priority: number }[] = [];

  get length(): number {
    return this.items.length;
  }

  push(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) return undefined;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return first.item;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= this.items[index].priority) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    for (;;) {
      const left = index * 2 + 1;
      const rightIndex = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
      if (rightIndex < this.items.length && this.items[rightIndex].priority < this.items[smallest].priority) smallest = rightIndex;
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}

interface SearchResult {
  points: Point[];
  cost: number;
}

const DIRS: readonly Dir[] = ["up", "right", "down", "left"];
const DIR_INDEX: Record<Dir, number> = { up: 0, right: 1, down: 2, left: 3 };
// Neighbour order matters for tie-breaking in the heap: left, right, up, down.
const STEPS: ReadonlyArray<{ dx: number; dy: number; dir: number }> = [
  { dx: -1, dy: 0, dir: 3 },
  { dx: 1, dy: 0, dir: 1 },
  { dx: 0, dy: -1, dir: 0 },
  { dx: 0, dy: 1, dir: 2 },
];

/** Search state buffers, reused across searches; `stamp` marks which entries belong to the current one. */
const pool = { size: 0, generation: 0, best: new Float64Array(0), prev: new Int32Array(0), stamp: new Uint32Array(0) };

function searchBuffers(states: number): typeof pool {
  if (pool.size < states) {
    pool.size = states;
    pool.best = new Float64Array(states);
    pool.prev = new Int32Array(states);
    pool.stamp = new Uint32Array(states);
    pool.generation = 0;
  }
  pool.generation++;
  if (pool.generation === 0xffffffff) {
    pool.stamp.fill(0);
    pool.generation = 1;
  }
  return pool;
}

/** First index whose value is greater than `value` (values sorted ascending). */
function firstAbove(values: number[], value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] > value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index whose value is at least `value` (values sorted ascending). */
function firstAtLeast(values: number[], value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] >= value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Whether a grid step along one axis, from `a` to `b` at `at` on the other axis, passes through the open
 * box spanning [lo, hi] × (crossLo, crossHi). The same test as segmentHitsBox for an axis-aligned segment.
 */
function stepHitsBox(a: number, b: number, at: number, lo: number, hi: number, crossLo: number, crossHi: number): boolean {
  if (!(at > crossLo && at < crossHi)) return false;
  const length = Math.abs(b - a);
  if (length === 0) return false;
  return Math.min(Math.max(a, b), hi) - Math.max(Math.min(a, b), lo) > 1e-9 * length;
}

interface GridCosts {
  /** Grid points inside a hard obstacle. */
  pointBlocked: Uint8Array;
  /** Steps from (ix, iy) to (ix + 1, iy) and to (ix, iy + 1) through a hard obstacle. */
  hBlocked: Uint8Array;
  vBlocked: Uint8Array;
  /** Soft-obstacle and existing-route penalties of those steps. */
  hPenalty: Float64Array;
  vPenalty: Float64Array;
}

/** Per-search step costs, reused across searches (zeroed over the used length). */
const costPool = { size: 0, pointBlocked: new Uint8Array(0), hBlocked: new Uint8Array(0), vBlocked: new Uint8Array(0), hPenalty: new Float64Array(0), vPenalty: new Float64Array(0) };

/**
 * Rasterises obstacles and existing routes onto the search grid once, so each step of the search
 * costs O(1) instead of a scan over every box and line. Semantics match segmentHitsBox,
 * pointInsideBox and crossingPenalty exactly; only the cells a box or line can touch are visited.
 */
function gridCosts(gridX: number[], gridY: number[], hard: Box[], soft: Box[], softPenalty: number, lines: Array<[Point, Point]>, crossPenalty: number): GridCosts {
  const nx = gridX.length;
  const ny = gridY.length;
  const cells = nx * ny;
  if (costPool.size < cells) {
    costPool.size = cells;
    costPool.pointBlocked = new Uint8Array(cells);
    costPool.hBlocked = new Uint8Array(cells);
    costPool.vBlocked = new Uint8Array(cells);
    costPool.hPenalty = new Float64Array(cells);
    costPool.vPenalty = new Float64Array(cells);
  } else {
    costPool.pointBlocked.fill(0, 0, cells);
    costPool.hBlocked.fill(0, 0, cells);
    costPool.vBlocked.fill(0, 0, cells);
    costPool.hPenalty.fill(0, 0, cells);
    costPool.vPenalty.fill(0, 0, cells);
  }
  const costs: GridCosts = costPool;
  const markBox = (box: Box, onH: (i: number) => void, onV: (i: number) => void) => {
    const x0 = box.x;
    const x1 = right(box);
    const y0 = box.y;
    const y1 = bottom(box);
    // Horizontal steps along rows strictly inside the box's height.
    for (let iy = firstAbove(gridY, y0); iy < ny && gridY[iy] < y1; iy++) {
      for (let ix = Math.max(0, firstAtLeast(gridX, x0) - 1); ix + 1 < nx && gridX[ix] < x1; ix++) {
        if (stepHitsBox(gridX[ix], gridX[ix + 1], gridY[iy], x0, x1, y0, y1)) onH(iy * nx + ix);
      }
    }
    // Vertical steps along columns strictly inside the box's width.
    for (let ix = firstAbove(gridX, x0); ix < nx && gridX[ix] < x1; ix++) {
      for (let iy = Math.max(0, firstAtLeast(gridY, y0) - 1); iy + 1 < ny && gridY[iy] < y1; iy++) {
        if (stepHitsBox(gridY[iy], gridY[iy + 1], gridX[ix], y0, y1, x0, x1)) onV(iy * nx + ix);
      }
    }
  };
  for (const box of hard) {
    for (let iy = firstAbove(gridY, box.y + EPSILON); iy < ny && gridY[iy] < bottom(box) - EPSILON; iy++) {
      for (let ix = firstAbove(gridX, box.x + EPSILON); ix < nx && gridX[ix] < right(box) - EPSILON; ix++) costs.pointBlocked[iy * nx + ix] = 1;
    }
    markBox(box, (i) => (costs.hBlocked[i] = 1), (i) => (costs.vBlocked[i] = 1));
  }
  for (const box of soft) markBox(box, (i) => (costs.hPenalty[i] += softPenalty), (i) => (costs.vPenalty[i] += softPenalty));

  for (const [p, q] of lines) {
    if (Math.abs(p.y - q.y) < EPSILON) {
      // A horizontal route: running along it costs half; a vertical step crossing it costs the full penalty.
      const at = p.y;
      const lo = Math.min(p.x, q.x);
      const hi = Math.max(p.x, q.x);
      for (let iy = firstAtLeast(gridY, at - 2); iy < ny && gridY[iy] <= at + 2; iy++) {
        if (Math.abs(at - gridY[iy]) > 2) continue;
        for (let ix = Math.max(0, firstAtLeast(gridX, lo) - 1); ix + 1 < nx && gridX[ix] < hi; ix++) {
          if (Math.min(gridX[ix + 1], hi) - Math.max(gridX[ix], lo) > 2) costs.hPenalty[iy * nx + ix] += crossPenalty / 2;
        }
      }
      const iy = firstAtLeast(gridY, at) - 1;
      if (iy >= 0 && iy + 1 < ny && at > gridY[iy] + EPSILON && at < gridY[iy + 1] - EPSILON) {
        for (let ix = firstAbove(gridX, lo + EPSILON); ix < nx && gridX[ix] < hi - EPSILON; ix++) costs.vPenalty[iy * nx + ix] += crossPenalty;
      }
    } else {
      const at = p.x;
      const lo = Math.min(p.y, q.y);
      const hi = Math.max(p.y, q.y);
      for (let ix = firstAtLeast(gridX, at - 2); ix < nx && gridX[ix] <= at + 2; ix++) {
        if (Math.abs(at - gridX[ix]) > 2) continue;
        for (let iy = Math.max(0, firstAtLeast(gridY, lo) - 1); iy + 1 < ny && gridY[iy] < hi; iy++) {
          if (Math.min(gridY[iy + 1], hi) - Math.max(gridY[iy], lo) > 2) costs.vPenalty[iy * nx + ix] += crossPenalty / 2;
        }
      }
      const ix = firstAtLeast(gridX, at) - 1;
      if (ix >= 0 && ix + 1 < nx && at > gridX[ix] + EPSILON && at < gridX[ix + 1] - EPSILON) {
        for (let iy = firstAbove(gridY, lo + EPSILON); iy < ny && gridY[iy] < hi - EPSILON; iy++) costs.hPenalty[iy * nx + ix] += crossPenalty;
      }
    }
  }
  return costs;
}

function searchGrid(start: Point, end: Point, startDir: Dir, endDir: Dir, hard: Box[], options: InternalRouteOptions): SearchResult | null {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const bendPenalty = options.bendPenalty ?? DEFAULT_BEND_PENALTY;
  const soft = options.softObstacles ?? [];
  const softPenalty = options.softPenalty ?? 60;
  const maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;
  const xs: number[] = [start.x, end.x];
  const ys: number[] = [start.y, end.y];
  const all = unionBoxes([...hard, ...soft]) ?? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y) };
  addCoordinate(xs, Math.min(start.x, end.x, all.x) - margin * 4 - STUB);
  addCoordinate(xs, Math.max(start.x, end.x, right(all)) + margin * 4 + STUB);
  addCoordinate(ys, Math.min(start.y, end.y, all.y) - margin * 4 - STUB);
  addCoordinate(ys, Math.max(start.y, end.y, bottom(all)) + margin * 4 + STUB);

  for (const box of [...hard, ...soft]) {
    addCoordinate(xs, box.x);
    addCoordinate(xs, right(box));
    addCoordinate(ys, box.y);
    addCoordinate(ys, bottom(box));
  }
  addMidlines(xs);
  addMidlines(ys);

  const gridX = uniqueSorted(xs);
  const gridY = uniqueSorted(ys);
  const startIx = gridX.indexOf(snapGrid(start.x));
  const startIy = gridY.indexOf(snapGrid(start.y));
  const endIx = gridX.indexOf(snapGrid(end.x));
  const endIy = gridY.indexOf(snapGrid(end.y));
  if (startIx < 0 || startIy < 0 || endIx < 0 || endIy < 0) return null;
  const nx = gridX.length;
  const ny = gridY.length;
  const costs = gridCosts(gridX, gridY, hard, soft, softPenalty, options.crossLines ?? [], options.crossPenalty ?? 80);

  // A state is a grid point and the direction it was entered from: ((iy * nx + ix) * 4 + dir).
  const buffers = searchBuffers(nx * ny * 4);
  const { best, prev, stamp, generation } = buffers;
  const bestOf = (state: number) => (stamp[state] === generation ? best[state] : Infinity);
  const heap = new MinHeap<number>();
  const firstState = (startIy * nx + startIx) * 4 + DIR_INDEX[startDir];
  stamp[firstState] = generation;
  best[firstState] = 0;
  prev[firstState] = -1;
  heap.push(firstState, Math.abs(start.x - end.x) + Math.abs(start.y - end.y));

  let endState = -1;
  let expansions = 0;
  while (heap.length > 0) {
    const state = heap.pop();
    if (state === undefined) break;
    expansions += 1;
    if (expansions > maxExpansions || (options.budget && --options.budget.remaining < 0)) return null;
    const cost = best[state];
    const dir = state & 3;
    const cell = state >> 2;
    const ix = cell % nx;
    const iy = (cell - ix) / nx;
    if (ix === endIx && iy === endIy) {
      endState = state;
      break;
    }
    const ax = gridX[ix];
    const ay = gridY[iy];
    for (const step of STEPS) {
      const nix = ix + step.dx;
      const niy = iy + step.dy;
      if (nix < 0 || niy < 0 || nix >= nx || niy >= ny) continue;
      if (costs.pointBlocked[niy * nx + nix]) continue;
      // Steps are stored once per pair of neighbours, at the lower-left one.
      const along = step.dy === 0 ? niy * nx + Math.min(ix, nix) : Math.min(iy, niy) * nx + nix;
      if (step.dy === 0 ? costs.hBlocked[along] : costs.vBlocked[along]) continue;
      const penalty = step.dy === 0 ? costs.hPenalty[along] : costs.vPenalty[along];
      const bx = gridX[nix];
      const by = gridY[niy];
      const turnCost = dir === step.dir ? 0 : bendPenalty;
      const nextCost = cost + Math.abs(ax - bx) + Math.abs(ay - by) + turnCost + penalty;
      const nextState = (niy * nx + nix) * 4 + step.dir;
      if (nextCost >= bestOf(nextState)) continue;
      stamp[nextState] = generation;
      best[nextState] = nextCost;
      prev[nextState] = state;
      heap.push(nextState, nextCost + Math.abs(bx - end.x) + Math.abs(by - end.y));
    }
  }

  if (endState < 0) return null;
  const path: Point[] = [];
  for (let state = endState; state >= 0; state = prev[state]) {
    const cell = state >> 2;
    const ix = cell % nx;
    path.push({ x: gridX[ix], y: gridY[(cell - ix) / nx] });
  }
  path.reverse();
  const lastDir = DIRS[endState & 3];
  const cost = best[endState] + (lastDir === endDir ? 0 : bendPenalty);
  return { points: path, cost };
}
function fallbackRoute(from: Box, to: Box, fromSide: Side, toSide: Side, fromOffset: number, toOffset: number): Point[] {
  const start = port(from, fromSide, fromOffset);
  const end = port(to, toSide, toOffset);
  const startStub = stubPoint(start, fromSide);
  const endStub = stubPoint(end, toSide);
  const midX = (startStub.x + endStub.x) / 2;
  const midY = (startStub.y + endStub.y) / 2;
  const hvh = simplifyPolyline([start, startStub, { x: midX, y: startStub.y }, { x: midX, y: endStub.y }, endStub, end]);
  const vhv = simplifyPolyline([start, startStub, { x: startStub.x, y: midY }, { x: endStub.x, y: midY }, endStub, end]);
  return polylineLength(hvh) <= polylineLength(vhv) ? hvh : vhv;
}

function routeWithSides(from: Box, to: Box, obstacles: Box[], fromSide: Side, toSide: Side, options: InternalRouteOptions): SearchResult {
  if (options.fallbackOnly) {
    const points = fallbackRoute(from, to, fromSide, toSide, options.fromOffset ?? 0, options.toOffset ?? 0);
    return { points, cost: polylineLength(points) + 100_000 };
  }
  const start = port(from, fromSide, options.fromOffset ?? 0);
  const end = port(to, toSide, options.toOffset ?? 0);
  const startStub = stubPoint(start, fromSide);
  const endStub = stubPoint(end, toSide);
  const hard = obstacles.map((o) => expand(o, options.margin ?? DEFAULT_MARGIN));
  const search = searchGrid(startStub, endStub, sideDir(fromSide), oppositeDir(sideDir(toSide)), hard, options);
  if (!search) {
    const points = fallbackRoute(from, to, fromSide, toSide, options.fromOffset ?? 0, options.toOffset ?? 0);
    return { points, cost: polylineLength(points) + 100_000 };
  }
  const points = simplifyPolyline([start, ...search.points, end]);
  return { points, cost: search.cost + polylineLength([start, startStub]) + polylineLength([endStub, end]) };
}

export function routeEdge(from: Box, to: Box, obstacles: Box[], options: RouteOptions = {}): Point[] {
  return routeEdgeInternal(from, to, obstacles, options);
}

/**
 * Like routeEdge, but also steers clear of existing routes: each crossing costs `crossPenalty`
 * (default 80) and running along another route costs half, so connectors drawn after a layout
 * pick channels instead of cutting through the lines already there.
 */
export function routeEdgeAvoiding(from: Box, to: Box, obstacles: Box[], options: RouteOptions & { crossLines?: Array<[Point, Point]>; crossPenalty?: number } = {}): Point[] {
  return routeEdgeInternal(from, to, obstacles, options);
}

function routeEdgeInternal(from: Box, to: Box, obstacles: Box[], options: InternalRouteOptions = {}): Point[] {
  const fromSides = options.fromSide ? [options.fromSide] : sides;
  const toSides = options.toSide ? [options.toSide] : sides;
  let best: SearchResult | null = null;
  for (const fromSide of fromSides) {
    for (const toSide of toSides) {
      const route = routeWithSides(from, to, obstacles, fromSide, toSide, options);
      if (!best || route.cost < best.cost) best = route;
    }
  }
  return best?.points ?? fallbackRoute(from, to, options.fromSide ?? "right", options.toSide ?? "left", options.fromOffset ?? 0, options.toOffset ?? 0);
}

function pruneObstacles(from: Box, to: Box, obstacles: Box[], margin: number): Box[] {
  if (obstacles.length <= 30) return obstacles;
  const bounds = unionBoxes([from, to]);
  if (!bounds) return obstacles;
  const padded = expand(bounds, Math.max(180, margin * 12));
  return obstacles.filter((box) => boxesOverlap(padded, box));
}

function facingSide(from: Box, to: Box): Side {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function sideAxisValue(box: Box, side: Side): number {
  const c = center(box);
  return side === "top" || side === "bottom" ? c.x : c.y;
}

function spreadOffsets(model: DiagramModel, edgeIds: Set<string>): Map<string, { fromSide: Side; toSide: Side; fromOffset: number; toOffset: number }> {
  const index = indexModel(model);
  const assigned = new Map<string, { fromSide: Side; toSide: Side; fromOffset: number; toOffset: number }>();
  const groups = new Map<string, { edgeId: string; endpoint: "from" | "to"; other: Box; side: Side; sideLength: number }[]>();
  for (const edge of model.edges) {
    if (!edgeIds.has(edge.id)) continue;
    const from = index.byId.get(edge.from);
    const to = index.byId.get(edge.to);
    if (!from || !to) continue;
    const fromSide = facingSide(from.box, to.box);
    const toSide = facingSide(to.box, from.box);
    assigned.set(edge.id, { fromSide, toSide, fromOffset: 0, toOffset: 0 });
    for (const item of [
      { nodeId: edge.from, endpoint: "from" as const, nodeBox: from.box, other: to.box, side: fromSide },
      { nodeId: edge.to, endpoint: "to" as const, nodeBox: to.box, other: from.box, side: toSide },
    ]) {
      const key = `${item.nodeId}\u0000${item.side}`;
      const sideLength = item.side === "top" || item.side === "bottom" ? item.nodeBox.w : item.nodeBox.h;
      const list = groups.get(key);
      if (list) list.push({ edgeId: edge.id, endpoint: item.endpoint, other: item.other, side: item.side, sideLength });
      else groups.set(key, [{ edgeId: edge.id, endpoint: item.endpoint, other: item.other, side: item.side, sideLength }]);
    }
  }

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => sideAxisValue(a.other, a.side) - sideAxisValue(b.other, b.side) || a.edgeId.localeCompare(b.edgeId));
    const span = Math.max(0, list[0].sideLength - 16);
    const step = Math.min(24, span / Math.max(1, list.length - 1));
    const first = -step * (list.length - 1) / 2;
    list.forEach((item, i) => {
      const current = assigned.get(item.edgeId);
      if (!current) return;
      const offset = first + step * i;
      if (item.endpoint === "from") current.fromOffset = offset;
      else current.toOffset = offset;
    });
  }
  return assigned;
}

function endpointAndDescendants(index: ReturnType<typeof indexModel>, id: string): Set<string> {
  const excluded = new Set([id]);
  if (isGroup(index, id)) {
    for (const node of descendants(index, id)) excluded.add(node.id);
  }
  return excluded;
}

export function routeModelEdges(model: DiagramModel, options: { edgeIds?: string[]; all?: boolean; fallbackOnly?: boolean; maxExpansions?: number; totalExpansions?: number } = {}): DiagramModel {
  // Hidden links (implied by a shared-services band) are never drawn, so never routed.
  const selected = new Set((options.edgeIds ?? model.edges.filter((e) => options.all || e.route.length === 0).map((e) => e.id)).filter((id) => !model.edges.find((e) => e.id === id)?.hidden));
  if (selected.size === 0) return model;
  const budget = { remaining: options.totalExpansions ?? DEFAULT_TOTAL_EXPANSIONS };
  const index = indexModel(model);
  const leaves = leafNodes(model);
  const groupNodes = model.nodes.filter((n) => isGroup(index, n.id));
  const spread = spreadOffsets(model, selected);
  let changed = false;
  const edges = model.edges.map((edge) => {
    if (!selected.has(edge.id)) return edge;
    const from = index.byId.get(edge.from);
    const to = index.byId.get(edge.to);
    if (!from || !to) return edge;
    const excluded = new Set([...endpointAndDescendants(index, edge.from), ...endpointAndDescendants(index, edge.to)]);
    const allObstacles = leaves.filter((n) => !excluded.has(n.id)).map((n) => n.box);
    const obstacles = pruneObstacles(from.box, to.box, allObstacles, DEFAULT_MARGIN);
    const softObstacles = groupNodes.filter((n) => n.id !== edge.from && n.id !== edge.to && !isWithin(index, edge.from, n.id) && !isWithin(index, edge.to, n.id)).map((n) => expand(n.box, DEFAULT_MARGIN));
    const portOptions = spread.get(edge.id);
    const route = routeEdgeInternal(from.box, to.box, obstacles, { ...portOptions, softObstacles, fallbackOnly: options.fallbackOnly, maxExpansions: options.maxExpansions, budget });
    changed = true;
    return { ...edge, route };
  });
  return changed ? { ...model, edges } : model;
}
