import { ensureParentsFirst } from "./query";
import { NODE_ROLES, TONES, type Arrowhead, type Box, type DiagramEdge, type DiagramModel, type DiagramNode, type EdgeKind, type EdgeStyle, type LayoutHints, type NodeContent, type NodeStyle, type Point, type Size } from "./types";

/**
 * Strict validation for models that arrive from outside (browser storage, API
 * requests). Unknown fields are dropped, sizes are bounded, and anything
 * malformed is rejected, so renderers and exporters can trust the result.
 */

export const MODEL_LIMITS = {
  nodes: 2000,
  edges: 4000,
  routePoints: 400,
  idLength: 500,
  labelLength: 4000,
  iconLength: 300_000,
  coordinate: 1_000_000,
};

const ARROWHEADS: readonly Arrowhead[] = [
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
];
const DIRECTIONS = ["up", "down", "left", "right"] as const;
const EDGE_KINDS: readonly EdgeKind[] = ["flow", "call", "step"];
const LEGEND_KINDS = ["lines", "usedBy"] as const;
const NODE_SIZES = ["narrow", "normal", "wide"] as const;

export type ValidationResult = { ok: true; model: DiagramModel } | { ok: false; error: string };

class Invalid extends Error {}

const fail = (message: string): never => {
  throw new Invalid(message);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function num(v: unknown, where: string, { min = -MODEL_LIMITS.coordinate, max = MODEL_LIMITS.coordinate } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(`${where} must be a finite number`);
  return v as number;
}

function optNum(v: unknown, where: string, range?: { min?: number; max?: number }): number | undefined {
  return v === undefined ? undefined : num(v, where, range);
}

function str(v: unknown, where: string, max: number): string {
  if (typeof v !== "string") fail(`${where} must be a string`);
  if ((v as string).length > max) fail(`${where} is too long`);
  return v as string;
}

function optStr(v: unknown, where: string, max: number): string | undefined {
  return v === undefined ? undefined : str(v, where, max);
}

function optBool(v: unknown, where: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") fail(`${where} must be a boolean`);
  return v as boolean;
}

function optEnum<T extends string>(v: unknown, where: string, values: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !values.includes(v as T)) fail(`${where} is invalid`);
  return v as T;
}

function optInt(v: unknown, where: string, { min, max }: { min: number; max: number }): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) fail(`${where} must be an integer from ${min} to ${max}`);
  return v as number;
}

function box(v: unknown, where: string): Box {
  if (!isObject(v)) fail(`${where} must be an object`);
  const b = v as Record<string, unknown>;
  return {
    x: num(b.x, `${where}.x`),
    y: num(b.y, `${where}.y`),
    w: num(b.w, `${where}.w`, { min: 0 }),
    h: num(b.h, `${where}.h`, { min: 0 }),
  };
}

function size(v: unknown, where: string): Size | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) fail(`${where} must be an object`);
  const s = v as Record<string, unknown>;
  return { w: num(s.w, `${where}.w`, { min: 0 }), h: num(s.h, `${where}.h`, { min: 0 }) };
}

function point(v: unknown, where: string): Point {
  if (!isObject(v)) fail(`${where} must be an object`);
  const p = v as Record<string, unknown>;
  return { x: num(p.x, `${where}.x`), y: num(p.y, `${where}.y`) };
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

function nodeStyle(v: unknown, where: string): NodeStyle {
  if (v === undefined) return {};
  if (!isObject(v)) fail(`${where} must be an object`);
  const s = v as Record<string, unknown>;
  return compact({
    fill: optStr(s.fill, `${where}.fill`, 256),
    stroke: optStr(s.stroke, `${where}.stroke`, 256),
    strokeWidth: optNum(s.strokeWidth, `${where}.strokeWidth`, { min: 0, max: 100 }),
    strokeDash: optNum(s.strokeDash, `${where}.strokeDash`, { min: 0, max: 100 }),
    borderRadius: optNum(s.borderRadius, `${where}.borderRadius`, { min: 0, max: 1000 }),
    opacity: optNum(s.opacity, `${where}.opacity`, { min: 0, max: 1 }),
    shadow: optBool(s.shadow, `${where}.shadow`),
    multiple: optBool(s.multiple, `${where}.multiple`),
    doubleBorder: optBool(s.doubleBorder, `${where}.doubleBorder`),
    fontSize: optNum(s.fontSize, `${where}.fontSize`, { min: 1, max: 400 }),
    fontColor: optStr(s.fontColor, `${where}.fontColor`, 256),
    bold: optBool(s.bold, `${where}.bold`),
    italic: optBool(s.italic, `${where}.italic`),
    underline: optBool(s.underline, `${where}.underline`),
  });
}

function edgeStyle(v: unknown, where: string): EdgeStyle {
  if (v === undefined) return {};
  if (!isObject(v)) fail(`${where} must be an object`);
  const s = v as Record<string, unknown>;
  return compact({
    stroke: optStr(s.stroke, `${where}.stroke`, 256),
    strokeWidth: optNum(s.strokeWidth, `${where}.strokeWidth`, { min: 0, max: 100 }),
    strokeDash: optNum(s.strokeDash, `${where}.strokeDash`, { min: 0, max: 100 }),
    opacity: optNum(s.opacity, `${where}.opacity`, { min: 0, max: 1 }),
    borderRadius: optNum(s.borderRadius, `${where}.borderRadius`, { min: 0, max: 1000 }),
    animated: optBool(s.animated, `${where}.animated`),
    fontSize: optNum(s.fontSize, `${where}.fontSize`, { min: 1, max: 400 }),
    fontColor: optStr(s.fontColor, `${where}.fontColor`, 256),
    bold: optBool(s.bold, `${where}.bold`),
    italic: optBool(s.italic, `${where}.italic`),
  });
}

function layoutHints(v: unknown, where: string): LayoutHints | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) fail(`${where} must be an object`);
  const l = v as Record<string, unknown>;
  if (l.direction !== undefined && !DIRECTIONS.includes(l.direction as (typeof DIRECTIONS)[number])) fail(`${where}.direction is invalid`);
  return compact({
    direction: l.direction as LayoutHints["direction"],
    gridRows: optNum(l.gridRows, `${where}.gridRows`, { min: 1, max: 1000 }),
    gridColumns: optNum(l.gridColumns, `${where}.gridColumns`, { min: 1, max: 1000 }),
    gridGap: optNum(l.gridGap, `${where}.gridGap`, { min: 0, max: 10_000 }),
  });
}

function arrowhead(v: unknown, where: string): Arrowhead {
  if (typeof v !== "string" || !ARROWHEADS.includes(v as Arrowhead)) fail(`${where} is not a known arrowhead`);
  return v as Arrowhead;
}

function stringList(v: unknown, where: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 50) fail(`${where} must be a short list`);
  return (v as unknown[]).map((item, i) => str(item, `${where}[${i}]`, 200));
}

function boundedStringList(v: unknown, where: string, maxItems: number, maxLength: number): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > maxItems) fail(`${where} must be a list of at most ${maxItems} strings`);
  return (v as unknown[]).map((item, i) => str(item, `${where}[${i}]`, maxLength));
}

function legendList(v: unknown, where: string): NodeContent["legend"] {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > LEGEND_KINDS.length) fail(`${where} must be a short list`);
  return (v as unknown[]).map((item, i) => {
    if (typeof item !== "string" || !LEGEND_KINDS.includes(item as (typeof LEGEND_KINDS)[number])) fail(`${where}[${i}] is invalid`);
    return item as (typeof LEGEND_KINDS)[number];
  });
}

function nodeContent(v: unknown, where: string): NodeContent | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) fail(`${where} must be an object`);
  const c = v as Record<string, unknown>;
  return compact({
    subtitle: optStr(c.subtitle, `${where}.subtitle`, 200),
    lines: boundedStringList(c.lines, `${where}.lines`, 8, 200),
    notes: boundedStringList(c.notes, `${where}.notes`, 6, 200),
    // Short on lanes and columns (a letter, a number); a phrase on the page header.
    badge: optStr(c.badge, `${where}.badge`, 60),
    badgeDetail: optStr(c.badgeDetail, `${where}.badgeDetail`, 80),
    tag: optStr(c.tag, `${where}.tag`, 60),
    chips: boundedStringList(c.chips, `${where}.chips`, 12, 60),
    chipsLabel: optStr(c.chipsLabel, `${where}.chipsLabel`, 60),
    usedBy: boundedStringList(c.usedBy, `${where}.usedBy`, 12, 4),
    size: optEnum(c.size, `${where}.size`, NODE_SIZES),
    columns: optInt(c.columns, `${where}.columns`, { min: 1, max: 4 }),
    legend: legendList(c.legend, `${where}.legend`),
    vertical: optBool(c.vertical, `${where}.vertical`),
  });
}

function validateNode(v: unknown, i: number): DiagramNode {
  const where = `nodes[${i}]`;
  if (!isObject(v)) fail(`${where} must be an object`);
  const n = v as Record<string, unknown>;
  const parent = n.parent === null ? null : str(n.parent, `${where}.parent`, MODEL_LIMITS.idLength);
  return compact({
    id: str(n.id, `${where}.id`, MODEL_LIMITS.idLength),
    parent,
    label: str(n.label, `${where}.label`, MODEL_LIMITS.labelLength),
    shape: str(n.shape, `${where}.shape`, 40),
    icon: optStr(n.icon, `${where}.icon`, MODEL_LIMITS.iconLength),
    box: box(n.box, `${where}.box`),
    style: nodeStyle(n.style, `${where}.style`),
    container: optBool(n.container, `${where}.container`) ?? false,
    labelPosition: optStr(n.labelPosition, `${where}.labelPosition`, 40),
    iconPosition: optStr(n.iconPosition, `${where}.iconPosition`, 40),
    labelSize: size(n.labelSize, `${where}.labelSize`),
    classes: stringList(n.classes, `${where}.classes`),
    layout: layoutHints(n.layout, `${where}.layout`),
    tooltip: optStr(n.tooltip, `${where}.tooltip`, MODEL_LIMITS.labelLength),
    link: optStr(n.link, `${where}.link`, 2000),
    role: optEnum(n.role, `${where}.role`, NODE_ROLES),
    tone: optEnum(n.tone, `${where}.tone`, TONES),
    content: nodeContent(n.content, `${where}.content`),
  }) as DiagramNode;
}

function validateEdge(v: unknown, i: number): DiagramEdge {
  const where = `edges[${i}]`;
  if (!isObject(v)) fail(`${where} must be an object`);
  const e = v as Record<string, unknown>;
  if (!Array.isArray(e.route) || e.route.length > MODEL_LIMITS.routePoints) fail(`${where}.route must be a list of at most ${MODEL_LIMITS.routePoints} points`);
  return compact({
    id: str(e.id, `${where}.id`, MODEL_LIMITS.idLength * 2 + 20),
    from: str(e.from, `${where}.from`, MODEL_LIMITS.idLength),
    to: str(e.to, `${where}.to`, MODEL_LIMITS.idLength),
    label: optStr(e.label, `${where}.label`, MODEL_LIMITS.labelLength),
    labelSize: size(e.labelSize, `${where}.labelSize`),
    srcArrow: arrowhead(e.srcArrow ?? "none", `${where}.srcArrow`),
    dstArrow: arrowhead(e.dstArrow ?? "triangle", `${where}.dstArrow`),
    style: edgeStyle(e.style, `${where}.style`),
    route: (e.route as unknown[]).map((p, j) => point(p, `${where}.route[${j}]`)),
    kind: optEnum(e.kind, `${where}.kind`, EDGE_KINDS),
    tone: optEnum(e.tone, `${where}.tone`, TONES),
    curve: optBool(e.curve, `${where}.curve`),
    labelAt: e.labelAt === undefined ? undefined : point(e.labelAt, `${where}.labelAt`),
  }) as DiagramEdge;
}

export function validateModel(input: unknown): ValidationResult {
  try {
    if (!isObject(input)) fail("model must be an object");
    const m = input as Record<string, unknown>;
    if (m.version !== 1) fail("unsupported model version");
    if (!Array.isArray(m.nodes) || m.nodes.length > MODEL_LIMITS.nodes) fail(`nodes must be a list of at most ${MODEL_LIMITS.nodes}`);
    if (!Array.isArray(m.edges) || m.edges.length > MODEL_LIMITS.edges) fail(`edges must be a list of at most ${MODEL_LIMITS.edges}`);
    const unordered = (m.nodes as unknown[]).map(validateNode);
    const edges = (m.edges as unknown[]).map(validateEdge);

    const ids = new Set<string>();
    for (const n of unordered) {
      if (ids.has(n.id)) fail(`duplicate node id "${n.id}"`);
      ids.add(n.id);
    }
    const nodes = ensureParentsFirst(unordered) ?? fail("nodes reference a missing parent or form a cycle");
    const edgeIds = new Set<string>();
    for (const e of edges) {
      if (edgeIds.has(e.id)) fail(`duplicate edge id "${e.id}"`);
      edgeIds.add(e.id);
      if (!ids.has(e.from) || !ids.has(e.to)) fail(`edge "${e.id}" references a missing node`);
    }

    const model: DiagramModel = compact({
      version: 1 as const,
      layout: layoutHints(m.layout, "layout"),
      nodes,
      edges,
      handArranged: optBool(m.handArranged, "handArranged"),
      composed: optBool(m.composed, "composed"),
    });
    return { ok: true, model };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}

export function isValidModel(input: unknown): input is DiagramModel {
  return validateModel(input).ok;
}
