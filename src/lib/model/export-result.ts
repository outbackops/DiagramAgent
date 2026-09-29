import { allItems, isBoundary, type BoundaryKind, type NBoundary, type NComponent, type NItem, type NormalizedArchSpec, type Platform } from "@/lib/arch/spec";
import { boundaryPlatform, inferPlatform } from "@/lib/arch/styles";
import type { DiagramEdge, DiagramModel, DiagramNode } from "./types";

export interface ExportResult<T = string> {
  content: T;
  warnings: string[];
}

export function uniqueWarnings(warnings: Array<string | null | undefined>): string[] {
  return [...new Set(warnings.filter((warning): warning is string => Boolean(warning?.trim())).map((warning) => warning.trim()))];
}

export function exportResult<T>(content: T, warnings: Array<string | null | undefined> = []): ExportResult<T> {
  return { content, warnings: uniqueWarnings(warnings) };
}

export interface ArchitectureExportView {
  platform: Platform;
  boundaryPlatforms: Map<string, Platform>;
}

export function architectureExportView(model: DiagramModel): ArchitectureExportView {
  const children = new Map<string | null, DiagramNode[]>();
  for (const node of model.nodes) {
    if (node.generated) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }
  const iconKeyOf = (url: string | undefined) => url?.match(/^\/icons\/([a-z0-9-]+)\.svg$/)?.[1];
  const toItem = (node: DiagramNode): NItem =>
    node.container
      ? ({ type: "boundary", id: node.id, kind: (node.arch?.kind ?? "group") as BoundaryKind, name: node.label, items: (children.get(node.id) ?? []).map(toItem), ...(node.arch?.platform ? { platform: node.arch.platform } : {}) } as NBoundary)
      : ({ type: "component", id: node.id, name: node.label, ...(node.arch?.iconKey ? { icon: node.arch.iconKey } : iconKeyOf(node.icon) ? { icon: iconKeyOf(node.icon) } : {}) } as NComponent);
  const items = (children.get(null) ?? []).map(toItem);
  const spec: NormalizedArchSpec = { version: 1, title: model.arch?.title ?? "", items, connections: [], sequences: [], overlays: [], assumptions: [] };
  if (model.arch?.platform) spec.platform = model.arch.platform;
  const platform = inferPlatform(spec);
  const boundaryPlatforms = new Map<string, Platform>();
  for (const item of allItems(items)) if (isBoundary(item)) boundaryPlatforms.set(item.id, boundaryPlatform(item, platform));
  return { platform, boundaryPlatforms };
}

export function stepPrefix(edge: DiagramEdge): string {
  if (!edge.badges?.length) return "";
  return edge.badges.map((badge) => `(${badge.number})`).join(" ");
}

export function architectureTextWarnings(format: "D2" | "Mermaid"): string[] {
  return [
    `${format} export keeps architecture topology, grouping, labels, step numbers, and hidden logical links, but drops embedded icons, exact visual styles, editable badge geometry, overlays, and legend/workflow/assumptions layout.`,
  ];
}

export function warningsHeaderValue(warnings: string[]): string {
  return encodeURIComponent(JSON.stringify(uniqueWarnings(warnings)));
}

export function architecturePageLines(model: DiagramModel, node: DiagramNode): string[] {
  const arch = model.arch;
  if (!arch || !node.generated) return [node.label];
  if (node.role === "title") return [arch.title, arch.subtitle].filter((line): line is string => Boolean(line));
  if (node.role === "workflow") {
    const lines = ["Workflow"];
    for (const sequence of arch.sequences) {
      if (sequence.steps.length === 0) continue;
      lines.push(sequence.name);
      sequence.steps.forEach((step, index) => lines.push(`(${index + 1}) ${step}`));
    }
    return lines;
  }
  if (node.role === "legend") {
    const meanings = [...new Set(model.edges.filter((edge) => !edge.hidden).map((edge) => edge.meaning ?? "request"))];
    return ["Legend", ...meanings.map((meaning) => `Line: ${meaning}`), ...arch.sequences.map((sequence) => `Steps: ${sequence.name}`)];
  }
  if (node.role === "assumptions") return ["Assumptions", ...arch.assumptions.map((assumption) => `• ${assumption}`)];
  return [node.label];
}
