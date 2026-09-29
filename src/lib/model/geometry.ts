import type { Box, Point } from "./types";

/** Geometry helpers shared by the model modules. All boxes are absolute. */

export const right = (b: Box) => b.x + b.w;
export const bottom = (b: Box) => b.y + b.h;
export const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function expand(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 };
}

export function translate(b: Box, dx: number, dy: number): Box {
  return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
}

/** Smallest box containing all the given boxes, or null for none. */
export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Whether `outer` fully contains `inner`. */
export function containsBox(outer: Box, inner: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

export function containsPoint(b: Box, p: Point, slack = 0): boolean {
  return p.x >= b.x - slack && p.x <= right(b) + slack && p.y >= b.y - slack && p.y <= bottom(b) + slack;
}

/** Whether two boxes overlap by a positive area (touching edges don't count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

/** Whether the segment p1–p2 passes through the interior of `b`. */
export function segmentHitsBox(p1: Point, p2: Point, b: Box): boolean {
  // Liang–Barsky clipping against the open box.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, p1.x - b.x)) return false;
  if (!clip(dx, right(b) - p1.x)) return false;
  if (!clip(-dy, p1.y - b.y)) return false;
  if (!clip(dy, bottom(b) - p1.y)) return false;
  return t1 - t0 > 1e-9;
}

/** Whether any segment of the polyline passes through the interior of `b`. */
export function polylineHitsBox(points: Point[], b: Box): boolean {
  for (let i = 1; i < points.length; i++) {
    if (segmentHitsBox(points[i - 1], points[i], b)) return true;
  }
  return false;
}

/** Drops repeated and collinear points so a polyline keeps only its corners. */
export function simplifyPolyline(points: Point[], tolerance = 0.5): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= tolerance && Math.abs(last.y - p.y) <= tolerance) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) <= tolerance && Math.abs(b.x - p.x) <= tolerance) ||
        (Math.abs(a.y - b.y) <= tolerance && Math.abs(b.y - p.y) <= tolerance);
      if (collinear) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

/** Midpoint of the longest segment: a stable, readable spot for an edge label. */
export function longestSegmentMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let best = { len: -1, mid: points[0] };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best.len) best = { len, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best.mid;
}
