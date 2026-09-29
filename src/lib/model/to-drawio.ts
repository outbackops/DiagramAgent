import fs from "node:fs/promises";
import path from "node:path";

import { bottom, right, unionBoxes } from "./geometry";
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

function composedNodeLabel(model: DiagramModel, node: DiagramNode): string {
  if (!model.composed || !node.role) return node.label;
  const lines = [node.label];
  if (node.content?.subtitle) lines.push(node.content.subtitle);
  if (node.content?.lines) lines.push(...node.content.lines);
  if (node.content?.notes) lines.push(...node.content.notes);
  return lines.join("<br>");
}

export async function modelToDrawio(model: DiagramModel, options: DrawioOptions = {}): Promise<string> {
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
