import * as cheerio from "cheerio";

/**
 * Converts D2's curved Bezier connections to clean orthogonal paths.
 * Uses cheerio for robust SVG parsing.
 */

interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

/**
 * Parse a Bezier path to extract just the start and end points.
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
    } else if (cmd === "Q") {
        cur = { x: parseFloat(tokens[i + 3]), y: parseFloat(tokens[i + 4]) };
        last = { ...cur };
        i += 5;
    } else if (cmd === "V") {
      // V y
      cur = { x: cur.x, y: parseFloat(tokens[i + 1]) };
      last = { ...cur };
      i += 2;
    } else if (cmd === "H") {
      // H x
      cur = { x: parseFloat(tokens[i + 1]), y: cur.y };
      last = { ...cur };
      i += 2;
    } else if (cmd === "Z") {
      i += 1;
    } else if (!isNaN(parseFloat(cmd))) {
      // Implicit L or M continuation
      cur = { x: parseFloat(tokens[i]), y: parseFloat(tokens[i + 1]) };
      last = { ...cur };
      i += 2;
    } else {
      // Unknown command, skip 1 token and hope for sync
      i += 1;
    }
  }

  if (!first || !last) return null;
  return { start: first, end: last };
}

/**
 * Extract bounding boxes of all nodes (potential obstacles).
 */
function getObstacles($: cheerio.CheerioAPI): Rect[] {
  const obstacles: Rect[] = [];
  // Look for rects that are likely node backgrounds (often inside groups with IDs or classes)
  // D2 structure: <g class="node"> <rect ... /> </g>
  
  $("g rect").each((_, el) => {
    const $el = $(el);
    const w = parseFloat($el.attr("width") || "0");
    const h = parseFloat($el.attr("height") || "0");
    
    // Ignore tiny rects (stubs, decorations, connection markers)
    // Also ignore huge rects that likely wrap the whole diagram
    if (w > 20 && h > 20 && w < 2000 && h < 2000) {
      const x = parseFloat($el.attr("x") || "0");
      const y = parseFloat($el.attr("y") || "0");
      obstacles.push({ x, y, w, h });
    }
  });

  return obstacles;
}

/**
 * Check if a line segment intersects a rectangle.
 */
function segmentIntersectsRect(p1: Point, p2: Point, r: Rect): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  if (maxX <= r.x || minX >= r.x + r.w || maxY <= r.y || minY >= r.y + r.h) {
    return false;
  }
  
  return true;
}

/**
 * Count how many obstacles a polyline path intersects.
 * Path format: "M x y L x y ..."
 */
function countIntersections(pathSegments: Point[], obstacles: Rect[]): number {
  let count = 0;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const p1 = pathSegments[i];
    const p2 = pathSegments[i+1];
    
    for (const obs of obstacles) {
      // Heuristic: shrink obstacle slightly to avoid touching edges counting
      // Only penalize if it goes *through* the core of the obstacle
      const shrunken = { x: obs.x + 5, y: obs.y + 5, w: obs.w - 10, h: obs.h - 10 };
      if (shrunken.w > 0 && shrunken.h > 0 && segmentIntersectsRect(p1, p2, shrunken)) {
        count++;
      }
    }
  }
  return count;
}


/**
 * Build a simple orthogonal path, trying to avoid obstacles.
 */
function buildOrthogonalPath(
  start: Point,
  end: Point,
  obstacles: Rect[]
): string {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // Path 1: H -> V -> H  (Horizontal first)
  // M sL midX sY L midX eY L eX eY
  const p1_pts = [
      {x: start.x, y: start.y},
      {x: midX, y: start.y},
      {x: midX, y: end.y},
      {x: end.x, y: end.y}
  ];
  const cost1 = countIntersections(p1_pts, obstacles);
  
  // Path 2: V -> H -> V (Vertical first)
  // M sL sX midY L eX midY L eX eY
  const p2_pts = [
      {x: start.x, y: start.y},
      {x: start.x, y: midY},
      {x: end.x, y: midY},
      {x: end.x, y: end.y}
  ];
  const cost2 = countIntersections(p2_pts, obstacles);

  // Helper to build path string
  const toPath = (pts: Point[]) => `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");

  // Preference logic:
  // 0. Pick path with 0 cost if possible
  if (cost1 === 0 && cost2 > 0) return toPath(p1_pts);
  if (cost2 === 0 && cost1 > 0) return toPath(p2_pts);
  
  // 1. If equal cost, prefer major axis direction
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  
  if (dx > dy) {
      // Horizontal separation > Vertical -> Prefer H-first (p1) unless it is blocked more
      return cost1 <= cost2 ? toPath(p1_pts) : toPath(p2_pts);
  } else {
      // Vertical separation > Horizontal -> Prefer V-first (p2)
      return cost2 <= cost1 ? toPath(p2_pts) : toPath(p1_pts);
  }
}

/**
 * Recalculate viewBox to tighten whitespace.
 */
function maximizeLayout($: cheerio.CheerioAPI): void {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  let found = false;

  $("rect, circle, ellipse, path, text").each((_, el) => {
    // Determine bounding box of element
    const $el = $(el);
    let box: Rect | null = null;
    
    // For rects, it is easy
    if (el.tagName === "rect") {
       const w = parseFloat($el.attr("width") || "0");
       const h = parseFloat($el.attr("height") || "0");
       if (w > 0 && h > 0) {
           box = {
             x: parseFloat($el.attr("x") || "0"),
             y: parseFloat($el.attr("y") || "0"),
             w, h
           };
       }
    }
    // For circles: x = cx-r, y = cy-r, w=2r, h=2r
    else if (el.tagName === "circle") {
        const r = parseFloat($el.attr("r") || "0");
        const cx = parseFloat($el.attr("cx") || "0");
        const cy = parseFloat($el.attr("cy") || "0");
        if (r > 0) {
            box = { x: cx-r, y: cy-r, w: 2*r, h: 2*r };
        }
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
    const w = (maxX - minX) + (padding * 2);
    const h = (maxY - minY) + (padding * 2);
    const x = minX - padding;
    const y = minY - padding;
    
    // Update viewBox
    const svg = $("svg");
    svg.removeAttr("width");
    svg.removeAttr("height");
    svg.attr("viewBox", `${x} ${y} ${w} ${h}`);
    svg.attr("preserveAspectRatio", "xMidYMid meet");
    svg.attr("style", "max-width: 100%; height: auto;");
  }
}

export function convertConnectionsToOrthogonal(svg: string, cornerRadius = 8): string {
  const $ = cheerio.load(svg, { xmlMode: true });
  
  // 1. Gather Obstacles for routing
  const obstacles = getObstacles($);

  // 2. Process Connections
  let connections = $("g.connection path");
  if (connections.length === 0) {
      // Fallback
      connections = $("path[fill='none'][stroke]");
  }

  connections.each((i, el) => {
    const $path = $(el);
    const d = $path.attr("d");
    if (!d) return;

    const endpoints = parseEndpoints(d);
    if (!endpoints) return;

    // Generate new orthogonal path with obstacle awareness
    const newPath = buildOrthogonalPath(endpoints.start, endpoints.end, obstacles);
    
    $path.attr("d", newPath);
    $path.removeAttr("stroke-linejoin");
    $path.attr("stroke-linejoin", "round");
  });

  // 3. Compact Layout & Normalize Aspect Ratio
  maximizeLayout($);
  
  return $.xml();
}
