/**
 * Clean-up for the connection routes D2's ELK layout returns. ELK routes most
 * edges orthogonally around nodes; edges it draws as straight diagonals
 * (typically between different containers) are rerouted as orthogonal
 * polylines that avoid leaf nodes.
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

const AXIS_TOLERANCE = 1.5;
/** Segments shorter than this are rounded corners, not real diagonals. */
const CORNER_MAX = 24;
const SPLITS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];

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
