/**
 * Post-processes D2-rendered SVG to convert curved Bezier connections
 * into clean orthogonal (right-angled) paths with rounded corners.
 *
 * Strategy: use the SIMPLEST possible route between start and end points.
 * - Same Y: straight horizontal line
 * - Same X: straight vertical line
 * - Different X and Y: 3-segment H→V→H route through midpoint
 *
 * Only adds extra waypoints when the original Bezier significantly deviates
 * from a straight line (indicating the layout engine routed around an obstacle).
 */

interface Point { x: number; y: number }

/** Sample a cubic Bezier at parameter t. */
function bezierAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };
}

/** Max perpendicular deviation of a Bezier from the straight line between its endpoints. */
function bezierDeviation(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return 0;

  let maxDev = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const pt = bezierAt(p0, p1, p2, p3, t);
    // Perpendicular distance from point to line p0→p3
    const dev = Math.abs((pt.x - p0.x) * dy - (pt.y - p0.y) * dx) / len;
    maxDev = Math.max(maxDev, dev);
  }
  return maxDev;
}

/** Parse path data, extract start/end points and check if Bezier deviates significantly. */
function parsePath(pathData: string): { start: Point; end: Point; needsDetour: boolean; detourY: number } | null {
  const tokens = pathData.trim().split(/[\s,]+/);
  const allEndpoints: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let totalDeviation = 0;
  let detourYSum = 0;
  let bezierCount = 0;
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M") {
      cur = { x: parseFloat(tokens[i+1]), y: parseFloat(tokens[i+2]) };
      allEndpoints.push({ ...cur });
      i += 3;
    } else if (cmd === "L") {
      cur = { x: parseFloat(tokens[i+1]), y: parseFloat(tokens[i+2]) };
      allEndpoints.push({ ...cur });
      i += 3;
    } else if (cmd === "C") {
      const cp1 = { x: parseFloat(tokens[i+1]), y: parseFloat(tokens[i+2]) };
      const cp2 = { x: parseFloat(tokens[i+3]), y: parseFloat(tokens[i+4]) };
      const end = { x: parseFloat(tokens[i+5]), y: parseFloat(tokens[i+6]) };
      const dev = bezierDeviation(cur, cp1, cp2, end);
      totalDeviation = Math.max(totalDeviation, dev);
      // Track the midpoint Y to know where the detour goes
      const midPt = bezierAt(cur, cp1, cp2, end, 0.5);
      detourYSum += midPt.y;
      bezierCount++;
      cur = end;
      allEndpoints.push({ ...cur });
      i += 7;
    } else if (cmd === "V") {
      cur = { x: cur.x, y: parseFloat(tokens[i+1]) };
      allEndpoints.push({ ...cur });
      i += 2;
    } else if (cmd === "H") {
      cur = { x: parseFloat(tokens[i+1]), y: cur.y };
      allEndpoints.push({ ...cur });
      i += 2;
    } else if (cmd === "Z") {
      i += 1;
    } else if (!isNaN(parseFloat(cmd))) {
      cur = { x: parseFloat(tokens[i]), y: parseFloat(tokens[i+1]) };
      allEndpoints.push({ ...cur });
      i += 2;
    } else {
      i += 1;
    }
  }

  if (allEndpoints.length < 2) return null;

  return {
    start: allEndpoints[0],
    end: allEndpoints[allEndpoints.length - 1],
    needsDetour: totalDeviation > 15, // Only detour if Bezier swings > 15px from straight line
    detourY: bezierCount > 0 ? detourYSum / bezierCount : (allEndpoints[0].y + allEndpoints[allEndpoints.length-1].y) / 2,
  };
}

/** Build a clean orthogonal SVG path with rounded corners. */
function buildOrthogonalPath(start: Point, end: Point, r: number, detourY?: number): string {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  // Case 1: Nearly horizontal — straight line
  if (dy < 4) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  // Case 2: Nearly vertical — straight line
  if (dx < 4) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  // Case 3: Need H→V→H route
  // Use detourY if provided (from Bezier deviation), otherwise route through midpoint X
  const midX = detourY !== undefined
    ? (start.x + end.x) / 2  // Standard midpoint
    : (start.x + end.x) / 2;

  const cr = Math.min(r, dx / 4, dy / 2);
  if (cr < 2) {
    // Too tight for arcs — just do sharp corners
    return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
  }

  const goingRight = end.x > start.x;
  const goingDown = end.y > start.y;
  const rX = goingRight ? cr : -cr;
  const rY = goingDown ? cr : -cr;

  // Sweep flags for the two corners
  const sweep1 = (goingRight && goingDown) || (!goingRight && !goingDown) ? 1 : 0;
  const sweep2 = 1 - sweep1;

  return [
    `M ${start.x} ${start.y}`,
    `L ${midX - rX} ${start.y}`,
    `A ${cr} ${cr} 0 0 ${sweep1} ${midX} ${start.y + rY}`,
    `L ${midX} ${end.y - rY}`,
    `A ${cr} ${cr} 0 0 ${sweep2} ${midX + rX} ${end.y}`,
    `L ${end.x} ${end.y}`,
  ].join(" ");
}

/** Build a 5-segment detour path: H→V→H→V→H (goes around an obstacle). */
function buildDetourPath(start: Point, end: Point, detourY: number, r: number): string {
  const dx = Math.abs(end.x - start.x);
  const dy1 = Math.abs(detourY - start.y);
  const dy2 = Math.abs(end.y - detourY);

  // If detour Y is very close to start or end Y, fall back to simple route
  if (dy1 < 8 || dy2 < 8) {
    return buildOrthogonalPath(start, end, r);
  }

  const x1 = start.x + (end.x - start.x) * 0.33;
  const x2 = start.x + (end.x - start.x) * 0.67;
  const cr = Math.min(r, dx / 6, dy1 / 2, dy2 / 2);

  if (cr < 2) {
    // Too tight — sharp corners
    return `M ${start.x} ${start.y} L ${x1} ${start.y} L ${x1} ${detourY} L ${x2} ${detourY} L ${x2} ${end.y} L ${end.x} ${end.y}`;
  }

  // Build with 4 rounded corners
  const parts: string[] = [`M ${start.x} ${start.y}`];

  // Corner 1: H→V at (x1, start.y)
  const down1 = detourY > start.y;
  parts.push(`L ${x1 - (end.x > start.x ? cr : -cr)} ${start.y}`);
  parts.push(`A ${cr} ${cr} 0 0 ${down1 ? 1 : 0} ${x1} ${start.y + (down1 ? cr : -cr)}`);

  // Vertical to detourY
  parts.push(`L ${x1} ${detourY - (down1 ? cr : -cr)}`);

  // Corner 2: V→H at (x1, detourY)
  parts.push(`A ${cr} ${cr} 0 0 ${down1 ? 0 : 1} ${x1 + (end.x > start.x ? cr : -cr)} ${detourY}`);

  // Horizontal to x2
  parts.push(`L ${x2 - (end.x > start.x ? cr : -cr)} ${detourY}`);

  // Corner 3: H→V at (x2, detourY)
  const up2 = end.y < detourY;
  parts.push(`A ${cr} ${cr} 0 0 ${up2 ? 1 : 0} ${x2} ${detourY + (up2 ? -cr : cr)}`);

  // Vertical to end.y
  parts.push(`L ${x2} ${end.y - (up2 ? -cr : cr)}`);

  // Corner 4: V→H at (x2, end.y)
  parts.push(`A ${cr} ${cr} 0 0 ${up2 ? 0 : 1} ${x2 + (end.x > start.x ? cr : -cr)} ${end.y}`);

  // Final horizontal
  parts.push(`L ${end.x} ${end.y}`);

  return parts.join(" ");
}

/** Convert a single Bezier path to a clean orthogonal path. */
function bezierToOrthogonal(pathData: string, cornerRadius: number): string {
  const parsed = parsePath(pathData);
  if (!parsed) return pathData;

  const { start, end, needsDetour, detourY } = parsed;

  if (needsDetour) {
    return buildDetourPath(start, end, detourY, cornerRadius);
  }

  return buildOrthogonalPath(start, end, cornerRadius);
}

/** Post-process SVG: convert connection Bezier curves to orthogonal paths. */
export function convertConnectionsToOrthogonal(svgContent: string, cornerRadius: number = 8): string {
  return svgContent.replace(
    /<path\s+([^>]*?)d="(M[^"]+)"([^>]*?)>/g,
    (match, before: string, pathData: string, after: string) => {
      const attrs = before + after;
      if (!attrs.includes("connection")) return match;
      if (pathData.includes(" Z")) return match;       // Skip arrowheads
      if (!pathData.includes(" C ")) return match;      // Already straight

      const converted = bezierToOrthogonal(pathData, cornerRadius);
      return `<path ${before}d="${converted}"${after}>`;
    }
  );
}
