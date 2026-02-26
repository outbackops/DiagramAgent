/**
 * Converts D2's curved Bezier connections to clean orthogonal paths.
 *
 * Design principles:
 * 1. STRAIGHT lines unless a turn is absolutely necessary (different X AND Y)
 * 2. Minimum turns: at most 2 corners (H→V→H) for standard connections
 * 3. Parallel lines kept equidistant when sharing the same corridor
 * 4. Rounded corners at turns (8px radius default)
 */

interface Point { x: number; y: number }

interface ParsedConnection {
  start: Point;
  end: Point;
  pathData: string;
}

/**
 * Parse a Bezier path to extract just the start and end points.
 * These are the only points that matter — the route between them should be
 * the simplest possible orthogonal path.
 */
function parseEndpoints(pathData: string): { start: Point; end: Point } | null {
  const tokens = pathData.trim().split(/[\s,]+/);
  let first: Point | null = null;
  let last: Point | null = null;
  let cur: Point = { x: 0, y: 0 };
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M") {
      cur = { x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) };
      if (!first) first = { ...cur };
      last = { ...cur };
      i += 3;
    } else if (cmd === "L") {
      cur = { x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) };
      last = { ...cur };
      i += 3;
    } else if (cmd === "C") {
      cur = { x: parseFloat(tokens[i + 5]), y: parseFloat(tokens[i + 6]) };
      last = { ...cur };
      i += 7;
    } else if (cmd === "V") {
      cur = { x: cur.x, y: parseFloat(tokens[i + 1]) };
      last = { ...cur };
      i += 2;
    } else if (cmd === "H") {
      cur = { x: parseFloat(tokens[i + 1]), y: cur.y };
      last = { ...cur };
      i += 2;
    } else if (cmd === "Z") {
      i += 1;
    } else if (!isNaN(parseFloat(cmd))) {
      cur = { x: parseFloat(tokens[i]), y: parseFloat(tokens[i + 1]) };
      last = { ...cur };
      i += 2;
    } else {
      i += 1;
    }
  }

  if (!first || !last) return null;
  return { start: first, end: last };
}

/**
 * Build a clean path between two points.
 * - If nearly same Y (within threshold): STRAIGHT horizontal line
 * - If nearly same X: STRAIGHT vertical line
 * - Otherwise: H → V → H with midpoint X and rounded corners
 */
function buildCleanPath(
  start: Point,
  end: Point,
  midX: number,
  cornerRadius: number
): string {
  const dy = Math.abs(end.y - start.y);
  const dx = Math.abs(end.x - start.x);

  // Priority 1: Straight horizontal line
  // Keep lines straight when the slope is gentle (Y delta is small relative to X span).
  // D2 dagre connects from node edges so even same-row nodes have 20-80px Y diff.
  // Threshold: if the angle from horizontal is under ~18° (dy/dx < 0.33), go straight.
  if (dx > 30 && dy / dx < 0.33) {
    const avgY = (start.y + end.y) / 2;
    return `M ${start.x} ${avgY} L ${end.x} ${avgY}`;
  }

  // Priority 2: Straight vertical line (steep connections)
  if (dy > 30 && dx / dy < 0.33) {
    const avgX = (start.x + end.x) / 2;
    return `M ${avgX} ${start.y} L ${avgX} ${end.y}`;
  }

  // Priority 3: Single turn — H then V (or V then H)
  // Only if the midpoint would be very close to start or end X
  const distToStart = Math.abs(midX - start.x);
  const distToEnd = Math.abs(midX - end.x);

  if (distToStart < 30) {
    // Turn is near the start — just do V→H (vertical down, then horizontal)
    const r = Math.min(cornerRadius, dx / 2, dy / 2);
    const goRight = end.x > start.x;
    const goDown = end.y > start.y;
    const sweep = (goRight && goDown) || (!goRight && !goDown) ? 0 : 1;
    return [
      `M ${start.x} ${start.y}`,
      `L ${start.x} ${end.y - (goDown ? r : -r)}`,
      `A ${r} ${r} 0 0 ${sweep} ${start.x + (goRight ? r : -r)} ${end.y}`,
      `L ${end.x} ${end.y}`,
    ].join(" ");
  }

  if (distToEnd < 30) {
    // Turn is near the end — do H→V
    const r = Math.min(cornerRadius, dx / 2, dy / 2);
    const goRight = end.x > start.x;
    const goDown = end.y > start.y;
    const sweep = (goRight && goDown) || (!goRight && !goDown) ? 1 : 0;
    return [
      `M ${start.x} ${start.y}`,
      `L ${end.x - (goRight ? r : -r)} ${start.y}`,
      `A ${r} ${r} 0 0 ${sweep} ${end.x} ${start.y + (goDown ? r : -r)}`,
      `L ${end.x} ${end.y}`,
    ].join(" ");
  }

  // Priority 4: Standard H→V→H (3 segments, 2 corners)
  const r = Math.min(cornerRadius, Math.abs(midX - start.x) / 2, Math.abs(midX - end.x) / 2, dy / 2);

  if (r < 2) {
    // Too tight for arcs — sharp corners
    return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
  }

  const goRight = end.x > start.x;
  const goDown = end.y > start.y;
  const rX = goRight ? r : -r;
  const rY = goDown ? r : -r;
  const sweep1 = (goRight && goDown) || (!goRight && !goDown) ? 1 : 0;
  const sweep2 = 1 - sweep1;

  return [
    `M ${start.x} ${start.y}`,
    `L ${midX - rX} ${start.y}`,
    `A ${r} ${r} 0 0 ${sweep1} ${midX} ${start.y + rY}`,
    `L ${midX} ${end.y - rY}`,
    `A ${r} ${r} 0 0 ${sweep2} ${midX + rX} ${end.y}`,
    `L ${end.x} ${end.y}`,
  ].join(" ");
}

/**
 * Post-process SVG to convert connection curves to clean orthogonal paths.
 *
 * Two-pass approach:
 * 1. First pass: collect all connections and compute their midpoint X values
 * 2. Space out parallel midpoints so lines don't overlap
 * 3. Second pass: replace path data with clean orthogonal routes
 */
export function convertConnectionsToOrthogonal(svgContent: string, cornerRadius: number = 8): string {
  // First pass: find all connection paths and parse their endpoints
  const connectionRegex = /<path\s+([^>]*?)d="(M[^"]+)"([^>]*?)>/g;
  const connections: { fullMatch: string; before: string; pathData: string; after: string; parsed: { start: Point; end: Point } }[] = [];

  let regexMatch;
  while ((regexMatch = connectionRegex.exec(svgContent)) !== null) {
    const [fullMatch, before, pathData, after] = regexMatch;
    const attrs = before + after;
    if (!attrs.includes("connection")) continue;
    if (pathData.includes(" Z")) continue;       // Skip arrowheads
    if (!pathData.includes(" C ")) continue;      // Already straight

    const parsed = parseEndpoints(pathData);
    if (parsed) {
      connections.push({ fullMatch, before, pathData, after, parsed });
    }
  }

  if (connections.length === 0) return svgContent;

  // Group connections that need H→V→H routing by their general corridor
  // (connections with similar start.x and end.x ranges)
  // Assign midpoint X values with spacing to avoid overlap
  const SPACING = 16; // pixels between parallel vertical segments

  // Sort by midpoint X to assign slots
  const needsHVH = connections.filter(c => {
    const dy = Math.abs(c.parsed.end.y - c.parsed.start.y);
    return dy >= 20; // Only connections that need turns
  });

  // Group by approximate corridor (rounded midpoint X)
  const corridors = new Map<number, typeof needsHVH>();
  for (const conn of needsHVH) {
    const naturalMidX = Math.round((conn.parsed.start.x + conn.parsed.end.x) / 2);
    const bucket = Math.round(naturalMidX / 40) * 40; // Round to 40px buckets
    if (!corridors.has(bucket)) corridors.set(bucket, []);
    corridors.get(bucket)!.push(conn);
  }

  // Assign offset midpoints within each corridor
  const midXMap = new Map<string, number>();
  for (const [bucket, group] of corridors) {
    const total = group.length;
    const startOffset = -((total - 1) * SPACING) / 2;
    group.forEach((conn, idx) => {
      const offsetMidX = bucket + startOffset + idx * SPACING;
      midXMap.set(conn.pathData, offsetMidX);
    });
  }

  // Second pass: replace each connection path
  let result = svgContent;
  for (const conn of connections) {
    const { start, end } = conn.parsed;
    const midX = midXMap.get(conn.pathData) ?? (start.x + end.x) / 2;

    const newPath = buildCleanPath(start, end, midX, cornerRadius);
    const newElement = `<path ${conn.before}d="${newPath}"${conn.after}>`;
    result = result.replace(conn.fullMatch, newElement);
  }

  return result;
}
