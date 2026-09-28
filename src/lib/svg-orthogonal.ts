import * as cheerio from "cheerio";

/**
 * Post-process D2 (ELK) SVG connections into clean orthogonal routes.
 *
 * ELK already routes most edges orthogonally around nodes; those are kept
 * as-is. Edges ELK draws as straight diagonals (typically between different
 * containers) are rerouted as orthogonal polylines that avoid leaf nodes,
 * and their labels (plus the mask cut-out D2 uses to hide the line under a
 * label) are moved onto the new route.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OrthogonalizeOptions {
  /** Leaf-node boxes to route around. Falls back to rects found in the SVG. */
  obstacles?: Rect[];
}

export interface OrthogonalizeResult {
  svg: string;
  /** Final route per connection id (e.g. "Cloud.(App -> DB)[0]"). */
  routes: Map<string, Point[]>;
}

const AXIS_TOLERANCE = 1.5;
/** Segments shorter than this are rounded corners, not real diagonals. */
const CORNER_MAX = 24;
const SPLITS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];

/** All vertices of a path: M/L/H/V points plus the end points of C/Q/S/T curves. */
export function parseVertices(pathData: string): Point[] {
  const tokens = pathData.trim().match(/[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const points: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let cmd = "M";
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const push = (p: Point) => {
    cur = p;
    points.push(p);
  };

  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case "M":
      case "L":
      case "T":
        push({ x: num(), y: num() });
        break;
      case "H":
        push({ x: num(), y: cur.y });
        break;
      case "V":
        push({ x: cur.x, y: num() });
        break;
      case "C":
        i += 4;
        push({ x: num(), y: num() });
        break;
      case "S":
      case "Q":
        i += 2;
        push({ x: num(), y: num() });
        break;
      case "A":
        i += 5;
        push({ x: num(), y: num() });
        break;
      case "Z":
      case "z":
        break;
      default:
        // Relative commands are not produced by D2; skip a token to stay in sync.
        i++;
    }
    if (cmd === "Z" || cmd === "z") i++;
    if (points.some((p) => Number.isNaN(p.x) || Number.isNaN(p.y))) return [];
  }
  return points;
}

export function isOrthogonalRoute(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dx <= AXIS_TOLERANCE || dy <= AXIS_TOLERANCE) continue;
    if (Math.hypot(dx, dy) <= CORNER_MAX) continue;
    return false;
  }
  return true;
}

function segmentHitsRect(p1: Point, p2: Point, r: Rect): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  return !(maxX <= r.x || minX >= r.x + r.w || maxY <= r.y || minY >= r.y + r.h);
}

/** Number of (shrunken) obstacles an axis-aligned polyline passes through. */
export function countObstacleHits(points: Point[], obstacles: Rect[], inset = 5): number {
  let hits = 0;
  for (const obs of obstacles) {
    const core = { x: obs.x + inset, y: obs.y + inset, w: obs.w - inset * 2, h: obs.h - inset * 2 };
    if (core.w <= 0 || core.h <= 0) continue;
    for (let i = 1; i < points.length; i++) {
      if (segmentHitsRect(points[i - 1], points[i], core)) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

function containsPoint(r: Rect, p: Point, slack = 2): boolean {
  return p.x >= r.x - slack && p.x <= r.x + r.w + slack && p.y >= r.y - slack && p.y <= r.y + r.h + slack;
}

/** Best orthogonal (H-V-H or V-H-V) route between two points, avoiding obstacles where possible. */
export function routeOrthogonal(start: Point, end: Point, obstacles: Rect[]): Point[] {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const preferHorizontal = dx > dy;
  let best: { points: Point[]; cost: number } | null = null;

  for (const t of SPLITS) {
    const midX = start.x + (end.x - start.x) * t;
    const midY = start.y + (end.y - start.y) * t;
    const candidates: Array<{ points: Point[]; horizontalFirst: boolean }> = [
      { points: [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end], horizontalFirst: true },
      { points: [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end], horizontalFirst: false },
    ];
    for (const c of candidates) {
      const cost =
        countObstacleHits(c.points, obstacles) * 1000 + (c.horizontalFirst === preferHorizontal ? 0 : 5) + Math.abs(t - 0.5) * 10;
      if (!best || cost < best.cost) best = { points: c.points, cost };
    }
  }
  return best!.points;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const toPath = (points: Point[]) => `M ${fmt(points[0].x)} ${fmt(points[0].y)} ` + points.slice(1).map((p) => `L ${fmt(p.x)} ${fmt(p.y)}`).join(" ");

function longestSegmentMidpoint(points: Point[]): Point {
  let best = { len: -1, mid: points[0] };
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (len > best.len) best = { len, mid: { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 } };
  }
  return best.mid;
}

/** D2 encodes the element id as a base64 class on the connection's group. */
function connectionId(classAttr: string | undefined): string | null {
  for (const token of (classAttr ?? "").split(/\s+/)) {
    if (!token || /^(connection|stroke-|fill-|shape|text)/.test(token)) continue;
    try {
      const decoded = Buffer.from(token, "base64").toString("utf8").replace(/&gt;/g, ">").replace(/&lt;/g, "<");
      if (/\(.+\)\[\d+\]$/.test(decoded)) return decoded;
    } catch {
      // not base64
    }
  }
  return null;
}

/** Rects found in the SVG, used when the caller has no layout information. */
function svgObstacles($: cheerio.CheerioAPI): Rect[] {
  const obstacles: Rect[] = [];
  $("g rect").each((_, el) => {
    const $el = $(el);
    const w = parseFloat($el.attr("width") || "0");
    const h = parseFloat($el.attr("height") || "0");
    // Ignore tiny decorations and huge rects that wrap whole regions.
    if (w > 20 && h > 20 && w < 2000 && h < 2000) {
      obstacles.push({ x: parseFloat($el.attr("x") || "0"), y: parseFloat($el.attr("y") || "0"), w, h });
    }
  });
  return obstacles;
}

type Selection = ReturnType<cheerio.CheerioAPI>;

/** Move a rerouted edge's label, and the mask cut-out hiding the line under it, onto the new route. */
function moveLabel($path: Selection, route: Point[], cutouts: Selection[]) {
  const $text = $path.siblings("text").first();
  if ($text.length === 0) return;
  const oldX = parseFloat($text.attr("x") ?? "NaN");
  const oldY = parseFloat($text.attr("y") ?? "NaN");
  if (Number.isNaN(oldX) || Number.isNaN(oldY)) return;
  const fontSize = parseFloat(/font-size:\s*([\d.]+)px/.exec($text.attr("style") ?? "")?.[1] ?? "16");
  const mid = longestSegmentMidpoint(route);
  const newX = mid.x;
  const newY = mid.y + fontSize * 0.375;
  $text.attr("x", fmt(newX));
  $text.attr("y", fmt(newY));

  const cutout = cutouts.find((r) => {
    const x = parseFloat(r.attr("x") ?? "NaN");
    const y = parseFloat(r.attr("y") ?? "NaN");
    const w = parseFloat(r.attr("width") ?? "0");
    const h = parseFloat(r.attr("height") ?? "0");
    return oldX >= x && oldX <= x + w && oldY - fontSize / 2 >= y && oldY - fontSize / 2 <= y + h;
  });
  if (cutout) {
    cutout.attr("x", fmt(parseFloat(cutout.attr("x")!) + (newX - oldX)));
    cutout.attr("y", fmt(parseFloat(cutout.attr("y")!) + (newY - oldY)));
  }
}

/**
 * Recalculate the viewBox to tighten whitespace.
 */
function maximizeLayout($: cheerio.CheerioAPI): void {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;
  let found = false;

  $("rect, circle, ellipse").each((_, el) => {
    const $el = $(el);
    let box: Rect | null = null;
    if (el.tagName === "rect") {
      const w = parseFloat($el.attr("width") || "0");
      const h = parseFloat($el.attr("height") || "0");
      if (w > 0 && h > 0) box = { x: parseFloat($el.attr("x") || "0"), y: parseFloat($el.attr("y") || "0"), w, h };
    } else if (el.tagName === "circle") {
      const r = parseFloat($el.attr("r") || "0");
      const cx = parseFloat($el.attr("cx") || "0");
      const cy = parseFloat($el.attr("cy") || "0");
      if (r > 0) box = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
    }
    if (box) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
      found = true;
    }
  });

  if (found && minX < Infinity) {
    const padding = 20;
    const svg = $("svg");
    svg.removeAttr("width");
    svg.removeAttr("height");
    svg.attr("viewBox", `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`);
    svg.attr("preserveAspectRatio", "xMidYMid meet");
    svg.attr("style", "max-width: 100%; height: auto;");
  }
}

export function orthogonalizeConnections(svg: string, options: OrthogonalizeOptions = {}): OrthogonalizeResult {
  const $ = cheerio.load(svg, { xmlMode: true });
  const obstacles = options.obstacles ?? svgObstacles($);
  const cutouts = $("mask rect[fill='black']")
    .toArray()
    .map((el) => $(el));
  const routes = new Map<string, Point[]>();

  let connections = $("path.connection");
  if (connections.length === 0) connections = $("g.connection path");
  if (connections.length === 0) connections = $("path[fill='none'][stroke]");

  connections.each((_, el) => {
    const $path = $(el);
    const d = $path.attr("d");
    if (!d) return;
    const vertices = parseVertices(d);
    if (vertices.length < 2) return;
    const id = connectionId($path.parent().attr("class"));

    if (isOrthogonalRoute(vertices)) {
      if (id) routes.set(id, vertices);
      return;
    }

    const start = vertices[0];
    const end = vertices[vertices.length - 1];
    // The edge's own endpoints sit on its source/target nodes; don't route around those.
    const foreign = obstacles.filter((o) => !containsPoint(o, start) && !containsPoint(o, end));
    const route = routeOrthogonal(start, end, foreign);
    $path.attr("d", toPath(route));
    $path.attr("stroke-linejoin", "round");
    moveLabel($path, route, cutouts);
    if (id) routes.set(id, route);
  });

  maximizeLayout($);
  return { svg: $.xml(), routes };
}

/** Backwards-compatible wrapper returning only the SVG. */
export function convertConnectionsToOrthogonal(svg: string): string {
  return orthogonalizeConnections(svg).svg;
}
