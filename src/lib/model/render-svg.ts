import { D2_THEME_0 } from "./d2-theme";
import { longestSegmentMidpoint, unionBoxes } from "./geometry";
import { indexModel, isGroup } from "./query";
import { architectureBounds, renderArchitectureSvg } from "./render-architecture";
import { composedBounds, renderComposedSvg } from "./render-composed";
import type { Arrowhead, Box, DiagramEdge, DiagramModel, DiagramNode, NodeStyle, Point, Size } from "./types";

export interface RenderModelSvgOptions {
  padding?: number;
  background?: string | null;
  idPrefix?: string;
}

interface LabelPlacement {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  box: Box;
}

const FONT_FAMILY = "\"Source Sans Pro\", \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif";
const DEFAULT_STROKE = "#0D32B2";
const DEFAULT_FONT = "#0A0F25";
const LABEL_PAD = 8;

export function modelBounds(model: DiagramModel): Box {
  if (model.kind === "architecture") return architectureBounds(model);
  if (model.composed) return composedBounds(model);
  const boxes: Box[] = [];
  const index = indexModel(model);
  for (const node of model.nodes) {
    boxes.push(node.box);
    const label = nodeLabelPlacement(node, isGroup(index, node.id));
    boxes.push(label.box);
  }
  for (const edge of model.edges) {
    if (edge.route.length > 0) {
      boxes.push(pointsBox(edge.route));
      if (edge.label) boxes.push(edgeLabelBox(edge));
    }
  }
  return unionBoxes(boxes) ?? { x: 0, y: 0, w: 0, h: 0 };
}

export function renderModelSvg(model: DiagramModel, options: RenderModelSvgOptions = {}): string {
  if (model.kind === "architecture") return renderArchitectureSvg(model, options);
  if (model.composed) return renderComposedSvg(model, options);
  const padding = options.padding ?? 40;
  const background = options.background === undefined ? "#ffffff" : options.background;
  const idPrefix = sanitizeId(options.idPrefix ?? "da");
  const bounds = expandBox(modelBounds(model), padding);
  const width = round(bounds.w);
  const height = round(bounds.h);
  const index = indexModel(model);
  const markerIds = collectMarkers(model, idPrefix);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" class="da-diagram">`,
  );
  out.push(`<style><![CDATA[
.da-diagram{font-family:${FONT_FAMILY};}
.da-diagram text{dominant-baseline:alphabetic;white-space:pre;}
.da-diagram .da-edge{fill:none;stroke-linecap:round;stroke-linejoin:round;}
]]></style>`);
  out.push("<defs>");
  out.push(`<filter id="${idPrefix}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="3" dy="4" stdDeviation="3" flood-color="#0A0F25" flood-opacity="0.18"/></filter>`);
  for (const marker of markerIds) out.push(renderMarker(marker.id, marker.arrow, marker.color));
  out.push("</defs>");
  if (background !== null) out.push(`<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(width)}" height="${num(height)}" fill="${escAttr(resolveColor(background))}"/>`);

  const groups = model.nodes.filter((node) => isGroup(index, node.id)).sort((a, b) => nodeDepth(a, index.byId) - nodeDepth(b, index.byId));
  for (const group of groups) out.push(renderNode(group, true, idPrefix));
  for (const edge of model.edges) {
    if (edge.route.length > 0) out.push(renderEdge(edge, markerIds));
  }
  for (const node of model.nodes) {
    if (!isGroup(index, node.id)) out.push(renderNode(node, false, idPrefix));
  }
  for (const edge of model.edges) {
    if (edge.route.length > 0 && edge.label) out.push(renderEdgeLabel(edge));
  }
  out.push("</svg>");
  return out.join("");
}

function renderNode(node: DiagramNode, group: boolean, idPrefix: string): string {
  const parts: string[] = [`<g data-id="${escAttr(node.id)}" data-kind="${group ? "group" : "node"}">`];
  const shape = node.shape.toLowerCase();
  if (shape !== "text" && shape !== "image") {
    if (node.style.multiple) parts.push(renderShape(node, group, translateBox(node.box, 8, 8), "opacity=\"0.28\""));
    parts.push(renderShape(node, group, node.box, node.style.shadow ? `filter="url(#${idPrefix}-shadow)"` : ""));
    if (node.style.doubleBorder) parts.push(renderShape(node, group, insetBox(node.box, 5), "fill=\"none\""));
  }
  const icon = safeIconHref(node.icon);
  if (icon) {
    const place = iconBox(node);
    parts.push(`<image href="${escAttr(icon)}" x="${num(place.x)}" y="${num(place.y)}" width="${num(place.w)}" height="${num(place.h)}"/>`);
  }
  if (node.label) parts.push(renderText(node.label, nodeLabelPlacement(node, group), node.style));
  parts.push("</g>");
  return parts.join("");
}

function renderShape(node: DiagramNode, group: boolean, box: Box, extra: string): string {
  const style = node.style;
  const fill = style.fill === undefined ? "transparent" : resolveColor(style.fill);
  const stroke = resolveColor(style.stroke ?? (group ? "#757575" : DEFAULT_STROKE));
  const sw = style.strokeWidth ?? (group ? 2 : 1);
  const attrs = [
    `stroke="${escAttr(stroke)}"`,
    `fill="${escAttr(fill)}"`,
    `stroke-width="${num(sw)}"`,
    dashAttr(style.strokeDash),
    opacityAttr(style.opacity),
    extra,
  ]
    .filter(Boolean)
    .join(" ");
  const shape = node.shape.toLowerCase();
  if (shape === "oval" || shape === "circle") return `<ellipse cx="${num(box.x + box.w / 2)}" cy="${num(box.y + box.h / 2)}" rx="${num(box.w / 2)}" ry="${num(box.h / 2)}" ${attrs}/>`;
  if (shape === "cloud") return `<path d="${escAttr(cloudPath(box))}" ${attrs}/>`;
  if (shape === "person") return `<path d="${escAttr(personPath(box))}" ${attrs}/>`;
  if (shape === "cylinder") return `<path d="${escAttr(cylinderPath(box))}" ${attrs}/><path d="${escAttr(cylinderTopPath(box))}" stroke="${escAttr(stroke)}" fill="none" stroke-width="${num(sw)}"/>`;
  if (shape === "queue") return `<path d="${escAttr(queuePath(box))}" ${attrs}/><path d="${escAttr(queueFrontPath(box))}" stroke="${escAttr(stroke)}" fill="none" stroke-width="${num(sw)}"/>`;
  if (shape === "text") return "";
  const path = polygonPath(shapePoints(shape, box));
  if (path) return `<path d="${escAttr(path)}" ${attrs}/>`;
  const rx = Math.max(0, style.borderRadius ?? 6);
  return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${num(rx)}" ${attrs}/>`;
}

function renderEdge(edge: DiagramEdge, markers: MarkerSpec[]): string {
  const stroke = resolveColor(edge.style.stroke ?? DEFAULT_STROKE);
  const sw = edge.style.strokeWidth ?? 2;
  const src = markerUrl(markers, edge.srcArrow, stroke);
  const dst = markerUrl(markers, edge.dstArrow, stroke);
  const attrs = [
    `d="${escAttr(edgePath(edge.route, edge.style.borderRadius ?? 10))}"`,
    `stroke="${escAttr(stroke)}"`,
    `stroke-width="${num(sw)}"`,
    dashAttr(edge.style.strokeDash),
    opacityAttr(edge.style.opacity),
    src ? `marker-start="${escAttr(src)}"` : "",
    dst ? `marker-end="${escAttr(dst)}"` : "",
    `class="da-edge"`,
  ]
    .filter(Boolean)
    .join(" ");
  return `<g data-edge="${escAttr(edge.id)}"><path ${attrs}/></g>`;
}

function renderEdgeLabel(edge: DiagramEdge): string {
  if (!edge.label) return "";
  const box = edgeLabelBox(edge);
  const fontSize = edge.style.fontSize ?? 16;
  const mid = longestSegmentMidpoint(edge.route);
  const y = mid.y + fontSize / 2 - 2;
  return `<g data-edge-label="${escAttr(edge.id)}"><rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="3" fill="#ffffff" opacity="0.88"/><text x="${num(mid.x)}" y="${num(y)}" fill="${escAttr(resolveColor(edge.style.fontColor ?? "N2"))}" style="${textStyle({ ...edge.style, fontSize, italic: edge.style.italic ?? true })};text-anchor:middle">${escText(edge.label)}</text></g>`;
}

function renderText(label: string, placement: LabelPlacement, style: NodeStyle): string {
  const decoration = style.underline ? "text-decoration:underline;" : "";
  return `<text x="${num(placement.x)}" y="${num(placement.y)}" fill="${escAttr(resolveColor(style.fontColor ?? DEFAULT_FONT))}" style="${textStyle(style)};text-anchor:${placement.anchor};${decoration}">${escText(label)}</text>`;
}

function textStyle(style: NodeStyle): string {
  const bits = [`font-size:${num(style.fontSize ?? 16)}px`];
  if (style.bold) bits.push("font-weight:700");
  if (style.italic) bits.push("font-style:italic");
  return bits.join(";");
}

function nodeLabelPlacement(node: DiagramNode, group: boolean): LabelPlacement {
  const fontSize = node.style.fontSize ?? (group ? 24 : 16);
  const size = labelSize(node.label, fontSize, node.labelSize);
  const imageLabel = node.shape.toLowerCase() === "image";
  const pos = normalizePosition(node.labelPosition ?? (imageLabel ? "OUTSIDE_BOTTOM_CENTER" : group ? "INSIDE_TOP_CENTER" : node.icon ? "INSIDE_TOP_CENTER" : "INSIDE_MIDDLE_CENTER"));
  return placeLabel(node.box, pos, size, fontSize);
}

function placeLabel(box: Box, pos: string, size: Size, fontSize: number): LabelPlacement {
  const [inside, vertical, horizontal] = parsePosition(pos);
  const outside = inside === "OUTSIDE";
  let centerX = box.x + box.w / 2;
  if (horizontal === "LEFT") centerX = outside ? box.x - LABEL_PAD - size.w / 2 : box.x + LABEL_PAD + size.w / 2;
  if (horizontal === "RIGHT") centerX = outside ? box.x + box.w + LABEL_PAD + size.w / 2 : box.x + box.w - LABEL_PAD - size.w / 2;
  let textY = box.y + fontSize + 5;
  if (vertical === "MIDDLE") textY = box.y + box.h / 2 + fontSize / 3;
  if (vertical === "BOTTOM") textY = box.y + box.h - LABEL_PAD;
  if (outside && vertical === "TOP") textY = box.y - LABEL_PAD;
  if (outside && vertical === "BOTTOM") textY = box.y + box.h + fontSize + LABEL_PAD;
  const labelBox = { x: centerX - size.w / 2, y: textY - fontSize, w: size.w, h: size.h };
  return { x: centerX, y: textY, anchor: "middle", box: labelBox };
}

function edgeLabelBox(edge: DiagramEdge): Box {
  const fontSize = edge.style.fontSize ?? 16;
  const size = labelSize(edge.label ?? "", fontSize, edge.labelSize);
  const mid = longestSegmentMidpoint(edge.route);
  return { x: mid.x - size.w / 2 - 6, y: mid.y - size.h / 2 - 3, w: size.w + 12, h: size.h + 6 };
}

/** Where a node's icon is drawn (absolute). Exporters use the same box so files match the canvas. */
export function iconBox(node: DiagramNode): Box {
  const box = node.box;
  if (node.shape.toLowerCase() === "image") return box;
  const pos = normalizePosition(node.iconPosition || "INSIDE_MIDDLE_CENTER");
  const middle = pos === "INSIDE_MIDDLE_CENTER";
  const minSide = Math.min(box.w, box.h);
  const size = middle ? Math.min(64, minSide / 2) : Math.min(64, Math.max(32, minSide / 4));
  const [, vertical, horizontal] = parsePosition(pos);
  let x = box.x + box.w / 2 - size / 2;
  let y = box.y + box.h / 2 - size / 2;
  if (horizontal === "LEFT") x = box.x + 5;
  if (horizontal === "RIGHT") x = box.x + box.w - size - 5;
  if (vertical === "TOP") y = box.y + 5;
  if (vertical === "BOTTOM") y = box.y + box.h - size - 5;
  return { x, y, w: size, h: size };
}

function edgePath(points: Point[], radius: number): string {
  if (points.length === 0) return "";
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

function shapePoints(shape: string, b: Box): Point[] | null {
  const x = b.x;
  const y = b.y;
  const w = b.w;
  const h = b.h;
  if (shape === "diamond") return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
  if (shape === "hexagon") return [{ x: x + w * 0.25, y }, { x: x + w * 0.75, y }, { x: x + w, y: y + h / 2 }, { x: x + w * 0.75, y: y + h }, { x: x + w * 0.25, y: y + h }, { x, y: y + h / 2 }];
  if (shape === "parallelogram") return [{ x: x + w * 0.15, y }, { x: x + w, y }, { x: x + w * 0.85, y: y + h }, { x, y: y + h }];
  if (shape === "step") return [{ x, y }, { x: x + w * 0.75, y }, { x: x + w, y: y + h / 2 }, { x: x + w * 0.75, y: y + h }, { x, y: y + h }];
  if (shape === "callout") return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h * 0.75 }, { x: x + w * 0.62, y: y + h * 0.75 }, { x: x + w * 0.5, y: y + h }, { x: x + w * 0.45, y: y + h * 0.75 }, { x, y: y + h * 0.75 }];
  if (shape === "document" || shape === "page") return [{ x, y }, { x: x + w * 0.82, y }, { x: x + w, y: y + h * 0.18 }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (shape === "package") return [{ x, y: y + h * 0.18 }, { x: x + w * 0.28, y: y + h * 0.18 }, { x: x + w * 0.34, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (shape === "stored_data") return [{ x: x + w * 0.12, y }, { x: x + w, y }, { x: x + w * 0.88, y: y + h }, { x, y: y + h }];
  return null;
}

function polygonPath(points: Point[] | null): string | null {
  if (!points) return null;
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${num(p.x)} ${num(p.y)}`).join(" ") + " Z";
}

function cylinderPath(b: Box): string {
  const r = Math.min(24, b.h * 0.18);
  return `M ${num(b.x)} ${num(b.y + r)} C ${num(b.x)} ${num(b.y - r / 3)} ${num(b.x + b.w)} ${num(b.y - r / 3)} ${num(b.x + b.w)} ${num(b.y + r)} V ${num(b.y + b.h - r)} C ${num(b.x + b.w)} ${num(b.y + b.h + r / 3)} ${num(b.x)} ${num(b.y + b.h + r / 3)} ${num(b.x)} ${num(b.y + b.h - r)} Z`;
}

function cylinderTopPath(b: Box): string {
  const r = Math.min(24, b.h * 0.18);
  return `M ${num(b.x)} ${num(b.y + r)} C ${num(b.x)} ${num(b.y + r * 2)} ${num(b.x + b.w)} ${num(b.y + r * 2)} ${num(b.x + b.w)} ${num(b.y + r)}`;
}

function queuePath(b: Box): string {
  const r = Math.min(24, b.w * 0.12);
  return `M ${num(b.x + r)} ${num(b.y)} H ${num(b.x + b.w - r)} C ${num(b.x + b.w + r / 2)} ${num(b.y)} ${num(b.x + b.w + r / 2)} ${num(b.y + b.h)} ${num(b.x + b.w - r)} ${num(b.y + b.h)} H ${num(b.x + r)} C ${num(b.x - r / 2)} ${num(b.y + b.h)} ${num(b.x - r / 2)} ${num(b.y)} ${num(b.x + r)} ${num(b.y)} Z`;
}

function queueFrontPath(b: Box): string {
  const r = Math.min(24, b.w * 0.12);
  return `M ${num(b.x + r)} ${num(b.y)} C ${num(b.x + r * 2)} ${num(b.y)} ${num(b.x + r * 2)} ${num(b.y + b.h)} ${num(b.x + r)} ${num(b.y + b.h)}`;
}

function cloudPath(b: Box): string {
  const x = b.x;
  const y = b.y;
  const w = b.w;
  const h = b.h;
  return `M ${num(x + w * 0.23)} ${num(y + h * 0.76)} C ${num(x - w * 0.02)} ${num(y + h * 0.76)} ${num(x - w * 0.02)} ${num(y + h * 0.43)} ${num(x + w * 0.22)} ${num(y + h * 0.43)} C ${num(x + w * 0.27)} ${num(y + h * 0.16)} ${num(x + w * 0.58)} ${num(y + h * 0.1)} ${num(x + w * 0.72)} ${num(y + h * 0.31)} C ${num(x + w * 0.98)} ${num(y + h * 0.3)} ${num(x + w * 1.05)} ${num(y + h * 0.67)} ${num(x + w * 0.82)} ${num(y + h * 0.76)} Z`;
}

function personPath(b: Box): string {
  const cx = b.x + b.w / 2;
  const headR = Math.min(b.w, b.h) * 0.16;
  const headCy = b.y + b.h * 0.24;
  return `M ${num(cx)} ${num(headCy - headR)} A ${num(headR)} ${num(headR)} 0 1 1 ${num(cx - 0.01)} ${num(headCy - headR)} M ${num(b.x + b.w * 0.22)} ${num(b.y + b.h * 0.92)} C ${num(b.x + b.w * 0.26)} ${num(b.y + b.h * 0.58)} ${num(b.x + b.w * 0.74)} ${num(b.y + b.h * 0.58)} ${num(b.x + b.w * 0.78)} ${num(b.y + b.h * 0.92)} Z`;
}

interface MarkerSpec {
  id: string;
  arrow: Arrowhead;
  color: string;
}

function collectMarkers(model: DiagramModel, idPrefix: string): MarkerSpec[] {
  const markers: MarkerSpec[] = [];
  const seen = new Set<string>();
  for (const edge of model.edges) {
    if (edge.route.length === 0) continue;
    const color = resolveColor(edge.style.stroke ?? DEFAULT_STROKE);
    for (const arrow of [edge.srcArrow, edge.dstArrow]) {
      if (arrow === "none") continue;
      const key = `${arrow}:${color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({ id: `${idPrefix}-marker-${sanitizeId(arrow)}-${hashColor(color)}`, arrow, color });
    }
  }
  return markers;
}

function markerUrl(markers: MarkerSpec[], arrow: Arrowhead, color: string): string | null {
  if (arrow === "none") return null;
  const marker = markers.find((m) => m.arrow === arrow && m.color === color);
  return marker ? `url(#${marker.id})` : null;
}

function renderMarker(id: string, arrow: Arrowhead, color: string): string {
  if (arrow === "diamond" || arrow === "filled-diamond") {
    const fill = arrow === "filled-diamond" ? color : "#ffffff";
    return `<marker id="${id}" markerWidth="14" markerHeight="14" refX="12" refY="7" viewBox="0 0 14 14" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 1 7 L 7 1 L 13 7 L 7 13 Z" fill="${escAttr(fill)}" stroke="${escAttr(color)}" stroke-width="1.5"/></marker>`;
  }
  if (arrow === "circle" || arrow === "filled-circle") {
    const fill = arrow === "filled-circle" ? color : "#ffffff";
    return `<marker id="${id}" markerWidth="14" markerHeight="14" refX="12" refY="7" viewBox="0 0 14 14" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="7" cy="7" r="5" fill="${escAttr(fill)}" stroke="${escAttr(color)}" stroke-width="1.5"/></marker>`;
  }
  if (arrow === "line" || arrow === "cf-one" || arrow === "cf-one-required") {
    return `<marker id="${id}" markerWidth="12" markerHeight="12" refX="10" refY="6" viewBox="0 0 12 12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 2 2 L 10 6 L 2 10" fill="none" stroke="${escAttr(color)}" stroke-width="2"/></marker>`;
  }
  if (arrow === "cross" || arrow === "cf-many" || arrow === "cf-many-required") {
    return `<marker id="${id}" markerWidth="12" markerHeight="12" refX="10" refY="6" viewBox="0 0 12 12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 2 2 L 10 10 M 10 2 L 2 10" fill="none" stroke="${escAttr(color)}" stroke-width="2"/></marker>`;
  }
  if (arrow === "box" || arrow === "filled-box") {
    const fill = arrow === "filled-box" ? color : "#ffffff";
    return `<marker id="${id}" markerWidth="12" markerHeight="12" refX="10" refY="6" viewBox="0 0 12 12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><rect x="2" y="2" width="8" height="8" fill="${escAttr(fill)}" stroke="${escAttr(color)}" stroke-width="1.5"/></marker>`;
  }
  return `<marker id="${id}" markerWidth="10" markerHeight="12" refX="9" refY="6" viewBox="0 0 10 12" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><polygon points="0,0 10,6 0,12" fill="${escAttr(color)}" stroke="${escAttr(color)}" stroke-width="1"/></marker>`;
}

function labelSize(label: string, fontSize: number, measured?: Size): Size {
  if (measured) return measured;
  return { w: Math.max(1, label.length * fontSize * 0.6), h: Math.ceil(fontSize * 1.3) };
}

function safeIconHref(href: string | undefined): string | null {
  if (!href) return null;
  if (/^\/icons\/[A-Za-z0-9._-]+\.svg$/.test(href)) return href;
  if (/^data:image\/(?:svg\+xml|png|jpeg|gif|webp)[;,]/i.test(href)) return href;
  return null;
}

function parsePosition(pos: string): ["INSIDE" | "OUTSIDE", "TOP" | "MIDDLE" | "BOTTOM", "LEFT" | "CENTER" | "RIGHT"] {
  const parts = normalizePosition(pos).split("_");
  return [parts[0] as "INSIDE" | "OUTSIDE", parts[1] as "TOP" | "MIDDLE" | "BOTTOM", parts[2] as "LEFT" | "CENTER" | "RIGHT"];
}

function normalizePosition(pos: string): string {
  return /^(INSIDE|OUTSIDE)_(TOP|MIDDLE|BOTTOM)_(LEFT|CENTER|RIGHT)$/.test(pos) ? pos : "INSIDE_MIDDLE_CENTER";
}

function resolveColor(color: string): string {
  return D2_THEME_0[color] ?? color;
}

function dashAttr(strokeDash: number | undefined): string {
  if (!strokeDash) return "";
  return `stroke-dasharray="${num(strokeDash)},${num(Math.max(0, strokeDash - 0.134361))}"`;
}

function opacityAttr(opacity: number | undefined): string {
  return opacity === undefined || opacity === 1 ? "" : `opacity="${num(opacity)}"`;
}

function pointsBox(points: Point[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function expandBox(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 };
}

function translateBox(box: Box, dx: number, dy: number): Box {
  return { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
}

function insetBox(box: Box, inset: number): Box {
  return { x: box.x + inset, y: box.y + inset, w: Math.max(0, box.w - inset * 2), h: Math.max(0, box.h - inset * 2) };
}

function nodeDepth(node: DiagramNode, nodes: Map<string, DiagramNode>): number {
  let depth = 0;
  let current = node.parent;
  while (current) {
    depth++;
    current = nodes.get(current)?.parent ?? null;
  }
  return depth;
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
