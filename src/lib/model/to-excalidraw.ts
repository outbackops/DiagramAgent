import { PAGE } from "@/lib/compose/theme";
import { overlayGeometries } from "@/lib/arch/overlays";
import { overlayTag } from "@/lib/arch/page";
import { badgeStyle, boundaryStyle, connectorStyle, stepLabel, stylePack } from "@/lib/arch/styles";
import { architectureExportView, architecturePageLines } from "./export-result";
import { diagramKind } from "./kind";
import type { DiagramEdge, DiagramModel, DiagramNode, Point } from "./types";

type ElementBinding = { type: "text" | "arrow"; id: string };

interface BaseElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: 0;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed";
  roughness: 0;
  opacity: 100;
  groupIds: string[];
  frameId: null;
  roundness: { type: 2 | 3 } | null;
  seed: number;
  versionNonce: number;
  version: 1;
  isDeleted: false;
  boundElements: ElementBinding[] | null;
  updated: 1;
  link: null;
  locked: false;
}

interface RectangleElement extends BaseElement {
  type: "rectangle";
}

interface TextElement extends BaseElement {
  type: "text";
  fontSize: number;
  fontFamily: 2;
  text: string;
  originalText: string;
  textAlign: "left" | "center";
  verticalAlign: "top" | "middle";
  lineHeight: 1.25;
  containerId: string | null;
}

interface ArrowElement extends BaseElement {
  type: "arrow";
  points: Array<[number, number]>;
  startArrowhead: null;
  endArrowhead: "arrow" | null;
  startBinding: { elementId: string; focus: 0; gap: 4 } | null;
  endBinding: { elementId: string; focus: 0; gap: 4 } | null;
}

interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
  status: "saved";
  scale: [1, 1];
}

type ExcalidrawElement = RectangleElement | TextElement | ArrowElement | ImageElement;

const SOURCE = "https://github.com/outbackops/DiagramAgent";
const DARK_TEXT = "#1b1f24";

function hashInt(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function elementId(seed: string, used: Set<string>): string {
  const base = `da_${hashInt(seed).toString(36)}`;
  let id = base;
  let index = 1;
  while (used.has(id)) {
    id = `${base}_${index}`;
    index += 1;
  }
  used.add(id);
  return id;
}

function baseElement(id: string, type: string): BaseElement {
  return {
    id,
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#ffffff",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: hashInt(`${id}:seed`),
    versionNonce: hashInt(`${id}:nonce`),
    version: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

function isContainer(node: DiagramNode, children: Map<string, DiagramNode[]>): boolean {
  return node.container || node.role === "column" || node.role === "lane" || node.role === "grid" || (children.get(node.id)?.length ?? 0) > 0;
}

function nodeBackground(node: DiagramNode, container: boolean): string {
  if (node.role === "header") return PAGE.headerTo;
  if (node.role === "footer") return PAGE.footerFill;
  if (container) return node.role === "column" ? "#ffffff" : "transparent";
  return node.style.fill ?? "#ffffff";
}

function nodeStroke(node: DiagramNode): string {
  if (node.role === "grid") return "transparent";
  return node.style.stroke ?? "#1e1e1e";
}

function rectForNode(node: DiagramNode, id: string, container: boolean): RectangleElement {
  return {
    ...baseElement(id, "rectangle"),
    type: "rectangle",
    x: Math.round(node.box.x),
    y: Math.round(node.box.y),
    width: Math.max(1, Math.round(node.box.w)),
    height: Math.max(1, Math.round(node.box.h)),
    strokeColor: nodeStroke(node),
    backgroundColor: nodeBackground(node, container),
    strokeWidth: node.style.strokeWidth ?? 1,
    strokeStyle: node.style.strokeDash ? "dashed" : "solid",
    roundness: { type: 3 },
    boundElements: [],
  };
}

function archStyledNode(model: DiagramModel, node: DiagramNode): DiagramNode {
  const view = architectureExportView(model);
  if (node.role === "boundary" || (node.container && !node.generated)) {
    const style = boundaryStyle(view.boundaryPlatforms.get(node.id) ?? view.platform, node.arch?.kind ?? "group");
    return { ...node, style: { fill: style.fill === "none" ? "transparent" : style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDash: style.dash ? 6 : undefined, borderRadius: style.radius, fontColor: style.headerColor, bold: style.bold }, container: true };
  }
  if (node.generated) {
    const [label, ...lines] = architecturePageLines(model, node);
    return { ...node, label, content: { ...node.content, lines }, style: { fill: "transparent", stroke: "transparent", fontColor: stylePack(view.platform).text, fontSize: node.role === "title" ? 20 : 12, bold: node.role === "title" } };
  }
  const pack = stylePack(view.platform);
  return { ...node, style: { fill: pack.node.cardFill ?? "#ffffff", stroke: pack.node.cardStroke ?? "#D0D7DE", strokeWidth: 1, fontColor: pack.text, fontSize: 12 } };
}

function linesForNode(node: DiagramNode): string[] {
  if (node.role === "boundary") return [node.label, node.arch?.facts].filter((line): line is string => Boolean(line));
  if (node.role === "service") return [node.label, node.arch?.detail].filter((line): line is string => Boolean(line));
  const lines = [node.label];
  if (!node.content) return lines;
  const c = node.content;
  if (node.role === "column" && c.badge) lines[0] = `${c.badge} · ${node.label}`;
  if (node.role === "lane" && c.badge) lines[0] = `${c.badge}  ${node.label}`;
  if ((node.role === "lane" || node.role === "zone") && c.tag) lines[0] = `${lines[0]}  [${c.tag.toUpperCase()}]`;
  if (node.role === "header" && c.badge) lines.push([c.badge, c.badgeDetail].filter(Boolean).join(" · ").toUpperCase());
  if (c.subtitle) lines.push(c.subtitle);
  if (c.lines) lines.push(...c.lines);
  if (c.chips?.length) lines.push(`${c.chipsLabel ? `${c.chipsLabel} ` : ""}${c.chips.join(" · ")}`);
  if (c.notes) lines.push(...c.notes);
  if (c.usedBy?.length) lines.push(`used by ${c.usedBy.join(" · ")}`);
  if (node.role === "footer" && c.tag) lines.push(c.tag);
  if (node.role === "footer" && c.badgeDetail) lines.push(c.badgeDetail);
  return lines.filter((line) => line.length > 0);
}

function textHeight(text: string, fontSize: number): number {
  const lineCount = Math.max(1, text.split("\n").length);
  return Math.max(1, Math.ceil(fontSize * 1.35 * lineCount));
}

function textElement({
  id,
  text,
  x,
  y,
  width,
  fontSize,
  color,
  align = "left",
  verticalAlign = "top",
  containerId = null,
}: {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  align?: "left" | "center";
  verticalAlign?: "top" | "middle";
  containerId?: string | null;
}): TextElement {
  return {
    ...baseElement(id, "text"),
    type: "text",
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(width)),
    height: textHeight(text, fontSize),
    strokeColor: color,
    backgroundColor: "transparent",
    strokeWidth: 1,
    fontSize,
    fontFamily: 2,
    text,
    originalText: text,
    textAlign: align,
    verticalAlign,
    lineHeight: 1.25,
    containerId,
  };
}

function nodeFontSize(node: DiagramNode): number {
  switch (node.role) {
    case "header":
      return 28;
    case "column":
      return 18;
    case "lane":
      return 16;
    case "step":
      return 13;
    case "card":
      return 14;
    default:
      return node.style.fontSize ?? 14;
  }
}

function textForNode(node: DiagramNode, rectId: string, textId: string, bound: boolean): TextElement {
  const text = linesForNode(node).join("\n");
  const fontSize = nodeFontSize(node);
  const pad = node.role === "header" || node.role === "footer" ? 24 : node.role === "column" || node.role === "lane" ? 18 : 12;
  const color = node.role === "header" || node.role === "footer" ? "#ffffff" : DARK_TEXT;
  const y = bound ? node.box.y + Math.max(8, (node.box.h - textHeight(text, fontSize)) / 2) : node.box.y + pad;
  return textElement({
    id: textId,
    text,
    x: node.box.x + pad,
    y,
    width: node.box.w - pad * 2,
    fontSize,
    color,
    verticalAlign: bound ? "middle" : "top",
    containerId: bound ? rectId : null,
  });
}

function sampleCurve(points: Point[]): Point[] {
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const c1 = { x: start.x + dx / 2, y: start.y };
  const c2 = { x: end.x - dx / 2, y: end.y };
  const sampled: Point[] = [];
  for (let i = 0; i <= 5; i += 1) {
    const t = i / 5;
    const mt = 1 - t;
    sampled.push({
      x: mt ** 3 * start.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * end.x,
      y: mt ** 3 * start.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * end.y,
    });
  }
  return sampled;
}

function longestSegmentMidpoint(points: Point[]): Point {
  let best = { length: -1, point: points[0] ?? { x: 0, y: 0 } };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best.length) best = { length, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best.point;
}

function arrowForEdge(edge: DiagramEdge, id: string, nodeIds: Map<string, string>): ArrowElement | null {
  if (edge.route.length === 0) return null;
  const route = edge.curve ? sampleCurve(edge.route) : edge.route;
  const origin = route[0];
  const relative = route.map((point) => [Math.round(point.x - origin.x), Math.round(point.y - origin.y)] as [number, number]);
  const xs = relative.map((point) => point[0]);
  const ys = relative.map((point) => point[1]);
  const source = nodeIds.get(edge.from);
  const target = nodeIds.get(edge.to);
  return {
    ...baseElement(id, "arrow"),
    type: "arrow",
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    strokeColor: edge.style.stroke ?? "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: edge.style.strokeWidth ?? 1,
    strokeStyle: edge.kind === "call" || edge.style.strokeDash ? "dashed" : "solid",
    roundness: edge.curve ? { type: 2 } : null,
    points: relative,
    startArrowhead: null,
    endArrowhead: edge.dstArrow === "none" ? null : "arrow",
    startBinding: source ? { elementId: source, focus: 0, gap: 4 } : null,
    endBinding: target ? { elementId: target, focus: 0, gap: 4 } : null,
  };
}

function archArrowForEdge(model: DiagramModel, edge: DiagramEdge, id: string, nodeIds: Map<string, string>): ArrowElement | null {
  const arrow = arrowForEdge(edge, id, nodeIds);
  if (!arrow) return null;
  const page = architectureExportView(model).platform;
  const style = connectorStyle(page, edge.meaning ?? "request");
  return { ...arrow, strokeColor: style.stroke, strokeWidth: style.width, strokeStyle: style.dash ? "dashed" : "solid", startArrowhead: null, endArrowhead: style.arrowEnd === "none" ? null : "arrow" };
}

function imageDataUrl(icon: string): string {
  const safe = icon.replace(/"/g, "&quot;");
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image href="${safe}" width="64" height="64" preserveAspectRatio="xMidYMid meet"/></svg>`)}`;
}

function imageElementForNode(node: DiagramNode, id: string, fileId: string): ImageElement {
  const size = Math.min(48, Math.max(24, Math.min(node.box.w, node.box.h) - 36));
  return {
    ...baseElement(id, "image"),
    type: "image",
    x: Math.round(node.box.x + node.box.w / 2 - size / 2),
    y: Math.round(node.box.y + 10),
    width: size,
    height: size,
    backgroundColor: "transparent",
    strokeColor: "transparent",
    fileId,
    status: "saved",
    scale: [1, 1],
  };
}

export function modelToExcalidraw(model: DiagramModel): string {
  if (diagramKind(model) === "architecture") return modelToArchitectureExcalidraw(model);
  const used = new Set<string>();
  const children = new Map<string, DiagramNode[]>();
  for (const node of model.nodes) {
    if (!node.parent) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }

  const nodeIds = new Map<string, string>();
  const rectangles = model.nodes.map((node) => {
    const id = elementId(`node:${node.id}`, used);
    nodeIds.set(node.id, id);
    return { node, rect: rectForNode(node, id, isContainer(node, children)) };
  });

  const containers = rectangles.filter(({ node }) => isContainer(node, children));
  const leaves = rectangles.filter(({ node }) => !isContainer(node, children));
  const arrows: ArrowElement[] = [];
  const texts: TextElement[] = [];

  for (const { node, rect } of rectangles) {
    const freeText = node.role === "header" || node.role === "footer" || node.role === "column" || node.role === "lane";
    if (!freeText && linesForNode(node).join("").length === 0) continue;
    const textId = elementId(`text:${node.id}`, used);
    texts.push(textForNode(node, rect.id, textId, !freeText));
    if (!freeText) rect.boundElements?.push({ type: "text", id: textId });
  }

  for (const edge of model.edges) {
    const arrowId = elementId(`edge:${edge.id}`, used);
    const arrow = arrowForEdge(edge, arrowId, nodeIds);
    if (!arrow) continue;
    arrows.push(arrow);
    for (const nodeId of [arrow.startBinding?.elementId, arrow.endBinding?.elementId]) {
      if (!nodeId) continue;
      const rect = rectangles.find((entry) => entry.rect.id === nodeId)?.rect;
      rect?.boundElements?.push({ type: "arrow", id: arrow.id });
    }
    if (edge.label) {
      const point = edge.labelAt ?? longestSegmentMidpoint(edge.curve ? sampleCurve(edge.route) : edge.route);
      const textId = elementId(`edge-label:${edge.id}`, used);
      texts.push(textElement({ id: textId, text: edge.label, x: point.x - 70, y: point.y - 10, width: 140, fontSize: 12, color: DARK_TEXT, align: "center" }));
    }
  }

  const elements: ExcalidrawElement[] = [
    ...containers.map((entry) => entry.rect),
    ...leaves.map((entry) => entry.rect),
    ...arrows,
    ...texts,
  ].map((element) => ({ ...element, boundElements: element.boundElements && element.boundElements.length > 0 ? element.boundElements : null }));

  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: SOURCE,
      elements,
      appState: { viewBackgroundColor: diagramKind(model) === "poster" ? PAGE.background : "#ffffff", gridSize: null },
      files: {},
    },
    null,
    2
  );
}

function modelToArchitectureExcalidraw(model: DiagramModel): string {
  const used = new Set<string>();
  const children = new Map<string, DiagramNode[]>();
  for (const node of model.nodes) {
    if (!node.parent) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }

  const nodeIds = new Map<string, string>();
  const styledNodes = model.nodes.map((node) => archStyledNode(model, node));
  const rectangles = styledNodes.map((node) => {
    const id = elementId(`node:${node.id}`, used);
    nodeIds.set(node.id, id);
    return { node, rect: rectForNode(node, id, isContainer(node, children)) };
  });
  const containers = rectangles.filter(({ node }) => isContainer(node, children));
  const leaves = rectangles.filter(({ node }) => !isContainer(node, children));
  const arrows: ArrowElement[] = [];
  const texts: TextElement[] = [];
  const images: ImageElement[] = [];
  const files: Record<string, { mimeType: "image/svg+xml"; id: string; dataURL: string; created: 1 }> = {};

  for (const { node, rect } of rectangles) {
    const freeText = node.generated || node.role === "boundary";
    const textId = elementId(`text:${node.id}`, used);
    texts.push(textForNode(node, rect.id, textId, !freeText));
    if (!freeText) rect.boundElements?.push({ type: "text", id: textId });
    if (node.role === "service" && node.icon?.startsWith("/icons/")) {
      const fileId = elementId(`file:${node.icon}`, used);
      files[fileId] = { id: fileId, mimeType: "image/svg+xml", dataURL: imageDataUrl(node.icon), created: 1 };
      images.push(imageElementForNode(node, elementId(`image:${node.id}`, used), fileId));
    }
  }

  for (const overlay of overlayGeometries(model)) {
    if (overlay.clean) {
      const id = elementId(`overlay:${overlay.overlay.name}`, used);
      const rect = rectForNode({ id, parent: null, label: overlay.overlay.name, shape: "rectangle", box: overlay.box, style: { fill: "transparent", stroke: "#ED7100", strokeDash: 6, strokeWidth: 1.5, fontColor: "#ED7100" }, container: false }, id, false);
      containers.push({ node: { ...styledNodes[0], id, label: overlay.overlay.name, box: overlay.box }, rect });
    } else {
      const tag = overlayTag(overlay.overlay);
      for (const memberId of overlay.memberIds) {
        const node = styledNodes.find((candidate) => candidate.id === memberId);
        if (!node) continue;
        texts.push(textElement({ id: elementId(`overlay-tag:${memberId}:${tag}`, used), text: tag, x: node.box.x + node.box.w - 36, y: node.box.y + 4, width: 32, fontSize: 10, color: "#ED7100", align: "center" }));
      }
    }
  }

  for (const edge of model.edges.filter((candidate) => !candidate.hidden)) {
    const arrowId = elementId(`edge:${edge.id}`, used);
    const arrow = archArrowForEdge(model, edge, arrowId, nodeIds);
    if (!arrow) continue;
    arrows.push(arrow);
    if (edge.label) {
      const point = edge.labelAt ?? longestSegmentMidpoint(edge.curve ? sampleCurve(edge.route) : edge.route);
      texts.push(textElement({ id: elementId(`edge-label:${edge.id}`, used), text: edge.label, x: point.x - 70, y: point.y - 10, width: 140, fontSize: 12, color: DARK_TEXT, align: "center" }));
    }
    for (const badge of edge.badges ?? []) {
      const at = badge.at ?? edge.route[0] ?? { x: 0, y: 0 };
      const page = architectureExportView(model).platform;
      const sequenceIndex = Math.max(0, (model.arch?.sequences ?? []).findIndex((sequence) => sequence.id === badge.sequence));
      const style = badgeStyle(page, sequenceIndex);
      const badgeId = elementId(`badge:${edge.id}:${badge.number}`, used);
      const mark = stepLabel(sequenceIndex, badge.number);
      containers.push({
        node: { ...styledNodes[0], id: badgeId, label: mark, box: { x: at.x - 9, y: at.y - 9, w: 18, h: 18 } },
        rect: { ...rectForNode({ id: badgeId, parent: null, label: mark, shape: "rectangle", box: { x: at.x - 9, y: at.y - 9, w: 18, h: 18 }, style: { fill: style.fill, stroke: style.fill, fontColor: style.text, fontSize: 10, bold: true }, container: false }, badgeId, false), roundness: style.shape === "circle" ? { type: 2 } : { type: 3 } },
      });
      texts.push(textElement({ id: elementId(`badge-text:${edge.id}:${badge.number}`, used), text: mark, x: at.x - 9, y: at.y - 7, width: 18, fontSize: 10, color: style.text, align: "center", verticalAlign: "middle" }));
    }
  }

  const elements: ExcalidrawElement[] = [
    ...containers.map((entry) => entry.rect),
    ...leaves.map((entry) => entry.rect),
    ...images,
    ...arrows,
    ...texts,
  ].map((element) => ({ ...element, boundElements: element.boundElements && element.boundElements.length > 0 ? element.boundElements : null }));

  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: SOURCE,
      elements,
      appState: { viewBackgroundColor: stylePack(architectureExportView(model).platform).background, gridSize: null },
      files,
    },
    null,
    2
  );
}
