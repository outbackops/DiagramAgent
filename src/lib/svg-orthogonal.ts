/**
 * Post-processes D2-rendered SVG to convert curved connection paths
 * into orthogonal (right-angled) polylines with rounded corners.
 * 
 * D2 renders connections as cubic Bezier curves (C commands in SVG path data).
 * This module converts them to horizontal/vertical-only segments (L commands)
 * with small arc corners (A commands) for a clean architectural diagram look.
 */

/**
 * Convert a cubic Bezier path to an orthogonal path with rounded corners.
 * Input:  "M x1 y1 C cx1 cy1 cx2 cy2 x2 y2 [C ... ...]"
 * Output: "M x1 y1 L ... A ... L ... x2 y2" (right-angled with rounded corners)
 */
function bezierToOrthogonal(pathData: string, cornerRadius: number = 8): string {
  // Parse the path to extract meaningful points
  const tokens = pathData.trim().split(/[\s,]+/);
  const points: { x: number; y: number }[] = [];

  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i];
    if (cmd === "M" || cmd === "L") {
      points.push({ x: parseFloat(tokens[i + 1]), y: parseFloat(tokens[i + 2]) });
      i += 3;
    } else if (cmd === "C") {
      // Cubic Bezier: C cx1 cy1 cx2 cy2 x y — take the endpoint
      points.push({ x: parseFloat(tokens[i + 5]), y: parseFloat(tokens[i + 6]) });
      i += 7;
    } else if (cmd === "V") {
      const lastPt = points[points.length - 1];
      points.push({ x: lastPt?.x || 0, y: parseFloat(tokens[i + 1]) });
      i += 2;
    } else if (cmd === "H") {
      const lastPt = points[points.length - 1];
      points.push({ x: parseFloat(tokens[i + 1]), y: lastPt?.y || 0 });
      i += 2;
    } else if (cmd === "Z") {
      i += 1;
    } else if (!isNaN(parseFloat(cmd))) {
      // Implicit continuation of previous command
      // Could be coordinates after M or L
      points.push({ x: parseFloat(tokens[i]), y: parseFloat(tokens[i + 1]) });
      i += 2;
    } else {
      i += 1; // skip unknown
    }
  }

  if (points.length < 2) return pathData; // Can't convert

  const start = points[0];
  const end = points[points.length - 1];

  // If start and end are very close on one axis, it's already a straight line
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  if (dy < 2) {
    // Horizontal line — keep as-is
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  if (dx < 2) {
    // Vertical line — keep as-is
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  // Build orthogonal route: go horizontal to midpoint, then vertical, then horizontal
  const midX = (start.x + end.x) / 2;
  const r = Math.min(cornerRadius, dx / 4, dy / 2);

  // Determine direction
  const goingRight = end.x > start.x;
  const goingDown = end.y > start.y;

  const rX = goingRight ? r : -r;
  const rY = goingDown ? r : -r;
  const sweepH2V = (goingRight && goingDown) || (!goingRight && !goingDown) ? 1 : 0;
  const sweepV2H = 1 - sweepH2V;

  // Path: horizontal → rounded corner → vertical → rounded corner → horizontal
  return [
    `M ${start.x} ${start.y}`,
    `L ${midX - rX} ${start.y}`,
    `A ${r} ${r} 0 0 ${sweepH2V} ${midX} ${start.y + rY}`,
    `L ${midX} ${end.y - rY}`,
    `A ${r} ${r} 0 0 ${sweepV2H} ${midX + rX} ${end.y}`,
    `L ${end.x} ${end.y}`,
  ].join(" ");
}

/**
 * Check if a path is a connection path (not a shape fill/stroke).
 * Connection paths: start with M, contain C/L, don't end with Z (not closed shapes).
 * Shape paths: typically have Z (closed) or are part of shape groups.
 */
function isConnectionPath(pathData: string, parentClasses: string): boolean {
  // Only process paths inside connection groups
  if (parentClasses.includes("connection")) return true;
  return false;
}

/**
 * Post-process an SVG string to convert connection Bezier curves to orthogonal paths.
 */
export function convertConnectionsToOrthogonal(svgContent: string, cornerRadius: number = 8): string {
  // D2 renders connection paths as <path> elements with class="connection stroke-..."
  // The d="" attribute may appear before or after the class attribute.
  // We match any <path> with both a "connection" class and a d="" with Bezier C commands.
  return svgContent.replace(
    /<path\s+([^>]*?)d="(M[^"]+)"([^>]*?)>/g,
    (match, before: string, pathData: string, after: string) => {
      const fullAttrs = before + after;
      // Only process paths with "connection" in their class
      if (!fullAttrs.includes("connection")) return match;
      // Skip arrowhead/marker paths (closed shapes with Z)
      if (pathData.includes(" Z")) return match;
      // Skip paths that are already straight (no C commands)
      if (!pathData.includes(" C ")) return match;

      const converted = bezierToOrthogonal(pathData, cornerRadius);
      return `<path ${before}d="${converted}"${after}>`;
    }
  );
}
