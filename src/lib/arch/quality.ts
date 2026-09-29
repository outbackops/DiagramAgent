import { architectureBounds } from "@/lib/model/render-architecture";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, Point } from "@/lib/model/types";
import type { QualityCheck, QualityGrade, QualityReport } from "@/lib/quality/diagram-quality";
import { componentGeom, titleBox } from "./measure";
import { allItems, isBoundary, type NBoundary, type NComponent, type NItem, type NormalizedArchSpec } from "./spec";

export interface FaithfulnessExpect {
  components?: string[][];
  boundaries?: string[][];
  flows?: Array<[string[], string[]]>;
  allowedFacts?: string[];
  prohibited?: string[];
  overlays?: string[][];
}

export interface FaithfulnessReport {
  pass: boolean;
  missingComponents: string[];
  missingBoundaries: string[];
  missingFlows: string[];
  ungroundedFacts: string[];
  prohibitedFound: string[];
  missingOverlays: string[];
}

const WEIGHTS = { critical: 20, major: 10, minor: 4 } as const;
const PAIR_BUDGET = 2_000_000;
const OVERLAP_TOLERANCE = 2;

type Segment = [Point, Point];
interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function gradeOf(score: number): QualityGrade {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
}

function labelOf(node: DiagramNode): string {
  return node.label.trim() || node.arch?.id || node.id;
}

function isArchContent(node: DiagramNode): boolean {
  return !node.generated && (node.role === "service" || node.role === "boundary");
}

function isService(node: DiagramNode): boolean {
  return !node.generated && node.role === "service";
}

function isBoundaryNode(node: DiagramNode): boolean {
  return !node.generated && node.role === "boundary";
}

function isAncestor(candidateId: string, nodeId: string): boolean {
  return candidateId !== nodeId && nodeId.startsWith(`${candidateId}.`);
}

function isAncestorOrSelf(candidateId: string, nodeId: string): boolean {
  return candidateId === nodeId || isAncestor(candidateId, nodeId);
}

function extentOfPoints(points: readonly Point[]): Extent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return points.length ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function extentOfBox(box: Box): Extent {
  return { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h };
}

function extentsOverlap(a: Extent, b: Extent): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function segments(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  return out;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function boxesOverlap(a: Box, b: Box, tolerance = OVERLAP_TOLERANCE): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > tolerance && h > tolerance;
}

function isInside(child: Box, parent: Box, tolerance = 1): boolean {
  return child.x >= parent.x - tolerance && child.y >= parent.y - tolerance && child.x + child.w <= parent.x + parent.w + tolerance && child.y + child.h <= parent.y + parent.h + tolerance;
}

function insetBox(box: Box, inset: number): Extent | null {
  const minX = box.x + inset;
  const minY = box.y + inset;
  const maxX = box.x + box.w - inset;
  const maxY = box.y + box.h - inset;
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

function scoreFromChecks(checks: readonly QualityCheck[]): number {
  let score = 100;
  for (const check of checks) {
    if (check.status === "fail") score -= WEIGHTS[check.severity];
    else if (check.status === "warn") score -= WEIGHTS[check.severity] / 2;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function check(status: QualityCheck["status"], id: string, label: string, severity: QualityCheck["severity"], detail: string): QualityCheck {
  return { id, label, severity, status, detail };
}

function edgePoints(edge: DiagramEdge): Point[] {
  return edge.route;
}

function edgeCrossings(edges: readonly DiagramEdge[]): number {
  const prepared = edges.map((edge) => {
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

function textFitOffenders(model: DiagramModel): string[] {
  const offenders: string[] = [];
  for (const node of model.nodes) {
    if (isService(node)) {
      const geom = componentGeom({ type: "component", id: node.arch?.id ?? node.id, name: node.label, detail: node.arch?.detail, icon: node.arch?.iconKey });
      if (node.box.w + 1 < geom.w || node.box.h + 1 < geom.h) offenders.push(labelOf(node));
    } else if (isBoundaryNode(node)) {
      const required = titleBox({ name: node.label, facts: node.arch?.facts }, node.box);
      if (required.x + required.w > node.box.x + node.box.w + 1 || required.y + required.h > node.box.y + node.box.h + 1) offenders.push(labelOf(node));
    }
  }
  return offenders;
}

function overlapOffenders(nodes: readonly DiagramNode[]): string[] {
  const offenders: string[] = [];
  const candidates = nodes.filter(isArchContent);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (isAncestorOrSelf(a.id, b.id) || isAncestorOrSelf(b.id, a.id)) continue;
      if (overlapArea(a.box, b.box) > OVERLAP_TOLERANCE) offenders.push(`${labelOf(a)} ↔ ${labelOf(b)}`);
    }
  }
  return offenders;
}

function nestingOffenders(model: DiagramModel): string[] {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  return model.nodes
    .filter((node) => !node.generated && node.parent && byId.has(node.parent) && !isInside(node.box, byId.get(node.parent)!.box, 2))
    .map(labelOf);
}

function edgesThroughComponents(model: DiagramModel, visibleEdges: readonly DiagramEdge[]): string[] {
  const services = model.nodes
    .filter(isService)
    .map((node) => ({ node, box: insetBox(node.box, 4) }))
    .filter((entry): entry is { node: DiagramNode; box: Extent } => Boolean(entry.box));
  const boundaryTitles = model.nodes.filter(isBoundaryNode).map((node) => ({ node, box: extentOfBox(titleBox({ name: node.label, facts: node.arch?.facts }, node.box)) }));
  const hits: string[] = [];
  let budget = PAIR_BUDGET;
  for (const edge of visibleEdges) {
    const points = edgePoints(edge);
    const edgeExtent = extentOfPoints(points);
    const segs = segments(points);
    let offender: string | undefined;
    for (const { node, box } of services) {
      if (--budget < 0) break;
      if (node.id === edge.from || node.id === edge.to || !extentsOverlap(edgeExtent, box)) continue;
      budget -= segs.length;
      if (segs.some(([a, b]) => segmentCrossesBox(a, b, box))) {
        offender = `${edge.label?.trim() || edge.id} through ${labelOf(node)}`;
        break;
      }
    }
    if (!offender) {
      for (const { node, box } of boundaryTitles) {
        if (--budget < 0) break;
        if (isAncestorOrSelf(node.id, edge.from) || isAncestorOrSelf(node.id, edge.to) || !extentsOverlap(edgeExtent, box)) continue;
        budget -= segs.length;
        if (segs.some(([a, b]) => segmentCrossesBox(a, b, box))) {
          offender = `${edge.label?.trim() || edge.id} through ${labelOf(node)} title`;
          break;
        }
      }
    }
    if (offender) hits.push(offender);
    if (budget < 0) break;
  }
  return hits;
}

function labelBoxes(edges: readonly DiagramEdge[]): Array<{ edge: DiagramEdge; box: Box; label: string }> {
  return edges
    .filter((edge) => edge.labelAt && edge.labelSize)
    .map((edge) => ({
      edge,
      label: edge.label?.trim() || edge.id,
      box: { x: edge.labelAt!.x - edge.labelSize!.w / 2, y: edge.labelAt!.y - edge.labelSize!.h / 2, w: edge.labelSize!.w, h: edge.labelSize!.h },
    }));
}

function labelOverlapOffenders(model: DiagramModel, visibleEdges: readonly DiagramEdge[]): string[] {
  const labels = labelBoxes(visibleEdges);
  const blockers = [
    ...model.nodes.filter(isService).map((node) => ({ name: labelOf(node), box: node.box })),
    ...model.nodes.filter(isBoundaryNode).map((node) => ({ name: `${labelOf(node)} title`, box: titleBox({ name: node.label, facts: node.arch?.facts }, node.box) })),
  ];
  const offenders: string[] = [];
  for (const label of labels) {
    const hit = blockers.find((blocker) => boxesOverlap(label.box, blocker.box, 0));
    if (hit) offenders.push(`${label.label} over ${hit.name}`);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (boxesOverlap(labels[i].box, labels[j].box, 0)) offenders.push(`${labels[i].label} ↔ ${labels[j].label}`);
    }
  }
  return offenders;
}

function primaryFlowLabelOffenders(edges: readonly DiagramEdge[]): string[] {
  return edges.filter((edge) => (edge.badges?.length ?? 0) > 0 && !edge.label?.trim()).map((edge) => edge.id);
}

function maxDepth(nodes: readonly DiagramNode[]): number {
  return nodes.reduce((max, node) => Math.max(max, node.id ? node.id.split(".").length : 0), 0);
}

export function scoreArchitecture(model: DiagramModel, options: { warnings?: string[] } = {}): QualityReport {
  const visibleEdges = model.edges.filter((edge) => !edge.hidden);
  const services = model.nodes.filter(isService);
  const boundaries = model.nodes.filter(isBoundaryNode);
  const checks: QualityCheck[] = [];

  const fit = textFitOffenders(model);
  checks.push(check(fit.length ? "fail" : "pass", "text_fit", "Text fits architecture boxes", "critical", fit.length ? `Shorten text or enlarge boxes for: ${fit.slice(0, 5).join(", ")}${fit.length > 5 ? ", …" : ""}.` : "Component text and boundary titles fit."));

  const overlaps = overlapOffenders(model.nodes);
  checks.push(check(overlaps.length ? "fail" : "pass", "overlap", "Components and boundaries do not overlap", "critical", overlaps.length ? `Separate overlapping boxes: ${overlaps.slice(0, 5).join("; ")}.` : "No non-ancestor architecture boxes overlap."));

  const through = edgesThroughComponents(model, visibleEdges);
  checks.push(check(through.length ? "fail" : "pass", "connector_through_component", "Connectors avoid component and title boxes", "critical", through.length ? `Reroute connectors: ${through.slice(0, 5).join("; ")}.` : "No connector crosses unrelated service boxes or boundary titles."));

  const labelOverlaps = labelOverlapOffenders(model, visibleEdges);
  checks.push(check(labelOverlaps.length ? "fail" : "pass", "label_overlap", "Connector labels stay clear", "critical", labelOverlaps.length ? `Move labels away from content: ${labelOverlaps.slice(0, 5).join("; ")}.` : "Connector labels do not overlap components, titles or each other."));

  const nesting = nestingOffenders(model);
  checks.push(check(nesting.length ? "fail" : "pass", "nesting", "Children stay inside parent boundaries", "critical", nesting.length ? `Move these children inside their parents: ${nesting.slice(0, 5).join(", ")}.` : "Every child is inside its parent boundary."));

  const bounds = architectureBounds(model);
  const aspectRatio = bounds.h > 0 ? bounds.w / bounds.h : 0;
  checks.push(check(aspectRatio >= 1.2 && aspectRatio <= 2.2 ? "pass" : "warn", "aspect_ratio", "Balanced page aspect ratio", "minor", `Page aspect ratio is ${aspectRatio.toFixed(2)}:1 (${Math.round(bounds.w)}×${Math.round(bounds.h)}); target 1.2–2.2.`));

  const crossings = edgeCrossings(visibleEdges);
  checks.push(check(crossings > 3 ? "warn" : "pass", "crossings", "Few crossing connectors", "minor", `${crossings} connector crossing${crossings === 1 ? "" : "s"}; warn above 3.`));

  const longBends = visibleEdges.filter((edge) => Math.max(0, edge.route.length - 2) > 4);
  checks.push(check(longBends.length ? "warn" : "pass", "long_bends", "Connectors avoid long bend chains", "minor", longBends.length ? `Simplify connector routes: ${longBends.slice(0, 5).map((edge) => edge.label?.trim() || edge.id).join(", ")}.` : "No connector has more than 4 bends."));

  const iconCoverage = services.length ? services.filter((node) => Boolean(node.icon || node.arch?.iconKey)).length / services.length : 1;
  checks.push(check(iconCoverage < 0.8 ? "warn" : "pass", "icon_coverage", "Most services have icons", "minor", `${Math.round(iconCoverage * 100)}% of services have icons; target at least 80%.`));

  const unlabeledPrimary = primaryFlowLabelOffenders(visibleEdges);
  checks.push(check(unlabeledPrimary.length ? "warn" : "pass", "primary_flow_labels", "Primary flow steps are labelled", "minor", unlabeledPrimary.length ? `Add labels to badged connectors: ${unlabeledPrimary.slice(0, 5).join(", ")}.` : "Every badged connector has a label."));

  const warnings = options.warnings ?? [];
  checks.push(check(warnings.length ? "warn" : "pass", "normalizer_warnings", "Normaliser warnings resolved", "minor", warnings.length ? `Review normaliser warnings: ${warnings.slice(0, 5).join("; ")}${warnings.length > 5 ? "; …" : ""}.` : "No normaliser warnings were reported."));

  const score = scoreFromChecks(checks);
  const labelCoverage = visibleEdges.length ? visibleEdges.filter((edge) => edge.label?.trim()).length / visibleEdges.length : 1;
  const metrics = {
    nodes: services.length,
    containers: boundaries.length,
    connections: visibleEdges.length,
    maxDepth: maxDepth(model.nodes),
    width: Math.round(bounds.w),
    height: Math.round(bounds.h),
    aspectRatio: Number(aspectRatio.toFixed(2)),
    iconCoverage: Number(iconCoverage.toFixed(2)),
    labelCoverage: Number(labelCoverage.toFixed(2)),
    crossings,
    orphans: 0,
    edgesThroughNodes: through.length,
  };

  return { score, grade: gradeOf(score), checks, metrics };
}

const normalize = (text: string | undefined): string => ` ${text ?? ""} `.toLowerCase().replace(/[×]/g, " x ").replace(/[^a-z0-9.+/#:-]+/g, " ").replace(/\s+/g, " ");
const normalizeLoose = (text: string | undefined): string => ` ${text ?? ""} `.toLowerCase().replace(/[×]/g, " x ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");

function containsAlias(text: string, aliases: readonly string[]): boolean {
  const hay = normalizeLoose(text);
  return aliases.some((alias) => hay.includes(normalizeLoose(alias)));
}


function directItemText(item: NItem): string {
  return isBoundary(item) ? [item.name, item.facts, item.kind].filter(Boolean).join(" ") : [item.name, item.detail, item.icon].filter(Boolean).join(" ");
}

function walkItems(items: readonly NItem[], parent: string | null, byId: Map<string, NItem>, parents: Map<string, string | null>): void {
  for (const item of items) {
    byId.set(item.id, item);
    parents.set(item.id, parent);
    if (isBoundary(item)) walkItems(item.items, item.id, byId, parents);
  }
}

function descendantsOf(id: string, byId: Map<string, NItem>): string[] {
  const item = byId.get(id);
  if (!item || !isBoundary(item)) return [];
  return allItems(item.items).map((child) => child.id);
}

function relatedTexts(id: string, byId: Map<string, NItem>, parents: Map<string, string | null>): string {
  const ids = new Set<string>([id, ...descendantsOf(id, byId)]);
  let parent = parents.get(id) ?? null;
  while (parent) {
    ids.add(parent);
    parent = parents.get(parent) ?? null;
  }
  return [...ids].map((itemId) => (byId.get(itemId) ? directItemText(byId.get(itemId)!) : itemId)).join(" ");
}

function specText(spec: NormalizedArchSpec): string {
  const parts: string[] = [spec.title, spec.subtitle ?? "", ...spec.assumptions, ...spec.overlays.map((o) => o.name)];
  for (const item of allItems(spec.items)) parts.push(directItemText(item));
  for (const conn of spec.connections) parts.push(conn.label ?? "", conn.meaning, conn.from, conn.to);
  return parts.filter(Boolean).join(" ");
}

function missingAliasGroups(groups: readonly string[][] | undefined, texts: readonly string[]): string[] {
  return (groups ?? []).filter((group) => !texts.some((text) => containsAlias(text, group))).map((group) => group[0]);
}

function addFact(out: Array<{ text: string; where: string }>, seen: Set<string>, text: string, where: string): void {
  const value = text.trim();
  if (!value) return;
  const key = `${where}:${normalize(value)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ text: value, where });
}

function extractFactsFromText(text: string | undefined, where: string, out: Array<{ text: string; where: string }>, seen: Set<string>): void {
  if (!text) return;
  const patterns: RegExp[] = [
    /\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\b/g,
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    /\b(?:TCP|UDP|HTTPS?|TDS|SQL|PostgreSQL|MySQL|Redis|AMQP|SSH|RDP)\s*:?[\s-]*\d{2,5}\b/gi,
    /(?:^|\s):\d{2,5}\b/g,
    /\bport\s+\d{2,5}\b/gi,
    /\b\d+\s+(?:instances?|replicas?|nodes?)\b/gi,
    /(?:×|x)\s*\d+\b/gi,
    /\b(?:v\d+(?:\.\d+){1,2}|Java\s+\d+(?:\.\d+)?|\.NET\s+\d+(?:\.\d+)?|MySQL\s+\d+(?:\.\d+)?)\b/gi,
    /\b(?=[A-Za-z0-9_.-]*\d)(?=[A-Za-z0-9_.-]*[A-Za-z])[A-Za-z][A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*\b/g,
    /\b(?:Premium|Business Critical|Standard|Basic|Free tier|Free)\b/gi,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) addFact(out, seen, match[0].trim(), where);
  if (/^\s*\d+\.\d+(?:\.\d+)?\s*$/.test(text)) addFact(out, seen, text.trim(), where);
}

export function extractFacts(spec: NormalizedArchSpec): Array<{ text: string; where: string }> {
  const out: Array<{ text: string; where: string }> = [];
  const seen = new Set<string>();
  if (spec.subtitle) extractFactsFromText(spec.subtitle, "subtitle", out, seen);
  for (const item of allItems(spec.items)) {
    if (isBoundary(item)) extractFactsFromText(item.facts, `boundary:${item.id}`, out, seen);
    else extractFactsFromText(item.detail, `component:${item.id}`, out, seen);
  }
  for (const conn of spec.connections) extractFactsFromText(conn.label, `connection:${conn.from}->${conn.to}`, out, seen);
  return out;
}

const IMPLIED_PORTS: Record<string, string[]> = {
  https: ["443"],
  http: ["80"],
  tds: ["1433"],
  sql: ["1433"],
  postgresql: ["5432"],
  mysql: ["3306"],
  redis: ["6379"],
  amqp: ["5671", "5672"],
  ssh: ["22"],
  rdp: ["3389"],
};

function factGrounded(fact: string, prompt: string, allowedFacts: readonly string[] | undefined, assumptions: readonly string[]): boolean {
  const factNorm = normalize(fact);
  const promptNorm = normalize(prompt);
  const promptLoose = normalizeLoose(prompt);
  if (promptNorm.includes(factNorm)) return true;
  if ((allowedFacts ?? []).some((allowed) => normalize(allowed).includes(factNorm) || factNorm.includes(normalize(allowed)))) return true;
  if (assumptions.some((assumption) => normalize(assumption).includes(factNorm))) return true;
  for (const [protocol, ports] of Object.entries(IMPLIED_PORTS)) {
    if (promptLoose.includes(` ${protocol} `) && ports.some((port) => factNorm.includes(port))) return true;
  }
  return false;
}

export function faithfulness(spec: NormalizedArchSpec, prompt: string, expect: FaithfulnessExpect): FaithfulnessReport {
  const byId = new Map<string, NItem>();
  const parents = new Map<string, string | null>();
  walkItems(spec.items, null, byId, parents);
  const components = allItems(spec.items).filter((item): item is NComponent => !isBoundary(item)).map(directItemText);
  const boundaries = allItems(spec.items).filter((item): item is NBoundary => isBoundary(item)).map(directItemText);

  const missingComponents = missingAliasGroups(expect.components, components);
  const missingBoundaries = missingAliasGroups(expect.boundaries, boundaries);
  const missingFlows = (expect.flows ?? [])
    .filter(([fromAliases, toAliases]) =>
      !spec.connections.some((conn) => containsAlias(relatedTexts(conn.from, byId, parents), fromAliases) && containsAlias(relatedTexts(conn.to, byId, parents), toAliases)),
    )
    .map(([fromAliases, toAliases]) => `${fromAliases[0]} → ${toAliases[0]}`);

  const ungroundedFacts = Array.from(new Map(extractFacts(spec).filter((fact) => !factGrounded(fact.text, prompt, expect.allowedFacts, spec.assumptions)).map((fact) => [normalize(fact.text), fact.text])).values());
  const allSpecText = specText(spec);
  const prohibitedFound = (expect.prohibited ?? []).filter((value) => containsAlias(allSpecText, [value]));
  const overlayTexts = spec.overlays.map((overlay) => overlay.name);
  const missingOverlays = missingAliasGroups(expect.overlays, overlayTexts);
  const pass = missingComponents.length === 0 && missingBoundaries.length === 0 && missingFlows.length === 0 && ungroundedFacts.length === 0 && prohibitedFound.length === 0 && missingOverlays.length === 0;
  return { pass, missingComponents, missingBoundaries, missingFlows, ungroundedFacts, prohibitedFound, missingOverlays };
}
