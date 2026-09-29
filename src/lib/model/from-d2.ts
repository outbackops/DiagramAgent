import { compileD2, type CompiledConnection, type CompiledDiagram, type CompiledShape } from "@/lib/d2-render";
import { resolveColor } from "./d2-theme";
import { joinPath, splitPath } from "./query";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode, EdgeStyle, LayoutHints, NodeStyle } from "./types";
import { MODEL_LIMITS } from "./validate";

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

function countBraces(line: string, brace: "{" | "}"): number {
  let quote: string | null = null;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && i + 1 < line.length) i++;
      else if (ch === quote) quote = null;
    } else if (ch === "\"" || ch === "'") {
      quote = ch;
    } else if (ch === brace) {
      count++;
    }
  }
  return count;
}

function localKeyFromBlockHead(head: string): string | null {
  const trimmed = head.trim();
  if (!trimmed || trimmed === "classes:" || /(?:<->|->|<-|--)/.test(trimmed)) return null;
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === "\\" && i + 1 < trimmed.length) i++;
      else if (trimmed[i] === quote) {
        const inner = trimmed.slice(1, i);
        return /[.:]/.test(inner) ? trimmed.slice(0, i + 1) : inner;
      }
    }
    return null;
  }
  const key = (trimmed.includes(":") ? trimmed.slice(0, trimmed.indexOf(":")) : trimmed).trim();
  if (!key || ["style", "source-arrowhead", "target-arrowhead"].includes(key)) return null;
  return key;
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

  const stack: (string | null)[] = [];
  let classDepth = 0;
  for (const raw of code.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    if (classDepth > 0) {
      classDepth += countBraces(line, "{");
      classDepth -= countBraces(line, "}");
      continue;
    }

    const prop = /^(direction|grid-rows|grid-columns|grid-gap|horizontal-gap|vertical-gap)\s*:\s*(.+)$/.exec(line);
    if (prop) {
      if (stack.length === 0) {
        hints.modelLayout ??= {};
        setHint(hints.modelLayout, prop[1], prop[2]);
      } else {
        const id = stack[stack.length - 1];
        if (!id) continue;
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
        classDepth = countBraces(line, "{") - countBraces(line, "}");
      } else {
        const key = localKeyFromBlockHead(head);
        if (key) {
          const parent = [...stack].reverse().find((id): id is string => Boolean(id)) ?? null;
          const id = joinPath(parent, key);
          stack.push(id);
        } else {
          stack.push(null);
        }
      }
    }

    const closes = countBraces(line, "}");
    for (let i = 0; i < closes && stack.length > 0; i++) stack.pop();
  }
  return hints;
}

function iconPath(icon: unknown): string | undefined {
  if (typeof icon === "string") return icon;
  if (icon && typeof icon === "object") {
    const url = icon as Record<string, unknown>;
    const scheme = typeof url.Scheme === "string" ? url.Scheme : "";
    const host = typeof url.Host === "string" ? url.Host : "";
    const path = typeof url.Path === "string" ? url.Path : "";
    const opaque = typeof url.Opaque === "string" ? url.Opaque : "";
    if (scheme === "data" && opaque) return `data:${opaque}`;
    if (!scheme && !host) return path || undefined;
    if (scheme || host) return `${scheme ? `${scheme}:` : ""}${host ? `//${host}` : ""}${path}`;
  }
  return undefined;
}

function clampNumber(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

function coordinate(value: number | undefined): number {
  return clampNumber(value, -MODEL_LIMITS.coordinate, MODEL_LIMITS.coordinate) ?? 0;
}

function label(value: string | undefined, where: string, warnings: string[]): string {
  const text = value ?? "";
  if (text.length <= MODEL_LIMITS.labelLength) return text;
  warnings.push(`Truncated overlong label for ${where} to ${MODEL_LIMITS.labelLength} characters.`);
  return text.slice(0, MODEL_LIMITS.labelLength);
}

function nodeStyle(shape: CompiledShape): NodeStyle {
  return {
    fill: resolveColor(shape.fill),
    stroke: resolveColor(shape.stroke),
    strokeWidth: clampNumber(shape.strokeWidth, 0, 100),
    strokeDash: clampNumber(shape.strokeDash, 0, 100),
    borderRadius: clampNumber(shape.borderRadius, 0, 1000),
    opacity: clampNumber(shape.opacity, 0, 1),
    shadow: shape.shadow,
    multiple: shape.multiple,
    doubleBorder: shape["double-border"],
    fontSize: clampNumber(shape.fontSize, 1, 400),
    fontColor: resolveColor(shape.color),
    bold: shape.bold,
    italic: shape.italic,
    underline: shape.underline,
  };
}

function edgeStyle(connection: CompiledConnection): EdgeStyle {
  return {
    stroke: resolveColor(connection.stroke),
    strokeWidth: clampNumber(connection.strokeWidth, 0, 100),
    strokeDash: clampNumber(connection.strokeDash, 0, 100),
    opacity: clampNumber(connection.opacity, 0, 1),
    borderRadius: clampNumber(connection.borderRadius, 0, 1000),
    fontSize: clampNumber(connection.fontSize, 1, 400),
    fontColor: resolveColor(connection.color),
    bold: connection.bold,
    italic: connection.italic,
  };
}

const ARROWHEADS = new Set<Arrowhead>([
  "none",
  "arrow",
  "triangle",
  "unfilled-triangle",
  "diamond",
  "filled-diamond",
  "circle",
  "filled-circle",
  "box",
  "filled-box",
  "line",
  "cross",
  "cf-one",
  "cf-many",
  "cf-one-required",
  "cf-many-required",
]);

function asArrowhead(value: string | undefined, fallback: Arrowhead, warnings: string[], where: string): Arrowhead {
  if (value === undefined) return fallback;
  if (ARROWHEADS.has(value as Arrowhead)) return value as Arrowhead;
  if (value === "filled-triangle") return "triangle";
  warnings.push(`Unknown arrowhead "${value}" on ${where}; using triangle.`);
  return "triangle";
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
        label: label(shape.label, shape.id, warnings),
        shape: shape.type,
        icon,
        box: { x: coordinate(shape.pos?.x), y: coordinate(shape.pos?.y), w: Math.max(0, coordinate(shape.width)), h: Math.max(0, coordinate(shape.height)) },
        style: nodeStyle(shape),
        container: parentIds.has(shape.id),
        labelPosition: shape.labelPosition || undefined,
        iconPosition: shape.iconPosition || undefined,
        labelSize:
          shape.labelWidth !== undefined && shape.labelHeight !== undefined ? { w: Math.max(0, coordinate(shape.labelWidth)), h: Math.max(0, coordinate(shape.labelHeight)) } : undefined,
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
    label: connection.label ? label(connection.label, connection.id, warnings) : undefined,
    labelSize:
      connection.labelWidth !== undefined && connection.labelHeight !== undefined
        ? { w: Math.max(0, coordinate(connection.labelWidth)), h: Math.max(0, coordinate(connection.labelHeight)) }
        : undefined,
    srcArrow: asArrowhead(connection.srcArrow, "none", warnings, connection.id),
    dstArrow: asArrowhead(connection.dstArrow, "triangle", warnings, connection.id),
    style: edgeStyle(connection),
    route: connection.route.map((p) => ({ x: coordinate(p.x), y: coordinate(p.y) })),
  }));

  return { model: { version: 1, layout: source.modelLayout, nodes, edges }, warnings };
}

export async function modelFromD2Code(code: string, options: { signal?: AbortSignal } = {}): Promise<{ model: DiagramModel; warnings: string[] }> {
  const { diagram } = await compileD2(code, options);
  return modelFromCompiled(diagram, { code });
}
