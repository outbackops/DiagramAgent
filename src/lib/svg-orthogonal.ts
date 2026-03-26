import * as cheerio from "cheerio";

/**
 * Converts D2's curved Bezier connections to clean orthogonal paths.
 * Uses cheerio for robust SVG parsing.
 */

interface Point { x: number; y: number }

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
 * Build a simple orthogonal path (H -> V -> H).
 */
function buildOrthogonalPath(
  start: Point,
  end: Point,
  radius: number
): string {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  // If points are close vertically/horizontally, draw straight line
  if (dx < 2) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  if (dy < 2) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  // If major move is horizontal, go H-V-H
  if (dx > dy) {
      return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
  } else {
      // Vertical major move, go V-H-V
      return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
  }
}

export function convertConnectionsToOrthogonal(svg: string, cornerRadius = 8): string {
  const $ = cheerio.load(svg, { xmlMode: true });

  // D2 SVG structure usually puts connections in a specific group or with class
  // We look for paths that likely represent connections.
  // Often they are in <g class="connection"> or just paths with stroke but no fill (or fill=none)
  
  // Strategy: Find all paths inside elements with class 'connection'
  // If no class 'connection', look for paths that are not filled.
  
  let connections = $("g.connection path");
  
  if (connections.length === 0) {
      // Fallback: look for paths with stroke and no fill
      connections = $("path[fill='none'][stroke]");
  }

  connections.each((i, el) => {
    const $path = $(el);
    const d = $path.attr("d");
    if (!d) return;

    const endpoints = parseEndpoints(d);
    if (!endpoints) return;

    // TODO: Obstacle avoidance could be implemented here by analyzing 
    // bounding boxes of other <g class="node"> elements.
    // For now, we enforce a clean H-V-H or V-H-V route.

    const newPath = buildOrthogonalPath(endpoints.start, endpoints.end, cornerRadius);
    $path.attr("d", newPath);
    // Remove smooth attribute if present
    $path.removeAttr("stroke-linejoin");
    $path.attr("stroke-linejoin", "round");
  });

  return $.xml();
}
