import { keyOf } from "./query";
import { architectureTextWarnings, exportResult, stepPrefix, type ExportResult } from "./export-result";
import { diagramKind } from "./kind";
import type { Arrowhead, DiagramModel, DiagramNode, EdgeStyle, LayoutHints, NodeStyle } from "./types";

type StyleValue = string | number | boolean;

interface ClassGroup {
  name: string;
  key: string;
  styles: Record<string, StyleValue>;
  nodes: DiagramNode[];
}

const INDENT = "  ";

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function unquoteKey(key: string): string {
  if ((key.startsWith("\"") && key.endsWith("\"")) || (key.startsWith("'") && key.endsWith("'"))) return key.slice(1, -1);
  return key;
}

function d2Key(key: string): string {
  if ((key.startsWith("\"") && key.endsWith("\"")) || (key.startsWith("'") && key.endsWith("'"))) return key;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : quoteString(key);
}

function formatValue(value: StyleValue): string {
  return typeof value === "string" ? quoteString(value) : String(value);
}

function layoutLines(layout: LayoutHints | undefined): string[] {
  if (!layout) return [];
  const lines: string[] = [];
  if (layout.direction) lines.push(`direction: ${layout.direction}`);
  if (isSet(layout.gridRows)) lines.push(`grid-rows: ${layout.gridRows}`);
  if (isSet(layout.gridColumns)) lines.push(`grid-columns: ${layout.gridColumns}`);
  if (isSet(layout.gridGap)) lines.push(`grid-gap: ${layout.gridGap}`);
  return lines;
}

function d2Near(position: string): string | undefined {
  const match = /^(INSIDE|OUTSIDE)_(TOP|MIDDLE|BOTTOM)_(LEFT|CENTER|RIGHT)$/.exec(position);
  if (!match) return undefined;
  const [, scope, vertical, horizontal] = match;
  if (scope === "OUTSIDE" && vertical === "MIDDLE") return undefined;
  const parts = [];
  if (scope === "OUTSIDE") parts.push("outside");
  parts.push(vertical.toLowerCase() === "middle" ? "center" : vertical.toLowerCase());
  parts.push(horizontal.toLowerCase());
  return parts.join("-");
}

function defaultLabelPosition(node: DiagramNode): string {
  if (node.shape === "image") return "OUTSIDE_BOTTOM_CENTER";
  if (node.container) return "INSIDE_TOP_CENTER";
  if (node.icon) return "INSIDE_TOP_CENTER";
  return "INSIDE_MIDDLE_CENTER";
}

// Values equal to D2's own defaults are left out: the export stays short for
// the AI to read and edit, and D2 compiles them back to the same values.
const isDefault = (value: StyleValue | undefined, fallback: StyleValue) => value === fallback;

function nodeStyleProps(style: NodeStyle): Record<string, StyleValue> {
  const props: Record<string, StyleValue> = {};
  if (isSet(style.fill)) props["style.fill"] = style.fill!;
  if (isSet(style.stroke)) props["style.stroke"] = style.stroke!;
  if (isSet(style.strokeWidth)) props["style.stroke-width"] = style.strokeWidth!;
  if (isSet(style.strokeDash) && !isDefault(style.strokeDash, 0)) props["style.stroke-dash"] = style.strokeDash!;
  if (isSet(style.borderRadius)) props["style.border-radius"] = style.borderRadius!;
  if (isSet(style.opacity) && !isDefault(style.opacity, 1)) props["style.opacity"] = style.opacity!;
  if (style.shadow) props["style.shadow"] = true;
  if (style.multiple) props["style.multiple"] = true;
  if (style.doubleBorder) props["style.double-border"] = true;
  if (isSet(style.fontSize)) props["style.font-size"] = style.fontSize!;
  if (isSet(style.fontColor)) props["style.font-color"] = style.fontColor!;
  if (isSet(style.bold)) props["style.bold"] = style.bold!;
  if (style.italic) props["style.italic"] = true;
  if (style.underline) props["style.underline"] = true;
  return props;
}

function edgeStyleProps(style: EdgeStyle): Record<string, StyleValue> {
  const props: Record<string, StyleValue> = {};
  if (isSet(style.stroke)) props["style.stroke"] = style.stroke!;
  if (isSet(style.strokeWidth)) props["style.stroke-width"] = style.strokeWidth!;
  if (isSet(style.strokeDash) && !isDefault(style.strokeDash, 0)) props["style.stroke-dash"] = style.strokeDash!;
  if (isSet(style.opacity) && !isDefault(style.opacity, 1)) props["style.opacity"] = style.opacity!;
  if (isSet(style.borderRadius)) props["style.border-radius"] = style.borderRadius!;
  if (isSet(style.fontSize)) props["style.font-size"] = style.fontSize!;
  if (isSet(style.fontColor)) props["style.font-color"] = style.fontColor!;
  if (style.bold) props["style.bold"] = true;
  if (style.italic) props["style.italic"] = true;
  return props;
}

function styleKey(styles: Record<string, StyleValue>): string {
  return Object.keys(styles)
    .sort()
    .map((key) => `${key}:${String(styles[key])}`)
    .join("|");
}

function uniqueClassName(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  for (let i = 1; ; i++) {
    const name = `s${i}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
}

function classGroups(nodes: DiagramNode[]): ClassGroup[] {
  const byStyle = new Map<string, ClassGroup>();
  for (const node of nodes) {
    const styles = nodeStyleProps(node.style);
    const key = styleKey(styles);
    if (!key) continue;
    const group = byStyle.get(key);
    if (group) {
      group.nodes.push(node);
    } else {
      byStyle.set(key, { name: "", key, styles, nodes: [node] });
    }
  }

  const used = new Set<string>();
  let generated = 1;
  for (const group of byStyle.values()) {
    const firstClasses = new Set(group.nodes.map((node) => node.classes?.[0]).filter((name): name is string => Boolean(name)));
    if (firstClasses.size === 1) {
      group.name = uniqueClassName([...firstClasses][0], used);
    } else {
      while (used.has(`s${generated}`)) generated++;
      group.name = uniqueClassName(`s${generated++}`, used);
    }
  }
  return [...byStyle.values()];
}

function iconValue(icon: string, mode: "keys" | "paths"): string {
  const match = /^\/icons\/([A-Za-z0-9._-]+)\.svg$/.exec(icon);
  if (mode !== "paths" && match) return match[1];
  return /^[A-Za-z0-9_-]+$/.test(icon) || icon.startsWith("/") ? icon : quoteString(icon);
}

function emitStyleBlock(lines: string[], styles: Record<string, StyleValue>, indent: string): void {
  for (const key of Object.keys(styles).sort()) lines.push(`${indent}${key}: ${formatValue(styles[key])}`);
}

function addArrowhead(styles: Record<string, StyleValue>, prefix: "source" | "target", arrowhead: Arrowhead): void {
  if (arrowhead === "none") {
    styles[`${prefix}-arrowhead.shape`] = "none";
    return;
  }
  if (arrowhead === "filled-diamond" || arrowhead === "filled-circle" || arrowhead === "filled-box") {
    styles[`${prefix}-arrowhead.shape`] = arrowhead.replace("filled-", "");
    styles[`${prefix}-arrowhead.style.filled`] = true;
    return;
  }
  if (arrowhead === "unfilled-triangle") {
    styles[`${prefix}-arrowhead.shape`] = "triangle";
    styles[`${prefix}-arrowhead.style.filled`] = false;
    return;
  }
  if (arrowhead === "line") {
    styles[`${prefix}-arrowhead.shape`] = "arrow";
    return;
  }
  styles[`${prefix}-arrowhead.shape`] = arrowhead;
}

function chooseOperator(srcArrow: Arrowhead, dstArrow: Arrowhead): string {
  if (srcArrow !== "none" && dstArrow !== "none") return "<->";
  if (srcArrow !== "none") return "<-";
  if (dstArrow !== "none") return "->";
  return "--";
}

function archLabel(node: DiagramNode): string {
  return [node.label, node.arch?.facts ?? node.arch?.detail].filter(Boolean).join("\n");
}

function modelToArchitectureD2(model: DiagramModel): string {
  const lines: string[] = [];
  lines.push(...layoutLines(model.layout));
  if (lines.length > 0) lines.push("");
  const children = new Map<string | null, DiagramNode[]>();
  for (const node of model.nodes) {
    if (node.generated) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }
  const emitNode = (node: DiagramNode, depth: number) => {
    const indent = INDENT.repeat(depth);
    const key = d2Key(keyOf(node.id));
    lines.push(`${indent}${key}: ${quoteString(archLabel(node))}${node.container || node.role === "boundary" ? " {" : ""}`);
    if (node.container || node.role === "boundary") {
      for (const child of children.get(node.id) ?? []) emitNode(child, depth + 1);
      lines.push(`${indent}}`, "");
    }
  };
  for (const node of children.get(null) ?? []) emitNode(node, 0);
  for (const edge of model.edges) {
    const operator = edge.hidden ? "--" : chooseOperator(edge.srcArrow, edge.dstArrow);
    const parts = [stepPrefix(edge, model), edge.hidden ? "logical link" : "", edge.label ?? ""].filter(Boolean);
    const label = parts.length ? `: ${quoteString(parts.join(" "))}` : "";
    if (edge.hidden) {
      lines.push(`${edge.from} ${operator} ${edge.to}${label} {`);
      lines.push(`${INDENT}style.stroke-dash: 4`);
      lines.push("}");
    } else {
      lines.push(`${edge.from} ${operator} ${edge.to}${label}`);
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function modelToD2Result(model: DiagramModel, options: { icons?: "keys" | "paths" } = {}): ExportResult<string> {
  if (diagramKind(model) === "architecture") return exportResult(modelToArchitectureD2(model), architectureTextWarnings("D2"));
  return exportResult(modelToD2Graph(model, options));
}

function modelToD2Graph(model: DiagramModel, options: { icons?: "keys" | "paths" } = {}): string {
  const iconMode = options.icons ?? "keys";
  const lines: string[] = [];
  const groups = classGroups(model.nodes);
  const classByNode = new Map<string, string>();
  for (const group of groups) {
    for (const node of group.nodes) classByNode.set(node.id, group.name);
  }

  lines.push(...layoutLines(model.layout));
  if (lines.length > 0) lines.push("");

  if (groups.length > 0) {
    lines.push("classes: {");
    for (const group of groups) {
      lines.push(`${INDENT}${d2Key(group.name)}: {`);
      emitStyleBlock(lines, group.styles, INDENT.repeat(2));
      lines.push(`${INDENT}}`);
    }
    lines.push("}", "");
  }

  const children = new Map<string | null, DiagramNode[]>();
  for (const node of model.nodes) {
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }

  const emitNode = (node: DiagramNode, depth: number) => {
    const indent = INDENT.repeat(depth);
    const key = keyOf(node.id);
    const renderedKey = d2Key(key);
    const labelSuffix = node.label && node.label !== unquoteKey(key) ? `: ${quoteString(node.label)}` : ":";
    const className = classByNode.get(node.id);
    if (className) lines.push(`${indent}${renderedKey}.class: ${d2Key(className)}`);
    lines.push(`${indent}${renderedKey}${labelSuffix} {`);
    const body = INDENT.repeat(depth + 1);
    if (node.shape !== "rectangle") lines.push(`${body}shape: ${node.shape}`);
    if (node.icon) lines.push(`${body}icon: ${iconValue(node.icon, iconMode)}`);
    if (node.tooltip) lines.push(`${body}tooltip: ${quoteString(node.tooltip)}`);
    if (node.link) lines.push(`${body}link: ${quoteString(node.link)}`);
    const labelNear = node.labelPosition && node.labelPosition !== defaultLabelPosition(node) ? d2Near(node.labelPosition) : undefined;
    if (labelNear) lines.push(`${body}label.near: ${labelNear}`);
    const iconNear = node.iconPosition && node.iconPosition !== "INSIDE_MIDDLE_CENTER" ? d2Near(node.iconPosition) : undefined;
    if (iconNear) lines.push(`${body}icon.near: ${iconNear}`);
    for (const line of layoutLines(node.layout)) lines.push(`${body}${line}`);
    for (const child of children.get(node.id) ?? []) emitNode(child, depth + 1);
    lines.push(`${indent}}`, "");
  };

  for (const node of children.get(null) ?? []) emitNode(node, 0);

  for (const edge of model.edges) {
    const label = edge.label ? `: ${quoteString(edge.label)}` : "";
    const styles = edgeStyleProps(edge.style);
    const operator = chooseOperator(edge.srcArrow, edge.dstArrow);
    if ((operator === "<->" || operator === "<-") && edge.srcArrow !== "triangle") addArrowhead(styles, "source", edge.srcArrow);
    if ((operator === "<->" || operator === "->") && edge.dstArrow !== "triangle") addArrowhead(styles, "target", edge.dstArrow);
    const keys = Object.keys(styles).sort();
    if (keys.length === 0) {
      lines.push(`${edge.from} ${operator} ${edge.to}${label}`);
    } else {
      lines.push(`${edge.from} ${operator} ${edge.to}${label} {`);
      emitStyleBlock(lines, styles, INDENT);
      lines.push("}");
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function modelToD2(model: DiagramModel, options: { icons?: "keys" | "paths" } = {}): string {
  return modelToD2Result(model, options).content;
}
