import { diagramKind } from "@/lib/model/kind";
import type { DiagramEdge, DiagramModel, DiagramNode } from "@/lib/model/types";
import { slugify } from "./normalize";
import type { ArchConnectionInput, ArchItemInput, ArchSpecInput } from "./spec";

export interface ModelToArchResult {
  spec: ArchSpecInput;
  /** What didn't carry over (converting a Graph document); empty for Architecture documents. */
  lost: string[];
}

/**
 * The Architecture spec of a model: what Tidy up re-lays out and what AI edits work on. Reads only
 * canonical data — node names and `arch` metadata, edge meanings, labels, badges and hidden links,
 * and the model's page-level `arch` data. Generated page nodes are projections and are skipped.
 * Nesting follows `parent`; item order follows the model (author order), so a round trip is stable.
 *
 * For a Graph (D2) document this is the explicit "Convert to Architecture" path, and `lost` lists
 * what doesn't map (shapes, colours, tooltips, custom icons).
 */
export function modelToArchSpec(model: DiagramModel): ModelToArchResult {
  const lost = new Set<string>();
  const graph = diagramKind(model) !== "architecture";
  const nodes = model.nodes.filter((n) => !n.generated);
  const byParent = new Map<string | null, DiagramNode[]>();
  for (const node of nodes) byParent.set(node.parent, [...(byParent.get(node.parent) ?? []), node]);

  // Spec ids: the stable `arch.id`, else a slug of the node's own path segment or label, unique.
  // Stable ids are claimed first so a canvas-added node never takes an existing component's id.
  const specIds = new Map<string, string>();
  const used = new Set<string>();
  for (const node of nodes) {
    const id = node.arch?.id;
    if (id && !used.has(id)) {
      used.add(id);
      specIds.set(node.id, id);
    }
  }
  for (const node of nodes) {
    if (specIds.has(node.id)) continue;
    const base = slugify(node.arch?.id ?? lastSegment(node.id)) || slugify(node.label) || (node.container ? "group" : "component");
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    specIds.set(node.id, id);
  }

  const toItem = (node: DiagramNode): ArchItemInput => {
    const id = specIds.get(node.id)!;
    const children = byParent.get(node.id) ?? [];
    if (graph) noteLosses(node, lost);
    if (node.container && children.length > 0) {
      const group: ArchItemInput = { type: "group", id, kind: node.arch?.kind ?? "group", name: node.label || id, items: children.map(toItem) };
      if (node.arch?.facts) group.facts = node.arch.facts;
      if (node.arch?.platform) group.platform = node.arch.platform;
      return group;
    }
    const component: ArchItemInput = { id, name: node.label || id };
    const icon = node.arch?.iconKey ?? iconKeyOf(node.icon);
    if (icon) component.icon = icon;
    else if (node.icon && graph) lost.add("Custom icons (only built-in icons carry over)");
    const detail = node.arch?.detail ?? (node.container ? node.arch?.facts : undefined);
    if (detail) component.detail = detail;
    return component;
  };

  const items = (byParent.get(null) ?? []).map(toItem);
  const connections: ArchConnectionInput[] = [];
  for (const edge of model.edges) {
    const from = specIds.get(edge.from);
    const to = specIds.get(edge.to);
    if (!from || !to) continue;
    connections.push(connectionOf(edge, from, to));
    if (graph) noteEdgeLosses(edge, lost);
  }

  const arch = model.arch;
  const spec: ArchSpecInput = { version: 1, title: arch?.title ?? titleOf(model), items, connections };
  if (arch?.subtitle) spec.subtitle = arch.subtitle;
  if (arch?.platform) spec.platform = arch.platform;
  if (arch?.view) spec.view = arch.view;
  if (arch?.sequences.length) spec.sequences = arch.sequences.map((s) => ({ id: s.id, name: s.name, steps: [...s.steps] }));
  if (arch?.overlays.length) spec.overlays = arch.overlays.map((o) => ({ id: o.id, kind: o.kind, name: o.name, members: [...o.members] }));
  if (arch?.assumptions.length) spec.assumptions = [...arch.assumptions];
  if (graph && model.layout) lost.add("Layout hints (the Architecture engine lays the diagram out itself)");
  return { spec, lost: [...lost] };
}

function connectionOf(edge: DiagramEdge, from: string, to: string): ArchConnectionInput {
  const connection: ArchConnectionInput = { from, to };
  if (edge.meaning && edge.meaning !== "request") connection.meaning = edge.meaning;
  if (edge.label) connection.label = edge.label;
  const badge = edge.badges?.[0];
  // The string form ("in.2") needs a sequence id that starts with a letter; "2fa-login" needs the object form.
  if (badge) connection.step = /^[A-Za-z]/.test(badge.sequence) ? `${badge.sequence}.${badge.number}` : { sequence: badge.sequence, number: badge.number };
  return connection;
}

function noteLosses(node: DiagramNode, lost: Set<string>): void {
  if (node.shape && !["rectangle", "image", "square", "text"].includes(node.shape)) lost.add(`Shapes such as "${node.shape}" (everything becomes a component or boundary)`);
  if (node.style && (node.style.fill || node.style.stroke || node.style.fontColor)) lost.add("Colours and fonts (the platform's conventions apply)");
  if (node.tooltip || node.link) lost.add("Tooltips and links");
  if (node.classes?.length) lost.add("D2 classes");
}

function noteEdgeLosses(edge: DiagramEdge, lost: Set<string>): void {
  if (edge.style && (edge.style.stroke || edge.style.strokeDash)) lost.add("Line colours and dash styles (connector meanings decide them)");
  if (edge.srcArrow !== "none" && edge.dstArrow !== "none") lost.add("Two-headed arrows (become one-way requests)");
}

function iconKeyOf(url: string | undefined): string | undefined {
  return url?.match(/^\/icons\/([a-z0-9-]+)\.svg$/)?.[1];
}

function lastSegment(id: string): string {
  return id.split(".").at(-1)?.replace(/^"|"$/g, "") ?? id;
}

function titleOf(model: DiagramModel): string {
  const top = model.nodes.filter((n) => n.parent === null && n.container);
  return top.length === 1 ? top[0].label : "Architecture";
}
