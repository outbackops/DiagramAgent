/**
 * Post-processes D2-rendered SVG to convert curved connection paths
 * into orthogonal (right-angled) polylines with rounded corners.
 *
 * Key improvement: instead of routing through the geometric midpoint (which
 * causes lines to overlap with components), we sample the original Bezier
 * curves at multiple points. The Bezier control points encode D2's obstacle
 * avoidance routing — by following these sampled waypoints, the orthogonal
 * paths route around shapes instead of through them.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Sample a cubic Bezier curve at parameter t (0–1).
 */
function sampleBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * Parse an SVG path and sample all Bezier segments into waypoints.
 */
function samplePathWaypoints(pathData: string): Point[] {
  const tokens = pathData.trim().split(/[\s,]+/);
  const waypoints: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M" || cmd === "L") {
      cur = { x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) };
      waypoints.push({ ...cur });
      i += 3;
    } else if (cmd === "C") {
      const cp1 = { x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) };
      const cp2 = { x: parseFloat(tokens[i + 3]), y: parseFloat(tokens[i + 4]) };
      const end = { x: parseFloat(tokens[i + 5]), y: parseFloat(tokens[i + 6]) };
      // Sample at 5 points to capture the curve's avoidance trajectory
      for (const t of [0.2, 0.4, 0.6, 0.8]) {
        waypoints.push(sampleBezier(cur, cp1, cp2, end, t));
      }
      waypoints.push(end);
      cur = end;
      i += 7;
    } else if (cmd === "V") {
      cur = { x: cur.x, y: parseFloat(tokens[i + 1]) };
      waypoints.push({ ...cur });
      i += 2;
    } else if (cmd === "H") {
      cur = { x: parseFloat(tokens[i + 1]), y: cur.y };
      waypoints.push({ ...cur });
      i += 2;
    } else if (cmd === "Z") {
      i += 1;
    } else if (!isNaN(parseFloat(cmd))) {
      cur = { x: parseFloat(tokens[i]), y: parseFloat(tokens[i + 1]) };
      waypoints.push({ ...cur });
      i += 2;
    } else {
      i += 1;
    }
  }
  return waypoints;
}

/**
 * Simplify waypoints: keep only those where the direction changes significantly.
 */
function simplifyWaypoints(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [pts[0]];

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = pts[i];
    const next = pts[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    if (len1 < 1 || len2 < 1) continue;

    const cross = Math.abs(dx1 * dy2 - dy1 * dx2) / (len1 * len2);
    if (cross > 0.12) result.push(curr); // ~7° direction change
  }

  result.push(pts[pts.length - 1]);
  return result;
}

/**
 * Build an orthogonal SVG path through waypoints with rounded corners.
 */
function waypointsToOrthogonalPath(waypoints: Point[], r: number): string {
  if (waypoints.length < 2) return "";

  const start = waypoints[0];
  const end = waypoints[waypoints.length - 1];
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  // Straight lines
  if (dy < 3) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (dx < 3) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  // Build orthogonal segments: for each waypoint, go H then V
  const segs: Point[] = [start];
  for (let i = 1; i < waypoints.length; i++) {
    const prev = segs[segs.length - 1];
    const curr = waypoints[i];
    const segDx = Math.abs(curr.x - prev.x);
    const segDy = Math.abs(curr.y - prev.y);

    if (segDx < 3) {
      segs.push({ x: prev.x, y: curr.y });
    } else if (segDy < 3) {
      segs.push({ x: curr.x, y: prev.y });
    } else {
      // H then V
      segs.push({ x: curr.x, y: prev.y });
      segs.push({ x: curr.x, y: curr.y });
    }
  }

  // Dedup consecutive identical points
  const deduped: Point[] = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    const prev = deduped[deduped.length - 1];
    if (Math.abs(segs[i].x - prev.x) > 1 || Math.abs(segs[i].y - prev.y) > 1) {
      deduped.push(segs[i]);
    }
  }

  // Merge consecutive segments going the same direction
  const merged: Point[] = [deduped[0]];
  for (let i = 1; i < deduped.length; i++) {
    const a = merged.length >= 2 ? merged[merged.length - 2] : null;
    const b = merged[merged.length - 1];
    const c = deduped[i];
    if (a) {
      const abH = Math.abs(b.y - a.y) < 2; // a→b is horizontal
      const bcH = Math.abs(c.y - b.y) < 2; // b→c is horizontal
      const abV = Math.abs(b.x - a.x) < 2;
      const bcV = Math.abs(c.x - b.x) < 2;
      if ((abH && bcH) || (abV && bcV)) {
        // Same direction — skip the middle point
        merged[merged.length - 1] = c;
        continue;
      }
    }
    merged.push(c);
  }

  // Ensure endpoint
  const last = merged[merged.length - 1];
  if (Math.abs(last.x - end.x) > 2 || Math.abs(last.y - end.y) > 2) {
    merged.push(end);
  }

  if (merged.length < 2) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  // Build path with rounded corners at bends
  const parts: string[] = [`M ${merged[0].x} ${merged[0].y}`];

  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const curr = merged[i];
    const next = i < merged.length - 1 ? merged[i + 1] : null;

    if (!next) {
      parts.push(`L ${curr.x} ${curr.y}`);
      break;
    }

    // Check for 90° corner
    const hIn = Math.abs(curr.y - prev.y) < 2;
    const vIn = Math.abs(curr.x - prev.x) < 2;
    const hOut = Math.abs(next.y - curr.y) < 2;
    const vOut = Math.abs(next.x - curr.x) < 2;

    if ((hIn && vOut) || (vIn && hOut)) {
      const inDx = curr.x - prev.x;
      const inDy = curr.y - prev.y;
      const outDx = next.x - curr.x;
      const outDy = next.y - curr.y;
      const inLen = Math.sqrt(inDx * inDx + inDy * inDy);
      const outLen = Math.sqrt(outDx * outDx + outDy * outDy);
      const cr = Math.min(r, inLen / 2, outLen / 2);

      if (cr < 1) {
        parts.push(`L ${curr.x} ${curr.y}`);
        continue;
      }

      const inNx = inDx / inLen, inNy = inDy / inLen;
      const outNx = outDx / outLen, outNy = outDy / outLen;
      const cross = inNx * outNy - inNy * outNx;

      parts.push(`L ${curr.x - inNx * cr} ${curr.y - inNy * cr}`);
      parts.push(`A ${cr} ${cr} 0 0 ${cross > 0 ? 1 : 0} ${curr.x + outNx * cr} ${curr.y + outNy * cr}`);
    } else {
      parts.push(`L ${curr.x} ${curr.y}`);
    }
  }

  return parts.join(" ");
}

/**
 * Convert a Bezier connection path to an orthogonal path that follows
 * the original curve's routing (avoiding obstacles).
 */
function bezierToOrthogonal(pathData: string, cornerRadius: number = 8): string {
  const raw = samplePathWaypoints(pathData);
  if (raw.length < 2) return pathData;
  const simplified = simplifyWaypoints(raw);
  return waypointsToOrthogonalPath(simplified, cornerRadius);
}

/**
 * Post-process SVG to convert connection Bezier curves to orthogonal paths.
 */
export function convertConnectionsToOrthogonal(svgContent: string, cornerRadius: number = 8): string {
  return svgContent.replace(
    /<path\s+([^>]*?)d="(M[^"]+)"([^>]*?)>/g,
    (match, before: string, pathData: string, after: string) => {
      const attrs = before + after;
      if (!attrs.includes("connection")) return match;
      if (pathData.includes(" Z")) return match;
      if (!pathData.includes(" C ")) return match;
      const converted = bezierToOrthogonal(pathData, cornerRadius);
      return `<path ${before}d="${converted}"${after}>`;
    }
  );
}
