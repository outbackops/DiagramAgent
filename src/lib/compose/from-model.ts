import type { DiagramEdge, DiagramModel, DiagramNode, Tone } from "@/lib/model/types";
import {
  FOOTER_ID,
  HEADER_ID,
  type CompositionSpec,
  type SpecCard,
  type SpecColumn,
  type SpecConnector,
  type SpecFlow,
  type SpecFooter,
  type SpecGrid,
  type SpecItem,
  type SpecStep,
} from "./spec";

/** Derives a CompositionSpec from any DiagramModel so AI edits and Tidy up can recompose it. */
export function modelToSpec(model: DiagramModel): CompositionSpec {
  const nodes = [...model.nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = childIndex(nodes);
  const header = nodes.find((node) => node.id === HEADER_ID || node.role === "header");
  const footer = nodes.find((node) => node.id === FOOTER_ID || node.role === "footer");
  const columns = deriveColumns(nodes, children);

  const spec: CompositionSpec = {
    title: header?.label || "Architecture overview",
    columns: columns.map((column) => columnToSpec(column, children)),
  };
  const subtitle = header?.content?.subtitle;
  if (subtitle) spec.subtitle = subtitle;
  if (header?.content?.badge) {
    spec.badge = header.content.badgeDetail ? { title: header.content.badge, detail: header.content.badgeDetail } : { title: header.content.badge };
  }
  const connectors = edgesToConnectors(model.edges, byId);
  if (connectors.length) spec.connectors = connectors;
  const specFooter = footerToSpec(footer);
  if (specFooter) spec.footer = specFooter;
  return spec;
}

function deriveColumns(nodes: DiagramNode[], children: Map<string | null, DiagramNode[]>): DiagramNode[] {
  const explicit = nodes.filter((node) => node.parent === null && node.role === "column").sort(byX);
  const topContainers = nodes.filter((node) => node.parent === null && node.container && !node.role && node.id !== HEADER_ID && node.id !== FOOTER_ID).sort(byX);
  let columns = [...explicit, ...topContainers].sort(byX);
  const topLeaves = nodes.filter((node) => node.parent === null && !node.container && !node.role && node.id !== HEADER_ID && node.id !== FOOTER_ID);
  if (!columns.length && topLeaves.length) {
    columns = [syntheticColumn("components", "Components", topLeaves)];
  }
  if (!columns.length) {
    const laneOrphans = nodes.filter((node) => node.parent === null && node.role === "lane").sort(byYThenX);
    if (laneOrphans.length) columns = [syntheticColumn("components", "Components", laneOrphans)];
  }
  for (const leaf of topLeaves) {
    if (!leaf.parent && !columns.some((column) => column.id === leaf.id)) {
      const column = nearestColumn(leaf, columns);
      if (column) {
        children.set(column.id, [...(children.get(column.id) ?? []), leaf]);
      }
    }
  }
  return columns.length ? columns : [syntheticColumn("components", "Components", [])];
}

function syntheticColumn(id: string, label: string, items: DiagramNode[]): DiagramNode {
  const x = items.length ? Math.min(...items.map((node) => node.box.x)) : 0;
  const y = items.length ? Math.min(...items.map((node) => node.box.y)) : 0;
  const right = items.length ? Math.max(...items.map((node) => node.box.x + node.box.w)) : 300;
  const bottom = items.length ? Math.max(...items.map((node) => node.box.y + node.box.h)) : 300;
  return {
    id: `__synthetic_${id}`,
    parent: null,
    label,
    shape: "rectangle",
    box: { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) },
    style: {},
    container: true,
    role: "column",
    content: { size: "normal" },
  };
}

function columnToSpec(column: DiagramNode, children: Map<string | null, DiagramNode[]>): SpecColumn {
  const direct = children.get(column.id) ?? [];
  const spec: SpecColumn = {
    id: localId(column),
    title: column.label || localId(column),
    items: direct.sort(byYThenX).flatMap((node) => nodeToItems(node, children, "column")),
  };
  const size = column.content?.size;
  if (size) spec.size = size;
  return pruneColumn(spec);
}

function nodeToItems(node: DiagramNode, children: Map<string | null, DiagramNode[]>, parentKind: "column" | "lane" | "grid"): SpecItem[] {
  if (parentKind === "lane") return [stepToSpec(node, undefined) as unknown as SpecItem];
  if (node.role === "banner") return [bannerToSpec(node)];
  if (node.role === "grid") return [gridToSpec(node, children)];
  if (node.role === "lane") return [laneToSpec(node, children)];
  if (node.role === "card" || !node.container) return [cardToSpec(node)];
  if (node.container) return [containerToFlow(node, children)];
  return [];
}

function cardToSpec(node: DiagramNode): SpecCard {
  const card: SpecCard = { type: "card", id: localId(node), title: node.label || localId(node) };
  const lines = compact(node.content?.lines);
  if (lines.length) card.lines = lines;
  const notes = compact(node.content?.notes);
  if (notes.length) card.note = notes.join(" · ");
  if (node.tone) card.tone = node.tone;
  const icon = iconKey(node.icon);
  if (icon) card.icon = icon;
  const usedBy = compact(node.content?.usedBy);
  if (usedBy.length) card.usedBy = usedBy;
  return card;
}

function bannerToSpec(node: DiagramNode): SpecItem {
  const banner: SpecItem = { type: "banner", id: localId(node), title: node.label || localId(node) };
  if (node.content?.subtitle) banner.text = node.content.subtitle;
  if (node.tone) banner.tone = node.tone;
  return banner;
}

function gridToSpec(node: DiagramNode, children: Map<string | null, DiagramNode[]>): SpecGrid {
  const grid: SpecGrid = {
    type: "grid",
    id: localId(node),
    items: orderedGridCards(children.get(node.id) ?? []).map(cardToSpec),
  };
  if (node.content?.columns) grid.columns = node.content.columns;
  return grid;
}

function laneToSpec(node: DiagramNode, children: Map<string | null, DiagramNode[]>): SpecFlow {
  const steps = [...(children.get(node.id) ?? [])]
    .filter((child) => child.role === "step" || !child.role)
    .sort(node.content?.vertical ? byYThenX : byXThenY)
    .map((child) => stepToSpec(child, node.tone));
  const flow: SpecFlow = {
    type: "flow",
    id: localId(node),
    title: node.label || localId(node),
    steps,
  };
  if (node.content?.badge) flow.label = node.content.badge;
  if (node.content?.subtitle) flow.subtitle = node.content.subtitle;
  if (node.content?.tag) flow.tag = node.content.tag;
  if (node.tone) flow.tone = node.tone;
  const notes = compact(node.content?.notes);
  if (notes.length) flow.notes = notes;
  const chips = compact(node.content?.chips);
  if (chips.length) flow.chips = node.content?.chipsLabel ? { label: node.content.chipsLabel, items: chips } : { items: chips };
  return flow;
}

function containerToFlow(node: DiagramNode, children: Map<string | null, DiagramNode[]>): SpecFlow {
  const lane = laneToSpec({ ...node, role: "lane" }, children);
  lane.steps = flattenLeaves(node, children).sort(node.content?.vertical ? byYThenX : byXThenY).map((child) => stepToSpec(child, node.tone));
  return lane;
}

function stepToSpec(node: DiagramNode, laneTone: Tone | undefined): SpecStep {
  const step: SpecStep = { id: localId(node), title: node.label || localId(node) };
  const lines = compact(node.content?.lines);
  if (lines.length) step.lines = lines;
  if (node.tone && node.tone !== laneTone) step.tone = node.tone;
  const icon = iconKey(node.icon);
  if (icon) step.icon = icon;
  return step;
}

function footerToSpec(node: DiagramNode | undefined): SpecFooter | undefined {
  if (!node) return undefined;
  const footer: SpecFooter = { title: node.label || "Outcome", text: node.content?.subtitle ?? "" };
  if (node.content?.tag) footer.status = node.content.tag;
  if (node.content?.badgeDetail) footer.statusDetail = node.content.badgeDetail;
  return footer;
}

function edgesToConnectors(edges: DiagramEdge[], byId: Map<string, DiagramNode>): SpecConnector[] {
  const lastSegmentCounts = new Map<string, number>();
  for (const id of byId.keys()) lastSegmentCounts.set(lastSegment(id), (lastSegmentCounts.get(lastSegment(id)) ?? 0) + 1);
  const out: SpecConnector[] = [];
  for (const edge of edges) {
    if (edge.kind === "step") continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || !validConnectorNode(from) || !validConnectorNode(to)) continue;
    const connector: SpecConnector = {
      from: refFor(from, lastSegmentCounts),
      to: refFor(to, lastSegmentCounts),
      kind: edge.kind === "call" ? "call" : "flow",
    };
    if (edge.label) connector.label = edge.label;
    if (edge.tone) connector.tone = edge.tone;
    out.push(connector);
  }
  return out;
}

function validConnectorNode(node: DiagramNode): boolean {
  return node.id !== HEADER_ID && node.id !== FOOTER_ID && node.role !== "header" && node.role !== "footer" && node.role !== "column" && node.role !== "grid";
}

function refFor(node: DiagramNode, counts: Map<string, number>): string {
  const segment = lastSegment(node.id);
  return counts.get(segment) === 1 ? segment : node.id;
}

function childIndex(nodes: DiagramNode[]): Map<string | null, DiagramNode[]> {
  const children = new Map<string | null, DiagramNode[]>();
  for (const node of nodes) {
    const current = children.get(node.parent) ?? [];
    current.push(node);
    children.set(node.parent, current);
  }
  return children;
}

function orderedGridCards(nodes: DiagramNode[]): DiagramNode[] {
  const sorted = [...nodes].sort(byYThenX);
  const rows: DiagramNode[][] = [];
  for (const node of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0].box.y - node.box.y) < 8);
    if (row) row.push(node);
    else rows.push([node]);
  }
  return rows.flatMap((row) => row.sort(byX));
}

function flattenLeaves(node: DiagramNode, children: Map<string | null, DiagramNode[]>): DiagramNode[] {
  const direct = children.get(node.id) ?? [];
  return direct.flatMap((child) => (child.container ? flattenLeaves(child, children) : [child]));
}

function nearestColumn(node: DiagramNode, columns: DiagramNode[]): DiagramNode | undefined {
  const center = node.box.x + node.box.w / 2;
  return [...columns].sort((a, b) => distanceToColumn(center, a) - distanceToColumn(center, b))[0];
}

function distanceToColumn(x: number, column: DiagramNode): number {
  if (x >= column.box.x && x <= column.box.x + column.box.w) return 0;
  return Math.min(Math.abs(x - column.box.x), Math.abs(x - (column.box.x + column.box.w)));
}

function pruneColumn(column: SpecColumn): SpecColumn {
  const items = column.items.filter((item) => {
    if (item.type === "grid") return item.items.length > 0;
    if (item.type === "flow") return item.steps.length > 0;
    return true;
  });
  return { ...column, items };
}

function iconKey(icon: string | undefined): string | undefined {
  const match = icon?.match(/^\/icons\/([a-z0-9-]+)\.svg$/);
  return match?.[1];
}

function localId(node: DiagramNode): string {
  return lastSegment(node.id).replace(/^__synthetic_/, "");
}

function lastSegment(id: string): string {
  return id.split(".").at(-1) ?? id;
}

function compact(values: readonly string[] | undefined): string[] {
  return values?.filter((value) => value.trim().length > 0) ?? [];
}

function byX(a: DiagramNode, b: DiagramNode): number {
  return a.box.x - b.box.x || a.box.y - b.box.y || a.id.localeCompare(b.id);
}

function byYThenX(a: DiagramNode, b: DiagramNode): number {
  return a.box.y - b.box.y || a.box.x - b.box.x || a.id.localeCompare(b.id);
}

function byXThenY(a: DiagramNode, b: DiagramNode): number {
  return a.box.x - b.box.x || a.box.y - b.box.y || a.id.localeCompare(b.id);
}
