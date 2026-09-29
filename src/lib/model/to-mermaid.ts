import { indexModel } from "./query";
import { architectureTextWarnings, exportResult, stepPrefix, type ExportResult } from "./export-result";
import { diagramKind } from "./kind";
import type { DiagramModel, DiagramNode } from "./types";

function direction(model: DiagramModel): string {
  switch (model.layout?.direction) {
    case "up":
      return "BT";
    case "down":
      return "TB";
    case "left":
      return "RL";
    case "right":
    default:
      return "LR";
  }
}

function safeBase(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `n_${cleaned || "node"}`;
}

function mermaidIds(model: DiagramModel): Map<string, string> {
  const counts = new Map<string, number>();
  const ids = new Map<string, string>();
  for (const node of model.nodes) {
    const base = safeBase(node.id);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    ids.set(node.id, count === 0 ? base : `${base}_${count + 1}`);
  }
  return ids;
}

function label(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "#quot;").replace(/\n/g, "<br/>");
}

function nodeSyntax(id: string, node: DiagramNode): string {
  const text = `"${label(node.label)}"`;
  switch (node.shape) {
    case "cylinder":
    case "queue":
      return `${id}[(${text})]`;
    case "circle":
      return `${id}((${text}))`;
    case "oval":
      return `${id}([${text}])`;
    case "diamond":
      return `${id}{${text}}`;
    case "hexagon":
      return `${id}{{${text}}}`;
    case "person":
    case "cloud":
      return `${id}(${text})`;
    default:
      return `${id}[${text}]`;
  }
}

function emitGroup(node: DiagramNode, lines: string[], ids: Map<string, string>, children: Map<string | null, DiagramNode[]>, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}subgraph ${ids.get(node.id) ?? safeBase(node.id)}["${label(node.label)}"]`);
  for (const child of children.get(node.id) ?? []) {
    if (child.container) emitGroup(child, lines, ids, children, depth + 1);
    else lines.push(`${indent}  ${nodeSyntax(ids.get(child.id) ?? safeBase(child.id), child)}`);
  }
  lines.push(`${indent}end`);
}

function archNodeLabel(node: DiagramNode): string {
  return [node.label, node.arch?.detail].filter(Boolean).join("\n");
}

function emitArchGroup(node: DiagramNode, lines: string[], ids: Map<string, string>, children: Map<string | null, DiagramNode[]>, depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}subgraph ${ids.get(node.id) ?? safeBase(node.id)}["${label([node.label, node.arch?.facts].filter(Boolean).join("\n"))}"]`);
  for (const child of children.get(node.id) ?? []) {
    if (child.generated) continue;
    if (child.role === "boundary" || child.container) emitArchGroup(child, lines, ids, children, depth + 1);
    else lines.push(`${indent}  ${nodeSyntax(ids.get(child.id) ?? safeBase(child.id), { ...child, label: archNodeLabel(child) })}`);
  }
  lines.push(`${indent}end`);
}

function modelToArchitectureMermaid(model: DiagramModel): string {
  const ids = mermaidIds(model);
  const index = indexModel(model);
  const lines = [`flowchart ${direction(model)}`];
  for (const node of index.children.get(null) ?? []) {
    if (node.generated) continue;
    if (node.role === "boundary" || node.container) emitArchGroup(node, lines, ids, index.children, 1);
    else lines.push(`  ${nodeSyntax(ids.get(node.id) ?? safeBase(node.id), { ...node, label: archNodeLabel(node) })}`);
  }
  for (const edge of model.edges) {
    const from = ids.get(edge.from) ?? safeBase(edge.from);
    const to = ids.get(edge.to) ?? safeBase(edge.to);
    const arrow = edge.hidden || edge.style.strokeDash ? "-.->" : "-->";
    const parts = [stepPrefix(edge), edge.hidden ? "logical link" : "", edge.label ?? ""].filter(Boolean);
    const edgeLabel = parts.length ? `|"${label(parts.join(" "))}"|` : "";
    lines.push(`  ${from} ${arrow}${edgeLabel} ${to}`);
  }
  return lines.join("\n");
}

export function modelToMermaidResult(model: DiagramModel): ExportResult<string> {
  if (diagramKind(model) === "architecture") return exportResult(modelToArchitectureMermaid(model), architectureTextWarnings("Mermaid"));
  return exportResult(modelToMermaidGraph(model));
}

function modelToMermaidGraph(model: DiagramModel): string {
  const ids = mermaidIds(model);
  const index = indexModel(model);
  const lines = [`flowchart ${direction(model)}`];
  for (const node of index.children.get(null) ?? []) {
    if (node.container) emitGroup(node, lines, ids, index.children, 1);
    else lines.push(`  ${nodeSyntax(ids.get(node.id) ?? safeBase(node.id), node)}`);
  }
  for (const edge of model.edges) {
    const from = ids.get(edge.from) ?? safeBase(edge.from);
    const to = ids.get(edge.to) ?? safeBase(edge.to);
    const arrow = edge.style.strokeDash ? "-.->" : "-->";
    const edgeLabel = edge.label ? `|"${label(edge.label)}"|` : "";
    lines.push(`  ${from} ${arrow}${edgeLabel} ${to}`);
  }
  return lines.join("\n");
}

export function modelToMermaid(model: DiagramModel): string {
  return modelToMermaidResult(model).content;
}
