import {
  bannerBlock,
  cardBlock,
  columnTitleBlock,
  flowTonesOfModel,
  laneFooterBlock,
  laneHeaderBlock,
  pageFooterBlock,
  pageHeaderBlock,
  stepBlock,
  type ContentBlock,
  type ContentContext,
  type Plate,
  type TextRun,
} from "@/lib/compose/content";
import { EDGE, FONT_MONO, FONT_SANS, PAGE, SPACE, TYPE, toneColors } from "@/lib/compose/theme";
import { safeIconHref } from "./icon-href";
import { bottom, longestSegmentMidpoint, right } from "./geometry";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, Point } from "./types";
import type { RenderModelSvgOptions } from "./render-svg";

const DEFAULT_PADDING = 40;

type DrawNode = DiagramNode & { role?: DiagramNode["role"] };

export function composedBounds(model: DiagramModel): Box {
  let maxRight = 0;
  let maxBottom = 0;
  for (const node of model.nodes) {
    maxRight = Math.max(maxRight, right(node.box));
    maxBottom = Math.max(maxBottom, bottom(node.box));
  }
  for (const edge of model.edges) {
    for (const point of edge.route) {
      maxRight = Math.max(maxRight, point.x);
      maxBottom = Math.max(maxBottom, point.y);
    }
    if (edge.labelAt) {
      maxRight = Math.max(maxRight, edge.labelAt.x);
      maxBottom = Math.max(maxBottom, edge.labelAt.y);
    }
  }
  return { x: 0, y: 0, w: maxRight, h: maxBottom + SPACE.margin };
}

export function renderComposedSvg(model: DiagramModel, options: RenderModelSvgOptions = {}): string {
  const padding = options.padding ?? DEFAULT_PADDING;
  const background = options.background === undefined ? PAGE.background : options.background;
  const idPrefix = sanitizeId(options.idPrefix ?? "da");
  const bounds = expandBox(composedBounds(model), padding);
  const page = composedBounds(model);
  const width = round(bounds.w);
  const height = round(bounds.h);
  const ctx = contentContext(model);
  const markerIds = markerMap(model, idPrefix);
  const headerGradientId = `${idPrefix}-composed-header-gradient`;
  const shadowId = `${idPrefix}-composed-panel-shadow`;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" class="da-composed-diagram">`,
  );
  out.push(`<style><![CDATA[
.da-composed-diagram .da-sans{font-family:${FONT_SANS};}
.da-composed-diagram .da-mono{font-family:${FONT_MONO};}
.da-composed-diagram text{dominant-baseline:alphabetic;white-space:pre;}
.da-composed-diagram .da-edge{fill:none;stroke-linecap:round;stroke-linejoin:round;}
]]></style>`);
  out.push("<defs>");
  out.push(`<linearGradient id="${headerGradientId}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${PAGE.headerFrom}"/><stop offset="100%" stop-color="${PAGE.headerTo}"/></linearGradient>`);
  out.push(`<filter id="${shadowId}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="${PAGE.shadow}" flood-opacity="0.14"/></filter>`);
  for (const marker of markerIds.values()) out.push(renderMarker(marker.id, marker.color));
  out.push("</defs>");
  if (background !== null) out.push(`<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(width)}" height="${num(height)}" fill="${escAttr(background)}"/>`);

  const nodes = model.nodes;
  renderRole(out, nodes, "header", (node) => renderHeader(node, page.w, headerGradientId));
  renderRole(out, nodes, "column", (node) => renderColumn(node, shadowId, ctx));
  renderRole(out, nodes, "banner", (node) => renderBanner(node));
  renderRole(out, nodes, "lane", (node) => renderLane(node));
  renderRole(out, nodes, "zone", (node) => renderZone(node));
  renderRole(out, nodes, "grid", (node) => renderGrid(node));
  renderRole(out, nodes, "card", (node) => renderCard(node, ctx));
  renderRole(out, nodes, "step", (node) => renderStep(node));
  for (const node of nodes.filter((n) => !n.role && n.role !== "footer")) out.push(renderRoleless(node, ctx));
  for (const edge of model.edges) out.push(renderEdge(edge, markerIds));
  for (const edge of model.edges) if (edge.label) out.push(renderEdgeLabel(edge));
  renderRole(out, nodes, "footer", (node) => renderFooter(node));

  out.push("</svg>");
  return out.join("");
}

function renderRole(out: string[], nodes: DiagramNode[], role: DiagramNode["role"], render: (node: DiagramNode) => string): void {
  for (const node of nodes) if (node.role === role) out.push(render(node));
}

function contentContext(model: DiagramModel): ContentContext {
  return { flowTones: flowTonesOfModel(model) };
}

function renderHeader(node: DiagramNode, pageWidth: number, gradientId: string): string {
  const block = pageHeaderBlock(node, pageWidth);
  const rect = `<rect x="0" y="0" width="${num(pageWidth)}" height="${num(node.box.h)}" fill="url(#${gradientId})"/>`;
  return group(node, true, rect + renderBlock(block, 0, 0, node));
}

function renderColumn(node: DiagramNode, shadowId: string, ctx: ContentContext): string {
  const { box } = node;
  const block = columnTitleBlock(node, box.w, ctx);
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.panelRadius}" fill="${PAGE.panelFill}" stroke="${PAGE.panelStroke}" stroke-width="1.5" filter="url(#${shadowId})"/>`;
  return group(node, true, rect + renderBlock(block, box.x, box.y, node));
}

function renderBanner(node: DiagramNode): string {
  const { box } = node;
  const tone = toneColors(node.tone);
  const block = bannerBlock(node, box.w, box.h);
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.bannerRadius}" fill="${tone.lane}" stroke="${tone.laneStroke}" stroke-width="1.5"/>`;
  return group(node, false, rect + renderBlock(block, box.x, box.y, node));
}

function renderLane(node: DiagramNode): string {
  const { box } = node;
  const tone = toneColors(node.tone);
  const header = laneHeaderBlock(node, box.w);
  const footer = laneFooterBlock(node, box.w);
  const footerY = box.y + box.h - footer.height;
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.laneRadius}" fill="${tone.lane}" stroke="${tone.laneStroke}" stroke-width="1.5"/>`;
  return group(node, true, rect + renderBlock(header, box.x, box.y, node) + renderBlock(footer, box.x, footerY, node));
}

/** A boundary (VNet, subnet, cluster, account): a dashed outline in its tone around its cards. */
function renderZone(node: DiagramNode): string {
  const { box } = node;
  const tone = toneColors(node.tone);
  const header = laneHeaderBlock(node, box.w);
  const footer = laneFooterBlock(node, box.w);
  const footerY = box.y + box.h - footer.height;
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.laneRadius}" fill="${tone.lane}" stroke="${tone.main}" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="7 5"/>`;
  return group(node, true, rect + renderBlock(header, box.x, box.y, node) + renderBlock(footer, box.x, footerY, node));
}

function renderGrid(node: DiagramNode): string {
  const { box } = node;
  return group(node, true, `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="${PAGE.panelFill}" fill-opacity="0.001"/>`);
}

function renderCard(node: DiagramNode, ctx: ContentContext): string {
  const { box } = node;
  const tone = toneColors(node.tone);
  const block = cardBlock(node, box.w, box.h, ctx);
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.cardRadius}" fill="${tone.fill}" stroke="${tone.main}" stroke-width="2"/>`;
  return group(node, false, rect + renderBlock(block, box.x, box.y, node));
}

function renderStep(node: DiagramNode): string {
  const { box } = node;
  const tone = toneColors(node.tone);
  const block = stepBlock(node, box.w, box.h);
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.stepRadius}" fill="${tone.fill}" stroke="${tone.main}" stroke-width="2"/>`;
  return group(node, false, rect + renderBlock(block, box.x, box.y, node));
}

function renderRoleless(node: DiagramNode, ctx: ContentContext): string {
  if (node.container) {
    const laneNode: DrawNode = { ...node, tone: node.tone ?? "gray" };
    return renderLane(laneNode);
  }
  const cardNode: DrawNode = { ...node, tone: node.tone ?? "gray" };
  return renderCard(cardNode, ctx);
}

function renderFooter(node: DiagramNode): string {
  const { box } = node;
  const block = pageFooterBlock(node, box.w);
  const rect = `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${SPACE.footerRadius}" fill="${PAGE.footerFill}"/>`;
  return group(node, false, rect + renderBlock(block, box.x, box.y, node));
}

function group(node: DiagramNode, groupKind: boolean, body: string): string {
  return `<g data-id="${escAttr(node.id)}" data-kind="${groupKind ? "group" : "node"}">${body}</g>`;
}

function renderBlock(block: ContentBlock, ox: number, oy: number, node: DiagramNode): string {
  const parts: string[] = [];
  for (const plate of block.plates) parts.push(renderPlate(plate, ox, oy));
  for (const arrow of block.arrows) {
    parts.push(`<path d="M ${num(ox + arrow.from.x)} ${num(oy + arrow.from.y)} L ${num(ox + arrow.to.x)} ${num(oy + arrow.to.y)}" stroke="${escAttr(arrow.color)}" stroke-width="1.5" fill="none" stroke-linecap="round"${arrow.dashed ? ` stroke-dasharray="${EDGE.dash}"` : ""}/>`);
  }
  const icon = safeIconHref(node.icon);
  if (icon && block.icon) {
    parts.push(`<image href="${escAttr(icon)}" x="${num(ox + block.icon.x)}" y="${num(oy + block.icon.y)}" width="${num(block.icon.w)}" height="${num(block.icon.h)}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  for (const run of block.runs) parts.push(renderRun(run, ox, oy));
  return parts.join("");
}

function renderPlate(plate: Plate, ox: number, oy: number): string {
  const attrs = [
    `x="${num(ox + plate.box.x)}"`,
    `y="${num(oy + plate.box.y)}"`,
    `width="${num(plate.box.w)}"`,
    `height="${num(plate.box.h)}"`,
    `rx="${num(plate.rx)}"`,
    `fill="${escAttr(plate.fill)}"`,
    plate.fillOpacity === undefined ? "" : `fill-opacity="${num(plate.fillOpacity)}"`,
    plate.stroke ? `stroke="${escAttr(plate.stroke)}"` : "",
    plate.strokeOpacity === undefined ? "" : `stroke-opacity="${num(plate.strokeOpacity)}"`,
    plate.strokeWidth === undefined ? "" : `stroke-width="${num(plate.strokeWidth)}"`,
  ].filter(Boolean);
  return `<rect ${attrs.join(" ")}/>`;
}

function renderRun(run: TextRun, ox: number, oy: number): string {
  const attrs = [
    `class="${run.style.mono ? "da-mono" : "da-sans"}"`,
    `x="${num(ox + run.x)}"`,
    `y="${num(oy + run.y)}"`,
    `text-anchor="${run.anchor}"`,
    `font-size="${num(run.style.size)}"`,
    `font-weight="${run.style.weight}"`,
    `fill="${escAttr(run.color)}"`,
    run.style.letterSpacing === undefined ? "" : `letter-spacing="${num(run.style.letterSpacing)}"`,
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${escText(run.text)}</text>`;
}

interface MarkerEntry {
  id: string;
  color: string;
}

function markerMap(model: DiagramModel, idPrefix: string): Map<string, MarkerEntry> {
  const map = new Map<string, MarkerEntry>();
  for (const edge of model.edges) {
    if (edge.route.length < 2) continue;
    const color = toneColors(edge.tone).main;
    if (!map.has(color)) map.set(color, { id: `${idPrefix}-composed-arrow-${hashColor(color)}`, color });
  }
  return map;
}

function renderMarker(id: string, color: string): string {
  return `<marker id="${id}" markerWidth="${EDGE.arrowLength}" markerHeight="${EDGE.arrowWidth}" refX="${EDGE.arrowLength}" refY="${num(EDGE.arrowWidth / 2)}" viewBox="0 0 ${EDGE.arrowLength} ${EDGE.arrowWidth}" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0,0 ${EDGE.arrowLength},${num(EDGE.arrowWidth / 2)} 0,${EDGE.arrowWidth}" fill="${escAttr(color)}"/></marker>`;
}

function renderEdge(edge: DiagramEdge, markers: Map<string, MarkerEntry>): string {
  if (edge.route.length === 0) return `<g data-edge="${escAttr(edge.id)}"></g>`;
  const color = toneColors(edge.tone).main;
  const marker = markers.get(color);
  const path = edgePath(edge);
  const width = edge.kind === "call" ? EDGE.callWidth : edge.kind === "step" ? EDGE.stepWidth : EDGE.flowWidth;
  const dash = edge.kind === "call" ? ` stroke-dasharray="${EDGE.dash}"` : "";
  const markerEnd = marker ? ` marker-end="url(#${marker.id})"` : "";
  return `<g data-edge="${escAttr(edge.id)}"><path d="${escAttr(path)}" stroke="${escAttr(color)}" stroke-width="${num(width)}"${dash}${markerEnd} class="da-edge"/></g>`;
}

function edgePath(edge: DiagramEdge): string {
  const points = edge.route;
  if (points.length === 1) return `M ${num(points[0].x)} ${num(points[0].y)}`;
  if (edge.kind === "flow" && edge.curve && points.length >= 2) return sCurvePath(points[0], points[points.length - 1]);
  if (edge.kind === "call") return roundedPolyline(points, EDGE.cornerRadius);
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${num(point.x)} ${num(point.y)}`).join(" ");
}

function sCurvePath(start: Point, end: Point): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const c1 = Math.abs(dx) < 24 ? { x: start.x, y: start.y + dy * 0.5 } : { x: start.x + dx * 0.5, y: start.y };
  const c2 = Math.abs(dx) < 24 ? { x: end.x, y: end.y - dy * 0.5 } : { x: end.x - dx * 0.5, y: end.y };
  return `M ${num(start.x)} ${num(start.y)} C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(end.x)} ${num(end.y)}`;
}

function roundedPolyline(points: Point[], radius: number): string {
  if (points.length === 1) return `M ${num(points[0].x)} ${num(points[0].y)}`;
  const d = [`M ${num(points[0].x)} ${num(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, distance(prev, cur) / 2, distance(cur, next) / 2);
    if (r <= 0) {
      d.push(`L ${num(cur.x)} ${num(cur.y)}`);
      continue;
    }
    const before = toward(cur, prev, r);
    const after = toward(cur, next, r);
    d.push(`L ${num(before.x)} ${num(before.y)} Q ${num(cur.x)} ${num(cur.y)} ${num(after.x)} ${num(after.y)}`);
  }
  const last = points[points.length - 1];
  d.push(`L ${num(last.x)} ${num(last.y)}`);
  return d.join(" ");
}

function renderEdgeLabel(edge: DiagramEdge): string {
  if (!edge.label || edge.route.length === 0) return "";
  const point = edge.labelAt ?? labelPoint(edge);
  const text = edge.label;
  return `<g data-edge-label="${escAttr(edge.id)}"><text class="da-sans" x="${num(point.x)}" y="${num(point.y + TYPE.edgeLabel.size * 0.36)}" text-anchor="middle" font-size="${num(TYPE.edgeLabel.size)}" font-weight="${TYPE.edgeLabel.weight}" fill="${PAGE.soft}" stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${escText(text)}</text></g>`;
}

function labelPoint(edge: DiagramEdge): Point {
  if (edge.kind === "flow" && edge.curve && edge.route.length >= 2) {
    const start = edge.route[0];
    const end = edge.route[edge.route.length - 1];
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  return longestSegmentMidpoint(edge.route);
}

function expandBox(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toward(from: Point, to: Point, len: number): Point {
  const d = distance(from, to);
  if (d === 0) return from;
  return { x: from.x + ((to.x - from.x) / d) * len, y: from.y + ((to.y - from.y) / d) * len };
}

function num(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function round(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function hashColor(color: string): string {
  let hash = 0;
  for (let i = 0; i < color.length; i++) hash = (hash * 31 + color.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]+/g, "-") || "da";
}

function escAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
