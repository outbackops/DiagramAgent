import { compileD2, type CompiledConnection, type CompiledDiagram, type CompiledShape } from "@/lib/d2-render";
import { resolveColor } from "./d2-theme";
import { joinPath, splitPath } from "./query";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode, EdgeStyle, LayoutHints, NodeStyle } from "./types";

const SAFE_ICON = /^\/icons\/[A-Za-z0-9._-]+\.svg$/;
const DATA_IMAGE = /^data:image\//;
const UNSUPPORTED_SHAPES = new Set(["sequence_diagram", "sql_table", "class", "code", "markdown"]);

interface SourceHints {
  modelLayout?: LayoutHints;
  nodeLayouts: Map<string, LayoutHints>;
  warnings: string[];
}

function parentPath(id: string): string | null {
  const keys = splitPath(id);
  if (keys.length <= 1) return null;
  return keys.slice(0, -1).join(".");
}

function direction(value: string): LayoutHints["direction"] | undefined {
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : undefined;
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && i + 1 < line.length) i++;
      else if (ch === quote) quote = null;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function firstBrace(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && i + 1 < line.length) i++;
      else if (ch === quote) quote = null;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === "{") {
      return i;
    }
  }
  return -1;
}

function localKeyFromBlockHead(head: string): string | null {
  const trimmed = head.trim();
  if (!trimmed || trimmed === "classes:" || trimmed.includes("->")) return null;
  const match = /^((?:"(?:\\.|[^"])+")|(?:'(?:\\.|[^'])+')|(?:[^\s:]+))(?::(?:\s+.*)?)?$/.exec(trimmed);
  return match?.[1] ?? null;
}

function setHint(layout: LayoutHints, key: string, value: string): void {
  if (key === "direction") {
    const d = direction(value.trim().replace(/^["']|["']$/g, ""));
    if (d) layout.direction = d;
  } else if (key === "grid-rows") {
    layout.gridRows = parseNumber(value);
  } else if (key === "grid-columns") {
    layout.gridColumns = parseNumber(value);
  } else if (key === "grid-gap" || key === "horizontal-gap" || key === "vertical-gap") {
    layout.gridGap = parseNumber(value);
  }
}

function parseSourceHints(code: string | undefined): SourceHints {
  const hints: SourceHints = { nodeLayouts: new Map(), warnings: [] };
  if (!code) return hints;
  if (/\b(layers|scenarios|steps)\s*:\s*\{/.test(code)) hints.warnings.push("D2 layers/scenarios/steps are not represented in the diagram model.");
  if (/\bnear\s*:/.test(code) || /\bnear\s*=/.test(code)) hints.warnings.push("D2 near constants are not represented in the diagram model.");
  if (/```\w+/.test(code)) hints.warnings.push("D2 text/code blocks with languages are imported as labels only.");

  const stack: string[] = [];
  let classDepth = 0;
  for (const raw of code.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    if (classDepth > 0) {
      classDepth += (line.match(/\{/g) ?? []).length;
      classDepth -= (line.match(/\}/g) ?? []).length;
      continue;
    }

    const prop = /^(direction|grid-rows|grid-columns|grid-gap|horizontal-gap|vertical-gap)\s*:\s*(.+)$/.exec(line);
    if (prop) {
      if (stack.length === 0) {
        hints.modelLayout ??= {};
        setHint(hints.modelLayout, prop[1], prop[2]);
      } else {
        const id = stack[stack.length - 1];
        const layout = hints.nodeLayouts.get(id) ?? {};
        setHint(layout, prop[1], prop[2]);
        hints.nodeLayouts.set(id, layout);
      }
      continue;
    }

    const brace = firstBrace(line);
    if (brace >= 0) {
      const head = line.slice(0, brace).trim();
      if (head === "classes:") {
        classDepth = 1;
      } else {
        const key = localKeyFromBlockHead(head);
        if (key) {
          const id = joinPath(stack[stack.length - 1] ?? null, key);
          stack.push(id);
        }
      }
    }

    const closes = (line.match(/\}/g) ?? []).length;
    for (let i = 0; i < closes && stack.length > 0; i++) stack.pop();
  }
  return hints;
}

function iconPath(icon: unknown): string | undefined {
  if (typeof icon === "string") return icon;
  if (icon && typeof icon === "object") {
    const path = (icon as Record<string, unknown>).Path;
    return typeof path === "string" ? path : undefined;
  }
  return undefined;
}

function nodeStyle(shape: CompiledShape): NodeStyle {
  return {
    fill: resolveColor(shape.fill),
    stroke: resolveColor(shape.stroke),
    strokeWidth: shape.strokeWidth,
    strokeDash: shape.strokeDash,
    borderRadius: shape.borderRadius,
    opacity: shape.opacity,
    shadow: shape.shadow,
    multiple: shape.multiple,
    doubleBorder: shape["double-border"],
    fontSize: shape.fontSize,
    fontColor: resolveColor(shape.color),
    bold: shape.bold,
    italic: shape.italic,
    underline: shape.underline,
  };
}

function edgeStyle(connection: CompiledConnection): EdgeStyle {
  return {
    stroke: resolveColor(connection.stroke),
    strokeWidth: connection.strokeWidth,
    strokeDash: connection.strokeDash,
    opacity: connection.opacity,
    borderRadius: connection.borderRadius,
    fontSize: connection.fontSize,
    fontColor: resolveColor(connection.color),
    bold: connection.bold,
    italic: connection.italic,
  };
}

function asArrowhead(value: string | undefined, fallback: Arrowhead): Arrowhead {
  return (value ?? fallback) as Arrowhead;
}

export function modelFromCompiled(diagram: CompiledDiagram, options: { code?: string } = {}): { model: DiagramModel; warnings: string[] } {
  const source = parseSourceHints(options.code);
  const warnings = [...source.warnings];
  const parentIds = new Set(diagram.shapes.map((s) => parentPath(s.id)).filter((id): id is string => Boolean(id)));
  const originalIndex = new Map(diagram.shapes.map((s, i) => [s.id, i]));

  const nodes: DiagramNode[] = diagram.shapes
    .map((shape) => {
      const rawIcon = iconPath(shape.icon);
      let icon: string | undefined;
      if (rawIcon && (SAFE_ICON.test(rawIcon) || DATA_IMAGE.test(rawIcon))) {
        icon = rawIcon;
      } else if (rawIcon) {
        warnings.push(`Dropped unsafe icon for ${shape.id}: ${rawIcon}`);
      }
      if (UNSUPPORTED_SHAPES.has(shape.type)) warnings.push(`Unsupported D2 shape "${shape.type}" on ${shape.id}; imported as-is.`);
      return {
        id: shape.id,
        parent: parentPath(shape.id),
        label: shape.label,
        shape: shape.type,
        icon,
        box: { x: shape.pos.x, y: shape.pos.y, w: shape.width, h: shape.height },
        style: nodeStyle(shape),
        container: parentIds.has(shape.id),
        labelPosition: shape.labelPosition || undefined,
        iconPosition: shape.iconPosition || undefined,
        labelSize:
          shape.labelWidth !== undefined && shape.labelHeight !== undefined ? { w: shape.labelWidth, h: shape.labelHeight } : undefined,
        classes: shape.classes && shape.classes.length > 0 ? [...shape.classes] : undefined,
        layout: source.nodeLayouts.get(shape.id),
        tooltip: shape.tooltip || undefined,
        link: shape.link || undefined,
      };
    })
    .sort((a, b) => splitPath(a.id).length - splitPath(b.id).length || (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0));

  const edges: DiagramEdge[] = diagram.connections.map((connection) => ({
    id: connection.id,
    from: connection.src,
    to: connection.dst,
    label: connection.label || undefined,
    labelSize:
      connection.labelWidth !== undefined && connection.labelHeight !== undefined
        ? { w: connection.labelWidth, h: connection.labelHeight }
        : undefined,
    srcArrow: asArrowhead(connection.srcArrow, "none"),
    dstArrow: asArrowhead(connection.dstArrow, "triangle"),
    style: edgeStyle(connection),
    route: connection.route.map((p) => ({ x: p.x, y: p.y })),
  }));

  return { model: { version: 1, layout: source.modelLayout, nodes, edges }, warnings };
}

export async function modelFromD2Code(code: string, options: { signal?: AbortSignal } = {}): Promise<{ model: DiagramModel; warnings: string[] }> {
  const { diagram } = await compileD2(code, options);
  return modelFromCompiled(diagram, { code });
}
