import type { DiagramEdge, DiagramModel, DiagramNode, Point, Tone } from "@/lib/model/types";
import { flowTonesOfModel, laneFooterBlock, laneHeaderBlock, nodeBlock, type ContentContext } from "./content";
import type { CheckSeverity, CheckStatus, QualityCheck, QualityGrade, QualityMetrics, QualityReport } from "@/lib/quality/diagram-quality";

/** Deterministic quality checks for composed diagrams, in the same QualityReport shape as the graph scorer. Client-safe (no server-only imports). */

const WEIGHTS: Record<CheckSeverity, number> = { critical: 20, major: 10, minor: 4 };
const PAIR_BUDGET = 2_000_000;

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Segment = [Point, Point];
type EffectiveRole = NonNullable<DiagramNode["role"]> | "card" | "lane";

const pct = (value: number) => `${Math.round(value * 100)}%`;

function gradeOf(score: number): QualityGrade {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
}

function roleOf(node: DiagramNode, byParent: Map<string | null, DiagramNode[]>): EffectiveRole {
  if (node.role) return node.role;
  return node.container || (byParent.get(node.id)?.length ?? 0) > 0 ? "lane" : "card";
}

function directChildren(model: DiagramModel): Map<string | null, DiagramNode[]> {
  const out = new Map<string | null, DiagramNode[]>();
  for (const node of model.nodes) {
    const list = out.get(node.parent) ?? [];
    list.push(node);
    out.set(node.parent, list);
  }
  return out;
}

function flowTones(model: DiagramModel): Record<string, Tone> {
  return flowTonesOfModel(model);
}

function labelOf(node: DiagramNode): string {
  return node.label.trim() || node.id;
}

function extentOfPoints(points: readonly Point[]): Extent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return points.length ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function nodeExtent(nodes: readonly DiagramNode[]): Extent {
  return extentOfPoints(nodes.flatMap((node) => [node.box, { x: node.box.x + node.box.w, y: node.box.y + node.box.h }]));
}

function extentsOverlap(a: Extent, b: Extent): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function boxesOverlap(a: DiagramNode, b: DiagramNode, tolerance: number): boolean {
  const w = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
  const h = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
  return w > tolerance && h > tolerance;
}

function isInside(child: DiagramNode, parent: DiagramNode, tolerance: number): boolean {
  return (
    child.box.x >= parent.box.x - tolerance &&
    child.box.y >= parent.box.y - tolerance &&
    child.box.x + child.box.w <= parent.box.x + parent.box.w + tolerance &&
    child.box.y + child.box.h <= parent.box.y + parent.box.h + tolerance
  );
}

function isAncestor(candidateId: string, nodeId: string): boolean {
  return nodeId.startsWith(`${candidateId}.`);
}

function isExemptEndpointNode(node: DiagramNode, edge: DiagramEdge): boolean {
  return node.id === edge.from || node.id === edge.to || isAncestor(node.id, edge.from) || isAncestor(node.id, edge.to);
}

function sampleCurve(start: Point, end: Point, count = 24): Point[] {
  const dx = end.x - start.x;
  const c1 = { x: start.x + dx / 2, y: start.y };
  const c2 = { x: end.x - dx / 2, y: end.y };
  const points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const mt = 1 - t;
    points.push({
      x: mt ** 3 * start.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * end.x,
      y: mt ** 3 * start.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * end.y,
    });
  }
  return points;
}

function edgePoints(edge: DiagramEdge): Point[] {
  if (edge.curve && edge.route.length >= 2) return sampleCurve(edge.route[0], edge.route[edge.route.length - 1]);
  return edge.route;
}

function segments(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  return out;
}

function insetBox(node: DiagramNode, inset: number): Extent | null {
  const minX = node.box.x + inset;
  const minY = node.box.y + inset;
  const maxX = node.box.x + node.box.w - inset;
  const maxY = node.box.y + node.box.h - inset;
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}

function segmentCrossesBox(a: Point, b: Point, box: Extent): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

function properlyIntersect(a: Segment, b: Segment): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(b[0], b[1], a[0]);
  const d2 = cross(b[0], b[1], a[1]);
  const d3 = cross(a[0], a[1], b[0]);
  const d4 = cross(a[0], a[1], b[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function countDepth(id: string): number {
  return id ? id.split(".").length : 0;
}

function connectorEdges(model: DiagramModel): DiagramEdge[] {
  return model.edges.filter((edge) => edge.kind !== "step");
}

function edgeCrossings(edges: readonly DiagramEdge[]): number {
  const prepared = edges
    .filter((edge) => edge.kind === "flow" || edge.kind === "call")
    .map((edge) => {
      const points = edgePoints(edge);
      return { edge, extent: extentOfPoints(points), segs: segments(points) };
    });
  let budget = PAIR_BUDGET;
  let count = 0;
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (--budget < 0) return count;
      const a = prepared[i];
      const b = prepared[j];
      if (a.edge.from === b.edge.from || a.edge.from === b.edge.to || a.edge.to === b.edge.from || a.edge.to === b.edge.to) continue;
      if (!extentsOverlap(a.extent, b.extent)) continue;
      budget -= a.segs.length * b.segs.length;
      if (budget < 0) return count;
      if (a.segs.some((segA) => b.segs.some((segB) => properlyIntersect(segA, segB)))) count++;
    }
  }
  return count;
}

function edgesThroughNodes(model: DiagramModel, byParent: Map<string | null, DiagramNode[]>): DiagramEdge[] {
  // Inset boxes once; every pair visited costs budget, so the work is bounded whatever the model size.
  const blockers = model.nodes
    .filter((node) => {
      const role = roleOf(node, byParent);
      return role === "card" || role === "step" || role === "banner";
    })
    .map((node) => ({ node, box: insetBox(node, 4) }))
    .filter((entry): entry is { node: DiagramNode; box: Extent } => entry.box !== null);
  const hits: DiagramEdge[] = [];
  let budget = PAIR_BUDGET;
  for (const edge of connectorEdges(model)) {
    const points = edgePoints(edge);
    const edgeExtent = extentOfPoints(points);
    const segs = segments(points);
    let hit = false;
    for (const { node, box } of blockers) {
      if (--budget < 0) break;
      if (!extentsOverlap(edgeExtent, box) || isExemptEndpointNode(node, edge)) continue;
      budget -= segs.length;
      if (segs.some(([a, b]) => segmentCrossesBox(a, b, box))) {
        hit = true;
        break;
      }
    }
    if (hit) hits.push(edge);
    if (budget < 0) break;
  }
  return hits;
}

function labelledConnectorCoverage(edges: readonly DiagramEdge[]): number {
  return edges.length ? edges.filter((edge) => edge.label?.trim() || edge.labelAt).length / edges.length : 1;
}

function addCheck(checks: QualityCheck[], check: QualityCheck): void {
  checks.push(check);
}

function scoreFromChecks(checks: readonly QualityCheck[]): number {
  let score = 100;
  for (const check of checks) {
    if (check.status === "fail") score -= WEIGHTS[check.severity];
    else if (check.status === "warn") score -= WEIGHTS[check.severity] / 2;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusFromAspect(aspectRatio: number): CheckStatus {
  if (aspectRatio >= 1.2 && aspectRatio <= 2.0) return "pass";
  if (aspectRatio >= 0.9 && aspectRatio <= 2.6) return "warn";
  return "fail";
}

function contentRole(node: DiagramNode, byParent: Map<string | null, DiagramNode[]>): string | undefined {
  const role = roleOf(node, byParent);
  return role === "card" || role === "lane" ? undefined : role;
}

function textFitOffenders(model: DiagramModel, byParent: Map<string | null, DiagramNode[]>, ctx: ContentContext): { offenders: string[]; broken: string[] } {
  const offenders: string[] = [];
  const broken: string[] = [];
  for (const node of model.nodes) {
    const role = roleOf(node, byParent);
    if (!["card", "step", "banner", "lane", "zone", "column", "header", "footer"].includes(role)) continue;
    if (role === "lane" || role === "zone") {
      const header = laneHeaderBlock(node, node.box.w);
      const footer = laneFooterBlock(node, node.box.w);
      if (header.truncated > 0 || footer.truncated > 0 || header.height + footer.height > node.box.h + 1) offenders.push(labelOf(node));
      else if (header.broken + footer.broken > 0) broken.push(labelOf(node));
    } else {
      const block = nodeBlock(contentRole(node, byParent), node, { w: node.box.w, h: node.box.h }, ctx);
      if (block.truncated > 0 || block.height > node.box.h + 1) offenders.push(labelOf(node));
      else if (block.broken > 0) broken.push(labelOf(node));
    }
  }
  return { offenders, broken };
}

function lineCount(node: DiagramNode): number {
  return node.content?.lines?.length ?? 0;
}

/** Deterministic quality checks for composed diagrams, in the same QualityReport shape as the graph scorer. Client-safe (no server-only imports). */
export function scoreComposition(model: DiagramModel, options: { warnings?: string[] } = {}): QualityReport {
  const byParent = directChildren(model);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const roles = new Map(model.nodes.map((node) => [node.id, roleOf(node, byParent)]));
  const cardsAndSteps = model.nodes.filter((node) => roles.get(node.id) === "card" || roles.get(node.id) === "step");
  const containers = model.nodes.filter((node) => ["column", "lane", "grid", "zone"].includes(roles.get(node.id) ?? ""));
  const edges = connectorEdges(model);
  const extent = nodeExtent(model.nodes);
  const width = Math.round(extent.maxX - extent.minX);
  const height = Math.round(extent.maxY - extent.minY);
  const aspectRatio = height > 0 ? width / height : 0;
  const checks: QualityCheck[] = [];
  const ctx: ContentContext = { flowTones: flowTones(model) };

  addCheck(checks, {
    id: "size",
    label: "Enough composed components",
    severity: "major",
    status: cardsAndSteps.length >= 4 ? "pass" : cardsAndSteps.length === 3 ? "warn" : "fail",
    detail: `${cardsAndSteps.length} cards or steps; add at least ${Math.max(0, 4 - cardsAndSteps.length)} more meaningful component${4 - cardsAndSteps.length === 1 ? "" : "s"}.`,
  });

  const { offenders: fitOffenders, broken: brokenWords } = textFitOffenders(model, byParent, ctx);
  addCheck(checks, {
    id: "text_fit",
    label: "Text fits inside boxes",
    severity: "major",
    status: fitOffenders.length > 0 ? "fail" : brokenWords.length > 0 ? "warn" : "pass",
    detail:
      fitOffenders.length > 0
        ? `Increase box height or shorten text for: ${fitOffenders.slice(0, 4).join(", ")}${fitOffenders.length > 4 ? ", …" : ""}.`
        : brokenWords.length > 0
          ? `Words are split across lines in: ${brokenWords.slice(0, 4).join(", ")}${brokenWords.length > 4 ? ", …" : ""}; use shorter words or fewer steps in the row.`
          : "All composed text fits current boxes",
  });

  const overlaps: string[] = [];
  for (const siblings of byParent.values()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        if (boxesOverlap(siblings[i], siblings[j], 2)) overlaps.push(`${labelOf(siblings[i])} ↔ ${labelOf(siblings[j])}`);
      }
    }
  }
  addCheck(checks, {
    id: "overlaps",
    label: "No overlapping sibling boxes",
    severity: "critical",
    status: overlaps.length === 0 ? "pass" : "fail",
    detail: overlaps.length === 0 ? "No sibling boxes overlap" : `Separate overlapping boxes: ${overlaps.slice(0, 4).join("; ")}.`,
  });

  const containment = model.nodes.filter((node) => node.parent !== null && byId.get(node.parent) && !isInside(node, byId.get(node.parent) as DiagramNode, 2));
  addCheck(checks, {
    id: "containment",
    label: "Children stay inside parents",
    severity: "major",
    status: containment.length === 0 ? "pass" : "fail",
    detail: containment.length === 0 ? "Every child box is inside its parent" : `Move these inside their parent panels: ${containment.slice(0, 4).map(labelOf).join(", ")}.`,
  });

  const through = edgesThroughNodes(model, byParent);
  const throughRate = edges.length ? through.length / edges.length : 0;
  addCheck(checks, {
    id: "edges_through_nodes",
    label: "Connectors avoid unrelated cards",
    severity: "major",
    status: through.length === 0 ? "pass" : throughRate <= 0.1 ? "warn" : "fail",
    detail:
      through.length === 0
        ? "No connector passes through an unrelated card, step or banner"
        : `Reroute ${through.slice(0, 4).map((edge) => edge.label?.trim() || edge.id).join(", ")} around unrelated cards or steps.`,
  });

  addCheck(checks, {
    id: "aspect_ratio",
    label: "Balanced page aspect ratio",
    severity: "major",
    status: statusFromAspect(aspectRatio),
    detail: `Page aspect ratio is ${aspectRatio.toFixed(2)}:1 (${width}×${height}); target 1.2–2.0.`,
  });

  const dense: string[] = [];
  for (const column of model.nodes.filter((node) => roles.get(node.id) === "column")) {
    const count = byParent.get(column.id)?.length ?? 0;
    if (count > 8) dense.push(`${labelOf(column)} has ${count} items`);
  }
  for (const lane of model.nodes.filter((node) => roles.get(node.id) === "lane")) {
    const count = (byParent.get(lane.id) ?? []).filter((node) => roles.get(node.id) === "step").length;
    if (count > 6) dense.push(`${labelOf(lane)} has ${count} steps`);
  }
  for (const card of cardsAndSteps.filter((node) => roles.get(node.id) === "card" && lineCount(node) > 5)) dense.push(`${labelOf(card)} has ${lineCount(card)} lines`);
  addCheck(checks, {
    id: "density",
    label: "Readable density",
    severity: "minor",
    status: dense.length === 0 ? "pass" : "warn",
    detail: dense.length === 0 ? "Columns, lanes and cards stay within density limits" : `Reduce density: ${dense.slice(0, 4).join("; ")}.`,
  });

  const columnHeights = model.nodes
    .filter((node) => roles.get(node.id) === "column")
    .map((column) => (byParent.get(column.id) ?? []).reduce((sum, child) => sum + child.box.h, 0))
    .filter((value) => value > 0);
  const tallest = Math.max(0, ...columnHeights);
  const shortest = Math.min(...columnHeights);
  const balance = tallest > 0 && Number.isFinite(shortest) ? shortest / tallest : 1;
  addCheck(checks, {
    id: "balance",
    label: "Columns have balanced content",
    severity: "minor",
    status: balance >= 0.45 ? "pass" : "warn",
    detail: `Shortest non-empty column is ${pct(balance)} of the tallest; target at least 45%.`,
  });

  const warnings = options.warnings ?? [];
  const severeRepairs = warnings.filter((warning) => /unresolved|dropped connector/i.test(warning));
  addCheck(checks, {
    id: "references",
    label: "References resolve cleanly",
    severity: "major",
    status: severeRepairs.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    detail:
      warnings.length === 0
        ? "No composition repairs were reported"
        : `Fix composition repairs: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "; …" : ""}.`,
  });

  const crossings = edgeCrossings(model.edges);
  addCheck(checks, {
    id: "crossings",
    label: "Few crossing connectors",
    severity: "minor",
    status: crossings > 6 ? "fail" : crossings > 2 ? "warn" : "pass",
    detail: `${crossings} flow/call connector crossing${crossings === 1 ? "" : "s"}; keep at two or fewer.`,
  });

  const emptyColumns = model.nodes.filter((node) => roles.get(node.id) === "column" && (byParent.get(node.id)?.length ?? 0) === 0);
  addCheck(checks, {
    id: "empty_columns",
    label: "Columns are not empty",
    severity: "major",
    status: emptyColumns.length === 0 ? "pass" : "fail",
    detail: emptyColumns.length === 0 ? "Every column has content" : `Add content to empty columns: ${emptyColumns.slice(0, 4).map(labelOf).join(", ")}.`,
  });

  const score = scoreFromChecks(checks);
  const iconCoverage = cardsAndSteps.length ? cardsAndSteps.filter((node) => Boolean(node.icon)).length / cardsAndSteps.length : 1;
  const labelCoverage = labelledConnectorCoverage(edges);
  const metrics: QualityMetrics = {
    nodes: cardsAndSteps.length,
    containers: containers.length,
    connections: edges.length,
    maxDepth: model.nodes.reduce((max, node) => Math.max(max, countDepth(node.id)), 0),
    width,
    height,
    aspectRatio: Number(aspectRatio.toFixed(2)),
    iconCoverage: Number(iconCoverage.toFixed(2)),
    labelCoverage: Number(labelCoverage.toFixed(2)),
    crossings,
    orphans: 0,
    edgesThroughNodes: through.length,
  };

  return { score, grade: gradeOf(score), checks, metrics };
}
