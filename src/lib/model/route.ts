import { boxesOverlap, center, expand, polylineLength, segmentHitsBox, simplifyPolyline, unionBoxes } from "./geometry";
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
}

interface InternalRouteOptions extends RouteOptions {
  softObstacles?: Box[];
  softPenalty?: number;
}

const DEFAULT_MARGIN = 12;
const DEFAULT_BEND_PENALTY = 30;
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
  return [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

function addCoordinate(values: number[], value: number): void {
  if (Number.isFinite(value)) values.push(value);
}

function addMidlines(values: number[]): void {
  const sorted = uniqueSorted(values);
  for (let i = 1; i < sorted.length; i++) values.push((sorted[i - 1] + sorted[i]) / 2);
}

function pointKey(ix: number, iy: number, dir: Dir): string {
  return `${ix},${iy},${dir}`;
}

function pointInsideAny(p: Point, boxes: Box[]): boolean {
  return boxes.some((b) => p.x > b.x + EPSILON && p.x < right(b) - EPSILON && p.y > b.y + EPSILON && p.y < bottom(b) - EPSILON);
}

function segmentPenalty(a: Point, b: Point, hard: Box[], soft: Box[], softPenalty: number): number | null {
  for (const box of hard) {
    if (segmentHitsBox(a, b, box)) return null;
  }
  let penalty = 0;
  for (const box of soft) {
    if (segmentHitsBox(a, b, box)) penalty += softPenalty;
  }
  return penalty;
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

function searchGrid(start: Point, end: Point, startDir: Dir, endDir: Dir, hard: Box[], options: InternalRouteOptions): SearchResult | null {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const bendPenalty = options.bendPenalty ?? DEFAULT_BEND_PENALTY;
  const soft = options.softObstacles ?? [];
  const softPenalty = options.softPenalty ?? 60;
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
  const startIx = gridX.indexOf(start.x);
  const startIy = gridY.indexOf(start.y);
  const endIx = gridX.indexOf(end.x);
  const endIy = gridY.indexOf(end.y);
  if (startIx < 0 || startIy < 0 || endIx < 0 || endIy < 0) return null;

  const best = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap = new MinHeap<{ ix: number; iy: number; dir: Dir }>();
  const firstKey = pointKey(startIx, startIy, startDir);
  best.set(firstKey, 0);
  heap.push({ ix: startIx, iy: startIy, dir: startDir }, Math.abs(start.x - end.x) + Math.abs(start.y - end.y));

  let endKey: string | null = null;
  while (heap.length > 0) {
    const current = heap.pop();
    if (!current) break;
    const key = pointKey(current.ix, current.iy, current.dir);
    const cost = best.get(key);
    if (cost === undefined) continue;
    if (current.ix === endIx && current.iy === endIy) {
      endKey = key;
      break;
    }

    const neighbours = [
      { ix: current.ix - 1, iy: current.iy, dir: "left" as const },
      { ix: current.ix + 1, iy: current.iy, dir: "right" as const },
      { ix: current.ix, iy: current.iy - 1, dir: "up" as const },
      { ix: current.ix, iy: current.iy + 1, dir: "down" as const },
    ];
    const a = { x: gridX[current.ix], y: gridY[current.iy] };
    for (const n of neighbours) {
      if (n.ix < 0 || n.iy < 0 || n.ix >= gridX.length || n.iy >= gridY.length) continue;
      const b = { x: gridX[n.ix], y: gridY[n.iy] };
      if (pointInsideAny(b, hard)) continue;
      const penalty = segmentPenalty(a, b, hard, soft, softPenalty);
      if (penalty === null) continue;
      const turnCost = current.dir === n.dir ? 0 : bendPenalty;
      const nextCost = cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + turnCost + penalty;
      const nextKey = pointKey(n.ix, n.iy, n.dir);
      if (nextCost >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, nextCost);
      prev.set(nextKey, key);
      const heuristic = Math.abs(b.x - end.x) + Math.abs(b.y - end.y);
      heap.push(n, nextCost + heuristic);
    }
  }

  if (!endKey) return null;
  const path: Point[] = [];
  let key: string | undefined = endKey;
  while (key) {
    const [ix, iy] = key.split(",", 2).map(Number);
    path.push({ x: gridX[ix], y: gridY[iy] });
    key = prev.get(key);
  }
  path.reverse();
  const lastDir = endKey.split(",")[2] as Dir;
  const cost = (best.get(endKey) ?? polylineLength(path)) + (lastDir === endDir ? 0 : bendPenalty);
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

export function routeModelEdges(model: DiagramModel, options: { edgeIds?: string[]; all?: boolean } = {}): DiagramModel {
  const selected = new Set(options.edgeIds ?? model.edges.filter((e) => options.all || e.route.length === 0).map((e) => e.id));
  if (selected.size === 0) return model;
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
    const route = routeEdgeInternal(from.box, to.box, obstacles, { ...portOptions, softObstacles });
    changed = true;
    return { ...edge, route };
  });
  return changed ? { ...model, edges } : model;
}
