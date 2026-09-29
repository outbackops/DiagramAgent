import fs from "node:fs/promises";
import path from "node:path";

import { overlayGeometries } from "@/lib/arch/overlays";
import { overlayTag } from "@/lib/arch/page";
import { badgeStyle, boundaryStyle, connectorStyle, stylePack } from "@/lib/arch/styles";
import { bottom, right, unionBoxes } from "./geometry";
import { architectureExportView, architecturePageLines, exportResult, type ExportResult } from "./export-result";
import { diagramKind } from "./kind";
import { iconBox } from "./render-svg";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode, EdgeStyle, NodeStyle, Point } from "./types";

interface DrawioOptions {
  title?: string;
  embedIcons?: boolean;
}

const ROOT_CELL_ID = "1";
const DEFAULT_PAGE_W = 1169;
const DEFAULT_PAGE_H = 827;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function encodeSvgForStyle(svgText: string): string {
  const cleaned = svgText
    .replace(/<\?xml[^?]*\?>\s*/i, "")
    .replace(/<!DOCTYPE[^>]*>\s*/i, "")
    .trim();
  return encodeURIComponent(cleaned).replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function iconPath(icon: string): string | null {
  const match = icon.match(/^\/icons\/([A-Za-z0-9_-]+\.svg)$/);
  return match ? path.join(process.cwd(), "public", "icons", match[1]) : null;
}

async function iconDataUri(icon: string): Promise<string | null> {
  const filePath = iconPath(icon);
  if (!filePath) return null;
  try {
    const svg = await fs.readFile(filePath, "utf8");
    return `data:image/svg+xml,${encodeSvgForStyle(svg)}`;
  } catch {
    return null;
  }
}

async function buildIconMap(model: DiagramModel, embedIcons: boolean): Promise<Map<string, string>> {
  const icons = Array.from(new Set(model.nodes.map((node) => node.icon).filter((icon): icon is string => Boolean(icon))));
  const entries = await Promise.all(
    icons.map(async (icon) => {
      if (!embedIcons) return null;
      const dataUri = await iconDataUri(icon);
      return dataUri ? ([icon, dataUri] as const) : null;
    })
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

function cellId(prefix: string, index: number): string {
  return `${prefix}-${index + 2}`;
}

function styleText(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const key = part.includes("=") ? part.slice(0, part.indexOf("=")) : part;
    if (seen.has(key)) throw new Error(`Duplicate draw.io style key: ${key}`);
    seen.add(key);
    out.push(part);
  }
  return out.join(";") + ";";
}

function color(value: string | undefined, fallback: string): string {
  return value ?? fallback;
}

function fontStyle(style: NodeStyle | EdgeStyle): number {
  let value = 0;
  if (style.bold) value += 1;
  if (style.italic) value += 2;
  if ("underline" in style && style.underline) value += 4;
  return value;
}

function arcSize(style: NodeStyle): string | null {
  if (!style.borderRadius) return null;
  return `arcSize=${Math.max(1, Math.round(style.borderRadius))}`;
}

function nodeShape(shape: string): string | null {
  switch (shape) {
    case "cylinder":
      return "shape=cylinder3";
    case "queue":
      return "shape=mxgraph.lean_mapping.fifo_sequence_pull_ball";
    case "circle":
    case "oval":
      return "shape=ellipse";
    case "diamond":
      return "shape=rhombus";
    case "hexagon":
      return "shape=hexagon";
    case "cloud":
      return "shape=cloud";
    case "person":
      return "shape=umlActor";
    default:
      return null;
  }
}

function buildNodeStyle(node: DiagramNode): string {
  const style = node.style;
  if (node.container) {
    return styleText([
      "rounded=1",
      "whiteSpace=wrap",
      "html=1",
      "container=1",
      "collapsible=0",
      "verticalAlign=top",
      "align=center",
      `fillColor=${color(style.fill, "none")}`,
      `strokeColor=${color(style.stroke, "#666666")}`,
      `strokeWidth=${style.strokeWidth ?? 1}`,
      style.strokeDash ? "dashed=1" : null,
      style.strokeDash ? `dashPattern=${style.strokeDash} ${style.strokeDash}` : null,
      arcSize(style),
      `fontColor=${color(style.fontColor, "#333333")}`,
      `fontSize=${style.fontSize ?? 12}`,
      `fontStyle=${fontStyle(style)}`,
      style.opacity !== undefined ? `opacity=${Math.round(style.opacity * 100)}` : null,
      style.shadow ? "shadow=1" : null,
      "spacingTop=8",
    ]);
  }

  const shape = nodeShape(node.shape);
  return styleText([
    shape ?? "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${color(style.fill, "#ffffff")}`,
    `strokeColor=${color(style.stroke, "#666666")}`,
    `strokeWidth=${style.strokeWidth ?? 1}`,
    style.strokeDash ? "dashed=1" : null,
    style.strokeDash ? `dashPattern=${style.strokeDash} ${style.strokeDash}` : null,
    arcSize(style),
    `fontColor=${color(style.fontColor, "#333333")}`,
    `fontSize=${style.fontSize ?? 11}`,
    `fontStyle=${fontStyle(style)}`,
    style.opacity !== undefined ? `opacity=${Math.round(style.opacity * 100)}` : null,
    style.shadow ? "shadow=1" : null,
    "verticalAlign=middle",
    "align=center",
  ]);
}

function iconGeometry(node: DiagramNode): { x: number; y: number; w: number; h: number } {
  const box = iconBox(node);
  return { x: box.x - node.box.x, y: box.y - node.box.y, w: box.w, h: box.h };
}

function imageCellXml(id: string, parentId: string, dataUri: string, node: DiagramNode): string {
  const geometry = iconGeometry(node);
  const style = styleText(["shape=image", `image=${dataUri}`, "verticalLabelPosition=bottom", "verticalAlign=top", "imageAspect=1", "aspect=fixed"]);
  return `        <mxCell id="${id}" value="" style="${escapeXml(style)}" vertex="1" parent="${parentId}">\n          <mxGeometry x="${geometry.x}" y="${geometry.y}" width="${geometry.w}" height="${geometry.h}" as="geometry"/>\n        </mxCell>`;
}

function arrowhead(arrow: Arrowhead, end: boolean): string | null {
  const key = end ? "endArrow" : "startArrow";
  if (arrow === "none") return `${key}=none`;
  if (arrow.includes("diamond")) return `${key}=diamond`;
  if (arrow.includes("circle")) return `${key}=oval`;
  if (arrow.includes("box")) return `${key}=block`;
  if (arrow === "cross") return `${key}=open`;
  return `${key}=block`;
}

function buildEdgeStyle(edge: DiagramEdge): string {
  const style = edge.style;
  return styleText([
    "edgeStyle=orthogonalEdgeStyle",
    "orthogonalLoop=1",
    "jettySize=auto",
    "html=1",
    style.borderRadius && style.borderRadius > 0 ? "rounded=1" : "rounded=0",
    `strokeColor=${color(style.stroke, "#666666")}`,
    `strokeWidth=${style.strokeWidth ?? 1}`,
    style.strokeDash ? "dashed=1" : null,
    style.strokeDash ? `dashPattern=${style.strokeDash} ${style.strokeDash}` : null,
    `fontColor=${color(style.fontColor, "#333333")}`,
    `fontSize=${style.fontSize ?? 10}`,
    `fontStyle=${fontStyle(style)}`,
    arrowhead(edge.srcArrow, false),
    arrowhead(edge.dstArrow, true),
  ]);
}

function geometryFor(node: DiagramNode, byId: Map<string, DiagramNode>): { x: number; y: number; w: number; h: number } {
  const parent = node.parent ? byId.get(node.parent) : undefined;
  return {
    x: parent ? node.box.x - parent.box.x : node.box.x,
    y: parent ? node.box.y - parent.box.y : node.box.y,
    w: node.box.w,
    h: node.box.h,
  };
}

function pointsXml(points: Point[]): string {
  if (points.length === 0) return "";
  return `\n            <Array as="points">\n${points
    .map((point) => `              <mxPoint x="${point.x}" y="${point.y}"/>`)
    .join("\n")}\n            </Array>`;
}

function htmlLines(lines: Array<string | undefined>): string {
  return lines
    .filter((line): line is string => Boolean(line))
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>");
}

function archNodeLabel(model: DiagramModel, node: DiagramNode): string {
  if (node.generated) return htmlLines(architecturePageLines(model, node));
  if (node.role === "boundary") return htmlLines([node.label, node.arch?.facts]);
  if (node.role === "service") return htmlLines([node.label, node.arch?.detail]);
  return htmlLines([node.label]);
}

function buildArchNodeStyle(model: DiagramModel, node: DiagramNode): string {
  const view = architectureExportView(model);
  const pack = stylePack(view.platform);
  if (node.role === "boundary" || (node.container && !node.generated)) {
    const style = boundaryStyle(view.boundaryPlatforms.get(node.id) ?? view.platform, node.arch?.kind ?? "group");
    return styleText([
      "rounded=1",
      "whiteSpace=wrap",
      "html=1",
      "container=1",
      "collapsible=0",
      "verticalAlign=top",
      "align=center",
      `fillColor=${style.fill}`,
      `strokeColor=${style.stroke}`,
      `strokeWidth=${style.strokeWidth}`,
      style.dash ? "dashed=1" : null,
      style.dash ? `dashPattern=${style.dash}` : null,
      `arcSize=${style.radius}`,
      `fontColor=${style.headerColor}`,
      `fontSize=12`,
      style.bold ? "fontStyle=1" : "fontStyle=0",
      style.fillOpacity !== undefined ? `opacity=${Math.round(style.fillOpacity * 100)}` : null,
      "spacingTop=8",
    ]);
  }
  if (node.generated) {
    return styleText(["text", "whiteSpace=wrap", "html=1", "strokeColor=none", "fillColor=none", `fontColor=${pack.text}`, `fontSize=${node.role === "title" ? 20 : 12}`, node.role === "title" ? "fontStyle=1" : "fontStyle=0", "align=left", "verticalAlign=top"]);
  }
  return styleText(["rounded=1", "whiteSpace=wrap", "html=1", `fillColor=${pack.node.cardFill ?? "#ffffff"}`, `strokeColor=${pack.node.cardStroke ?? "#D0D7DE"}`, "strokeWidth=1", "fontColor=#1b1f24", "fontSize=11", "verticalAlign=bottom", "align=center", "spacingBottom=8"]);
}

function archEdgeStyle(model: DiagramModel, edge: DiagramEdge): string {
  const page = architectureExportView(model).platform;
  const style = connectorStyle(page, edge.meaning ?? "request");
  const end = style.arrowEnd === "none" ? "endArrow=none" : style.arrowEnd === "open" ? "endArrow=open" : "endArrow=block";
  const start = style.arrowStart === "none" ? "startArrow=none" : style.arrowStart === "open" ? "startArrow=open" : "startArrow=block";
  return styleText(["edgeStyle=orthogonalEdgeStyle", "orthogonalLoop=1", "jettySize=auto", "html=1", "rounded=0", `strokeColor=${style.stroke}`, `strokeWidth=${style.width}`, style.dash ? "dashed=1" : null, style.dash ? `dashPattern=${style.dash}` : null, `fontColor=${stylePack(page).text}`, "fontSize=10", start, end]);
}

function badgeCellXml(id: string, model: DiagramModel, edge: DiagramEdge, badge: NonNullable<DiagramEdge["badges"]>[number], index: number): string {
  const page = architectureExportView(model).platform;
  const sequences = model.arch?.sequences ?? [];
  const sequenceIndex = Math.max(0, sequences.findIndex((sequence) => sequence.id === badge.sequence));
  const style = badgeStyle(page, sequenceIndex);
  const at = badge.at ?? edge.route[0] ?? { x: 0, y: 0 };
  const size = 18;
  const shape = style.shape === "circle" ? "shape=ellipse" : "rounded=1;arcSize=2";
  const mxStyle = styleText([shape, "html=1", `fillColor=${style.fill}`, "strokeColor=none", `fontColor=${style.text}`, "fontStyle=1", "fontSize=10", "align=center", "verticalAlign=middle"]);
  return `        <mxCell id="${id}-badge-${index}" value="${badge.number}" style="${escapeXml(mxStyle)}" vertex="1" parent="${ROOT_CELL_ID}">\n          <mxGeometry x="${at.x - size / 2}" y="${at.y - size / 2}" width="${size}" height="${size}" as="geometry"/>\n        </mxCell>`;
}

function overlayCellXml(id: string, box: { x: number; y: number; w: number; h: number }, name: string): string {
  const style = styleText(["rounded=1", "whiteSpace=wrap", "html=1", "fillColor=none", "strokeColor=#ED7100", "strokeWidth=1.5", "dashed=1", "dashPattern=8 4", "fontColor=#ED7100", "fontStyle=1", "fontSize=11", "verticalAlign=bottom", "align=left"]);
  return `        <mxCell id="${id}" value="${escapeXml(htmlLines([name]))}" style="${escapeXml(style)}" vertex="1" parent="${ROOT_CELL_ID}">\n          <mxGeometry x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" as="geometry"/>\n        </mxCell>`;
}

/** draw.io reads labels as HTML (html=1): each part is HTML-escaped before joining with <br>. */
function composedNodeLabel(model: DiagramModel, node: DiagramNode): string {
  if (diagramKind(model) !== "poster" || !node.role) return node.label;
  const html = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [node.label];
  if (node.content?.subtitle) lines.push(node.content.subtitle);
  if (node.content?.lines) lines.push(...node.content.lines);
  if (node.content?.notes) lines.push(...node.content.notes);
  return lines.map(html).join("<br>");
}

async function modelToDrawioContent(model: DiagramModel, options: DrawioOptions = {}): Promise<string> {
  const iconMap = await buildIconMap(model, options.embedIcons ?? true);
  const nodeIds = new Map<string, string>();
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const boxes = model.nodes.map((node) => node.box);
  const bounds = unionBoxes(boxes) ?? { x: 0, y: 0, w: DEFAULT_PAGE_W, h: DEFAULT_PAGE_H };
  const nodeCells = model.nodes.flatMap((node, index) => {
    const id = cellId("node", index);
    nodeIds.set(node.id, id);
    const parent = node.parent ? nodeIds.get(node.parent) ?? ROOT_CELL_ID : ROOT_CELL_ID;
    const geometry = geometryFor(node, byId);
    const icon = node.icon ? iconMap.get(node.icon) : undefined;
    const style = buildNodeStyle(node);
    const cells = [
      `        <mxCell id="${id}" value="${escapeXml(composedNodeLabel(model, node))}" style="${escapeXml(style)}" vertex="1" parent="${parent}">\n          <mxGeometry x="${geometry.x}" y="${geometry.y}" width="${geometry.w}" height="${geometry.h}" as="geometry"/>\n        </mxCell>`,
    ];
    if (icon) cells.push(imageCellXml(`${id}-icon`, id, icon, node));
    return cells;
  });

  const edgeCells = model.edges.map((edge, index) => {
    const id = cellId("edge", index + model.nodes.length);
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    const routePoints = edge.route.length > 2 ? edge.route.slice(1, -1) : [];
    return `        <mxCell id="${id}" value="${escapeXml(edge.label ?? "")}" style="${escapeXml(buildEdgeStyle(edge))}" edge="1" source="${source ?? ""}" target="${target ?? ""}" parent="${ROOT_CELL_ID}">\n          <mxGeometry relative="1" as="geometry">${pointsXml(routePoints)}\n          </mxGeometry>\n        </mxCell>`;
  });

  const pageW = Math.max(Math.ceil(right(bounds) + 50), DEFAULT_PAGE_W);
  const pageH = Math.max(Math.ceil(bottom(bounds) + 50), DEFAULT_PAGE_H);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="DiagramAgent" modified="2026-01-01T00:00:00.000Z" agent="DiagramAgent/1.0" version="24.0.0" type="device">\n  <diagram id="diagram-1" name="${escapeXml(options.title ?? "Architecture Diagram")}">\n    <mxGraphModel dx="${Math.round(pageW * 0.8)}" dy="${Math.round(pageH * 0.8)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="${ROOT_CELL_ID}" parent="0"/>\n${[...nodeCells, ...edgeCells].join("\n")}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
}

async function modelToArchitectureDrawioContent(model: DiagramModel, options: DrawioOptions = {}): Promise<string> {
  const iconMap = await buildIconMap(model, options.embedIcons ?? true);
  const nodeIds = new Map<string, string>();
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const bounds = unionBoxes(model.nodes.map((node) => node.box)) ?? { x: 0, y: 0, w: DEFAULT_PAGE_W, h: DEFAULT_PAGE_H };
  const nodeCells = model.nodes.flatMap((node, index) => {
    const id = cellId("node", index);
    nodeIds.set(node.id, id);
    const parent = node.parent ? nodeIds.get(node.parent) ?? ROOT_CELL_ID : ROOT_CELL_ID;
    const geometry = geometryFor(node, byId);
    const cells = [
      `        <mxCell id="${id}" value="${escapeXml(archNodeLabel(model, node))}" style="${escapeXml(buildArchNodeStyle(model, node))}" vertex="1" parent="${parent}">\n          <mxGeometry x="${geometry.x}" y="${geometry.y}" width="${geometry.w}" height="${geometry.h}" as="geometry"/>\n        </mxCell>`,
    ];
    const icon = node.icon ? iconMap.get(node.icon) : undefined;
    if (icon && node.role === "service") cells.push(imageCellXml(`${id}-icon`, id, icon, node));
    return cells;
  });
  const edgeCells = model.edges.filter((edge) => !edge.hidden).map((edge, index) => {
    const id = cellId("edge", index + model.nodes.length);
    const source = nodeIds.get(edge.from);
    const target = nodeIds.get(edge.to);
    const routePoints = edge.route.length > 2 ? edge.route.slice(1, -1) : [];
    return `        <mxCell id="${id}" value="${escapeXml(htmlLines([edge.label]))}" style="${escapeXml(archEdgeStyle(model, edge))}" edge="1" source="${source ?? ""}" target="${target ?? ""}" parent="${ROOT_CELL_ID}">\n          <mxGeometry relative="1" as="geometry">${pointsXml(routePoints)}\n          </mxGeometry>\n        </mxCell>`;
  });
  const badgeCells = model.edges.filter((edge) => !edge.hidden).flatMap((edge, edgeIndex) => (edge.badges ?? []).map((badge, badgeIndex) => badgeCellXml(cellId("edge", edgeIndex + model.nodes.length), model, edge, badge, badgeIndex)));
  const overlays = overlayGeometries(model);
  const overlayCells = overlays.flatMap((overlay, index) => {
    if (overlay.clean) return [overlayCellXml(`overlay-${index}`, overlay.box, overlay.overlay.name)];
    const tag = overlayTag(overlay.overlay);
    return overlay.memberIds.flatMap((memberId, memberIndex) => {
      const member = byId.get(memberId);
      if (!member) return [];
      const w = Math.ceil(tag.length * 7) + 12;
      return [
        overlayCellXml(`overlay-${index}-tag-${memberIndex}`, { x: member.box.x + member.box.w - w - 4, y: member.box.y + 4, w, h: 16 }, tag),
      ];
    });
  });
  const pageW = Math.max(Math.ceil(right(bounds) + 50), DEFAULT_PAGE_W);
  const pageH = Math.max(Math.ceil(bottom(bounds) + 50), DEFAULT_PAGE_H);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="DiagramAgent" modified="2026-01-01T00:00:00.000Z" agent="DiagramAgent/1.0" version="24.0.0" type="device">\n  <diagram id="diagram-1" name="${escapeXml(options.title ?? model.arch?.title ?? "Architecture Diagram")}">\n    <mxGraphModel dx="${Math.round(pageW * 0.8)}" dy="${Math.round(pageH * 0.8)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">\n      <root>\n        <mxCell id="0"/>\n        <mxCell id="${ROOT_CELL_ID}" parent="0"/>\n${[...nodeCells, ...overlayCells, ...edgeCells, ...badgeCells].join("\n")}\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>`;
}

export async function modelToDrawioResult(model: DiagramModel, options: DrawioOptions = {}): Promise<ExportResult<string>> {
  if (diagramKind(model) === "architecture") return exportResult(await modelToArchitectureDrawioContent(model, options));
  return exportResult(await modelToDrawioContent(model, options));
}

export async function modelToDrawio(model: DiagramModel, options: DrawioOptions = {}): Promise<string> {
  return (await modelToDrawioResult(model, options)).content;
}
