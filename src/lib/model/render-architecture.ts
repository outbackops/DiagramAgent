import { componentGeom } from "@/lib/arch/measure";
import { overlayGeometries } from "@/lib/arch/overlays";
import { assumptionsBlock, legendBlock, overlayTag, titleBlock, workflowBlock, type PageBlock } from "@/lib/arch/page";
import { allItems, isBoundary, type BoundaryKind, type Meaning, type NBoundary, type NComponent, type NItem, type NormalizedArchSpec, type Platform } from "@/lib/arch/spec";
import { badgeStyle, boundaryPlatform, boundaryStyle, connectorStyle, inferPlatform, stylePack, type BoundaryStyle, type ConnectorStyle, type StylePack } from "@/lib/arch/styles";
import { ARCH_SPACE as S, ARCH_TYPE as T } from "@/lib/arch/theme";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, Point } from "./types";
import type { RenderModelSvgOptions } from "./render-svg";

/**
 * Renders an Architecture model in the conventions of the platform it depicts (style packs in
 * src/lib/arch/styles.ts): icon-first components, nested boundaries with titled headers,
 * orthogonal connectors styled by meaning, numbered step badges, and the page's title,
 * workflow, legend and assumptions. Deterministic; `data-id`/`data-edge` hook the canvas.
 */

const DEFAULT_PADDING = 0;

export function architectureBounds(model: DiagramModel): Box {
  let maxRight = 0;
  let maxBottom = 0;
  for (const node of model.nodes) {
    maxRight = Math.max(maxRight, node.box.x + node.box.w);
    maxBottom = Math.max(maxBottom, node.box.y + node.box.h);
  }
  for (const edge of model.edges) {
    if (edge.hidden) continue;
    for (const p of edge.route) {
      maxRight = Math.max(maxRight, p.x);
      maxBottom = Math.max(maxBottom, p.y);
    }
  }
  return { x: 0, y: 0, w: Math.ceil(maxRight + S.pageMargin), h: Math.ceil(maxBottom + S.pageMargin) };
}

export function renderArchitectureSvg(model: DiagramModel, options: RenderModelSvgOptions = {}): string {
  const padding = options.padding ?? DEFAULT_PADDING;
  const idPrefix = sanitizeId(options.idPrefix ?? "da");
  const view = modelView(model);
  const page = view.platform;
  const pack = stylePack(page);
  const background = options.background === undefined ? pack.background : options.background;
  const b = architectureBounds(model);
  const bounds = { x: b.x - padding, y: b.y - padding, w: b.w + padding * 2, h: b.h + padding * 2 };
  const markers = new Map<string, string>();
  const markerFor = (color: string, kind: "filled" | "open") => {
    const key = `${kind}:${color}`;
    if (!markers.has(key)) markers.set(key, `${idPrefix}-arch-${kind}-${hash(color)}`);
    return markers.get(key)!;
  };

  const body: string[] = [];
  // Boundaries, parents first (model order), then overlays, connectors, labels, components, badges, page.
  for (const node of model.nodes) if (node.role === "boundary" || (node.container && !node.generated && node.role !== "service")) body.push(renderBoundary(node, view, page));
  const overlays = overlayGeometries(model);
  for (const g of overlays.filter((o) => o.clean)) body.push(renderOverlay(g.box, g.overlay.name, g.overlay.kind as BoundaryKind, page, pack));
  const visible = model.edges.filter((e) => !e.hidden);
  for (const edge of visible) body.push(renderEdge(edge, connectorStyle(page, edgeMeaning(edge)), page, markerFor));
  for (const edge of visible) if (edge.label) body.push(renderEdgeLabel(edge, pack));
  for (const node of model.nodes) if (!node.container && !node.generated) body.push(renderComponent(node, pack));
  for (const g of overlays.filter((o) => !o.clean)) for (const id of g.memberIds) body.push(renderTag(model.nodes.find((n) => n.id === id)!, overlayTag(g.overlay), pack));
  for (const edge of visible) body.push(renderBadges(edge, model, page));
  for (const node of model.nodes) if (node.generated) body.push(renderPageNode(node, model, page, pack, overlays.filter((o) => !o.clean).map((o) => o.overlay)));

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${num(bounds.x)} ${num(bounds.y)} ${num(bounds.w)} ${num(bounds.h)}" width="${num(bounds.w)}" height="${num(bounds.h)}" class="da-arch-diagram" role="img">`,
  );
  out.push(`<title>${esc(model.arch?.title ?? "Architecture diagram")}</title><desc>${esc(describe(model))}</desc>`);
  out.push(`<style><![CDATA[
.da-arch-diagram text{font-family:${pack.fontFamily};dominant-baseline:alphabetic;white-space:pre;}
.da-arch-diagram .da-mono{font-family:Consolas,"Cascadia Mono","SF Mono",Menlo,monospace;}
.da-arch-diagram .da-edge{fill:none;stroke-linejoin:round;}
]]></style>`);
  out.push("<defs>");
  for (const [key, id] of markers) out.push(renderMarker(id, key.slice(key.indexOf(":") + 1), key.startsWith("open") ? "open" : "filled"));
  out.push("</defs>");
  if (background !== null) out.push(`<rect x="${num(bounds.x)}" y="${num(bounds.y)}" width="${num(bounds.w)}" height="${num(bounds.h)}" fill="${attr(background)}"/>`);
  out.push(...body);
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------- platform view of the model

interface ModelView {
  platform: Platform;
  /** Drawing platform of each boundary node. */
  boundaryPlatforms: Map<string, Platform>;
}

/** The model as spec items, so platform inference matches the style packs' rules exactly. */
function modelView(model: DiagramModel): ModelView {
  const children = new Map<string | null, DiagramNode[]>();
  for (const node of model.nodes) {
    if (node.generated) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }
  const toItem = (node: DiagramNode): NItem =>
    node.container
      ? ({ type: "boundary", id: node.id, kind: (node.arch?.kind ?? "group") as BoundaryKind, name: node.label, items: (children.get(node.id) ?? []).map(toItem), ...(node.arch?.platform ? { platform: node.arch.platform } : {}) } as NBoundary)
      : ({ type: "component", id: node.id, name: node.label, ...(node.arch?.iconKey ? { icon: node.arch.iconKey } : iconKeyOf(node.icon) ? { icon: iconKeyOf(node.icon) } : {}) } as NComponent);
  const items = (children.get(null) ?? []).map(toItem);
  const spec: NormalizedArchSpec = { version: 1, title: model.arch?.title ?? "", items, connections: [], sequences: [], overlays: [], assumptions: [] };
  if (model.arch?.platform) spec.platform = model.arch.platform;
  const platform = inferPlatform(spec);
  const boundaryPlatforms = new Map<string, Platform>();
  for (const item of allItems(items)) if (isBoundary(item)) boundaryPlatforms.set(item.id, boundaryPlatform(item, platform));
  return { platform, boundaryPlatforms };
}

function iconKeyOf(url: string | undefined): string | undefined {
  return url?.match(/^\/icons\/([a-z0-9-]+)\.svg$/)?.[1];
}

function edgeMeaning(edge: DiagramEdge): Meaning {
  return edge.meaning ?? "request";
}

// ---------------------------------------------------------------- boundaries and overlays

function renderBoundary(node: DiagramNode, view: ModelView, page: Platform): string {
  const platform = view.boundaryPlatforms.get(node.id) ?? page;
  const kind = (node.arch?.kind ?? "group") as BoundaryKind;
  const style = boundaryStyle(platform, kind);
  const pack = stylePack(platform);
  const box = node.box;
  const parts: string[] = [];
  parts.push(rect(box, style));
  const facts = node.arch?.facts;
  const iconX = box.x + S.groupPad / 2;
  let textX = iconX;
  if (style.headerIcon) {
    parts.push(`<image href="/icons/${attr(style.headerIcon)}.svg" x="${num(iconX)}" y="${num(box.y + 10)}" width="${S.headerIcon}" height="${S.headerIcon}" preserveAspectRatio="xMidYMid meet"/>`);
    textX = iconX + S.headerIcon + 8;
  }
  parts.push(`<text x="${num(textX)}" y="${num(box.y + 25)}" font-size="${T.boundary.size}" font-weight="${style.bold ? 700 : T.boundary.weight}" fill="${attr(style.headerColor)}">${esc(node.label)}</text>`);
  if (facts) parts.push(`<text class="da-mono" x="${num(textX)}" y="${num(box.y + 42)}" font-size="${T.facts.size}" fill="${attr(pack.muted)}">${esc(facts)}</text>`);
  if (style.marker) parts.push(renderMarkerGlyph(style.marker, box.x + box.w - 18, box.y + 16, style.stroke));
  return `<g data-id="${attr(node.id)}" data-kind="group">${parts.join("")}</g>`;
}

function renderOverlay(box: Box, name: string, kind: BoundaryKind, page: Platform, pack: StylePack): string {
  const style = boundaryStyle(page, kind === "group" ? "scaling-group" : kind);
  const labelW = Math.ceil(name.length * 6.6) + 12;
    // The name sits on the bottom border: the top is where the members' own boundary headers are.
  const y = box.y + box.h;
  return `<g data-overlay="${attr(name)}">${rect(box, { ...style, fill: "none" })}<rect x="${num(box.x + 10)}" y="${num(y - 9)}" width="${labelW}" height="18" rx="3" fill="${attr(pack.background)}"/><text x="${num(box.x + 16)}" y="${num(y + 4)}" font-size="11" font-weight="600" fill="${attr(style.stroke)}">${esc(name)}</text></g>`;
}

function renderTag(node: DiagramNode, tag: string, pack: StylePack): string {
  const w = Math.ceil(tag.length * 7) + 10;
  const x = node.box.x + node.box.w - w - 4;
  const y = node.box.y + 4;
  return `<g data-tag="${attr(tag)}"><rect x="${num(x)}" y="${num(y)}" width="${w}" height="16" rx="8" fill="${attr(pack.background)}" stroke="#ED7100"/><text x="${num(x + w / 2)}" y="${num(y + 11.5)}" text-anchor="middle" font-size="10" font-weight="700" fill="#ED7100">${esc(tag)}</text></g>`;
}

function rect(box: Box, style: BoundaryStyle): string {
  const dash = style.dash ? ` stroke-dasharray="${attr(style.dash)}"` : "";
  const fillOpacity = style.fillOpacity !== undefined ? ` fill-opacity="${style.fillOpacity}"` : "";
  return `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="${style.radius}" fill="${attr(style.fill)}"${fillOpacity} stroke="${attr(style.stroke)}" stroke-width="${style.strokeWidth}"${dash}/>`;
}

function renderMarkerGlyph(marker: "shield" | "globe" | "lock", cx: number, cy: number, color: string): string {
  if (marker === "shield") return `<path d="M${num(cx)} ${num(cy - 9)} L${num(cx + 8)} ${num(cy - 6)} V${num(cy + 1)} C${num(cx + 8)} ${num(cy + 6)} ${num(cx + 4)} ${num(cy + 9)} ${num(cx)} ${num(cy + 10)} C${num(cx - 4)} ${num(cy + 9)} ${num(cx - 8)} ${num(cy + 6)} ${num(cx - 8)} ${num(cy + 1)} V${num(cy - 6)} Z" fill="#1490DF" stroke="#0F6CBD" stroke-width="0.8"/><path d="M${num(cx)} ${num(cy - 9)} V${num(cy + 10)}" stroke="#FFFFFF" stroke-width="1"/>`;
  if (marker === "globe") return `<circle cx="${num(cx)}" cy="${num(cy)}" r="8" fill="none" stroke="${attr(color)}" stroke-width="1.2"/><ellipse cx="${num(cx)}" cy="${num(cy)}" rx="3.5" ry="8" fill="none" stroke="${attr(color)}" stroke-width="1"/><path d="M${num(cx - 8)} ${num(cy)} H${num(cx + 8)}" stroke="${attr(color)}" stroke-width="1"/>`;
  return `<rect x="${num(cx - 5)}" y="${num(cy - 1)}" width="10" height="8" rx="1.5" fill="${attr(color)}"/><path d="M${num(cx - 3)} ${num(cy - 1)} V${num(cy - 4)} A3 3 0 0 1 ${num(cx + 3)} ${num(cy - 4)} V${num(cy - 1)}" fill="none" stroke="${attr(color)}" stroke-width="1.4"/>`;
}

// ---------------------------------------------------------------- components

function renderComponent(node: DiagramNode, pack: StylePack): string {
  const box = node.box;
  const geom = componentGeom({ type: "component", id: node.id, name: node.label, ...(node.arch?.detail ? { detail: node.arch.detail } : {}) });
  const parts: string[] = [];
  if (pack.node.cardFill) parts.push(`<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="2" fill="${attr(pack.node.cardFill)}" stroke="${attr(pack.node.cardStroke ?? "none")}" stroke-width="0.75"/>`);
  const cx = box.x + box.w / 2;
  const iconY = box.y + S.nodePadTop;
  if (node.icon) parts.push(`<image href="${attr(node.icon)}" x="${num(cx - S.icon / 2)}" y="${num(iconY)}" width="${S.icon}" height="${S.icon}" preserveAspectRatio="xMidYMid meet"/>`);
  else parts.push(genericIcon(node.label, cx, iconY, pack));
  let y = iconY + S.icon + S.iconGap;
  for (const line of geom.lines) {
    y += S.nameLineHeight;
    parts.push(`<text x="${num(cx)}" y="${num(y - 4)}" text-anchor="middle" font-size="${T.name.size}" fill="${attr(pack.text)}">${esc(line)}</text>`);
  }
  if (geom.detail) {
    y += S.detailLineHeight;
    parts.push(`<text x="${num(cx)}" y="${num(y - 4)}" text-anchor="middle" font-size="${T.detail.size}" fill="${attr(pack.muted)}">${esc(geom.detail)}</text>`);
  }
  return `<g data-id="${attr(node.id)}" data-kind="node">${parts.join("")}</g>`;
}

/** A component without a matching service icon: a clean tile with its initials (origin R7). */
function genericIcon(name: string, cx: number, y: number, pack: StylePack): string {
  const initials = name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "•";
  return `<rect x="${num(cx - S.icon / 2 + 4)}" y="${num(y + 4)}" width="${S.icon - 8}" height="${S.icon - 8}" rx="8" fill="#F1F5F9" stroke="#CBD5E1"/><text x="${num(cx)}" y="${num(y + S.icon / 2 + 5)}" text-anchor="middle" font-size="14" font-weight="600" fill="${attr(pack.muted)}">${esc(initials)}</text>`;
}

// ---------------------------------------------------------------- connectors, labels, badges

const CORNER: Record<Platform, number> = { azure: 0, aws: 0, gcp: 4, kubernetes: 4, neutral: 6 };

function renderEdge(edge: DiagramEdge, style: ConnectorStyle, page: Platform, markerFor: (color: string, kind: "filled" | "open") => string): string {
  if (edge.route.length < 2) return `<g data-edge="${attr(edge.id)}"></g>`;
  const d = pathOf(edge.route, CORNER[page]);
  const dash = style.dash ? ` stroke-dasharray="${attr(style.dash)}"` : "";
  const end = style.arrowEnd !== "none" ? ` marker-end="url(#${markerFor(style.stroke, style.arrowEnd)})"` : "";
  const start = style.arrowStart !== "none" ? ` marker-start="url(#${markerFor(style.stroke, style.arrowStart)})"` : "";
  return `<g data-edge="${attr(edge.id)}"><path d="${attr(d)}" stroke="transparent" stroke-width="12" fill="none"/><path class="da-edge" d="${attr(d)}" stroke="${attr(style.stroke)}" stroke-width="${style.width}"${dash}${start}${end}/></g>`;
}

function pathOf(points: Point[], radius: number): string {
  if (radius <= 0 || points.length < 3) return `M${points.map((p) => `${num(p.x)} ${num(p.y)}`).join(" L")}`;
  let d = `M${num(points[0].x)} ${num(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, p, b] = [points[i - 1], points[i], points[i + 1]];
    const r = Math.min(radius, dist(a, p) / 2, dist(p, b) / 2);
    const p1 = towards(p, a, r);
    const p2 = towards(p, b, r);
    d += ` L${num(p1.x)} ${num(p1.y)} Q${num(p.x)} ${num(p.y)} ${num(p2.x)} ${num(p2.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${num(last.x)} ${num(last.y)}`;
}

function renderEdgeLabel(edge: DiagramEdge, pack: StylePack): string {
  const text = edge.label ?? "";
  const size = edge.labelSize ?? { w: Math.ceil(text.length * 6) + S.edgeLabelPad * 2, h: S.edgeLabelHeight };
  const at = edge.labelAt ?? midpoint(edge.route);
  if (!at) return "";
  return `<g data-edge-label="${attr(edge.id)}"><rect x="${num(at.x - size.w / 2)}" y="${num(at.y - size.h / 2)}" width="${num(size.w)}" height="${num(size.h)}" rx="3" fill="${attr(pack.edgeLabel.fill)}"/><text x="${num(at.x)}" y="${num(at.y + 4)}" text-anchor="middle" font-size="${T.edgeLabel.size}" fill="${attr(pack.edgeLabel.text)}">${esc(text)}</text></g>`;
}

function renderBadges(edge: DiagramEdge, model: DiagramModel, page: Platform): string {
  if (!edge.badges?.length || edge.route.length < 2) return "";
  const sequences = model.arch?.sequences ?? [];
  return edge.badges
    .map((badge) => {
      const at = badge.at ?? along(edge.route, 24);
      const index = Math.max(0, sequences.findIndex((s) => s.id === badge.sequence));
      return badgeMark(at, badge.number, badgeStyle(page, index));
    })
    .join("");
}

function badgeMark(at: Point, number: number, style: { shape: "circle" | "square"; fill: string; text: string }): string {
  const r = S.badge / 2;
  const shape = style.shape === "circle" ? `<circle cx="${num(at.x)}" cy="${num(at.y)}" r="${r}" fill="${attr(style.fill)}"/>` : `<rect x="${num(at.x - r)}" y="${num(at.y - r)}" width="${S.badge}" height="${S.badge}" rx="2" fill="${attr(style.fill)}"/>`;
  return `<g data-badge="${number}">${shape}<text x="${num(at.x)}" y="${num(at.y + 4)}" text-anchor="middle" font-size="${T.badge.size}" font-weight="${T.badge.weight}" fill="${attr(style.text)}">${number}</text></g>`;
}

function renderMarker(id: string, color: string, kind: "filled" | "open"): string {
  const shape = kind === "open" ? `<path d="M1,1 L9,5 L1,9" fill="none" stroke="${attr(color)}" stroke-width="1.4" stroke-linejoin="round"/>` : `<path d="M0,0 L10,5 L0,10 z" fill="${attr(color)}"/>`;
  return `<marker id="${attr(id)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${shape}</marker>`;
}

// ---------------------------------------------------------------- page: title, workflow, legend, assumptions

function renderPageNode(node: DiagramNode, model: DiagramModel, page: Platform, pack: StylePack, taggedOverlays: NonNullable<DiagramModel["arch"]>["overlays"]): string {
  const arch = model.arch;
  if (!arch) return "";
  let block: PageBlock | null = null;
  if (node.role === "title") block = titleBlock(arch.title, arch.subtitle, Math.max(node.box.w, 480));
  else if (node.role === "workflow") block = workflowBlock(arch.sequences, Math.max(node.box.w, 320));
  else if (node.role === "assumptions") block = assumptionsBlock(arch.assumptions, Math.max(node.box.w, 320));
  else if (node.role === "legend") {
    const meanings = [...new Set(model.edges.filter((e) => !e.hidden).map(edgeMeaning))];
    block = legendBlock({ meanings, sequences: arch.sequences, taggedOverlays });
  }
  if (!block) return "";
  const { x, y } = node.box;
  const parts: string[] = [];
  for (const run of block.runs) {
    parts.push(`<text x="${num(x + run.x)}" y="${num(y + run.y)}" font-size="${run.style.size}" font-weight="${run.style.weight}" fill="${attr(run.tone === "muted" ? pack.muted : pack.text)}">${esc(run.text)}</text>`);
  }
  for (const badge of block.badges) parts.push(badgeMark({ x: x + badge.x, y: y + badge.y }, badge.number, badgeStyle(page, badge.sequenceIndex)));
  for (const swatch of block.swatches) {
    if (swatch.kind === "line") {
      const style = connectorStyle(page, swatch.meaning);
      const dash = style.dash ? ` stroke-dasharray="${attr(style.dash)}"` : "";
      parts.push(`<path d="M${num(x + swatch.x)} ${num(y + swatch.y)} H${num(x + swatch.x + swatch.w)}" stroke="${attr(style.stroke)}" stroke-width="${style.width + 0.5}"${dash} fill="none"/>`);
    } else if (swatch.kind === "badge") {
      parts.push(badgeMark({ x: x + swatch.x, y: y + swatch.y }, 1, badgeStyle(page, swatch.sequenceIndex)));
    } else {
      parts.push(`<rect x="${num(x + swatch.x)}" y="${num(y + swatch.y - 8)}" width="${Math.ceil(swatch.text.length * 7) + 10}" height="16" rx="8" fill="${attr(pack.background)}" stroke="#ED7100"/><text x="${num(x + swatch.x + 5)}" y="${num(y + swatch.y + 3.5)}" font-size="10" font-weight="700" fill="#ED7100">${esc(swatch.text)}</text>`);
    }
  }
  // The title can be selected and renamed; the other page blocks follow the diagram and aren't selectable.
  const hook = node.role === "title" ? ` data-id="${attr(node.id)}" data-kind="node"` : "";
  // A hit area, so clicking between the title's words selects it too.
  const hit = node.role === "title" ? `<rect x="${num(x)}" y="${num(y)}" width="${num(node.box.w)}" height="${num(node.box.h)}" fill="#FFFFFF" fill-opacity="0"/>` : "";
  return `<g data-page="${attr(node.role ?? "")}"${hook}>${hit}${parts.join("")}</g>`;
}

function describe(model: DiagramModel): string {
  const components = model.nodes.filter((n) => n.role === "service").length;
  const boundaries = model.nodes.filter((n) => n.role === "boundary").length;
  const connections = model.edges.filter((e) => !e.hidden).length;
  const subtitle = model.arch?.subtitle ? `${model.arch.subtitle}. ` : "";
  return `${subtitle}${components} components in ${boundaries} boundaries with ${connections} connections.`;
}

// ---------------------------------------------------------------- helpers

function midpoint(points: Point[]): Point | undefined {
  if (points.length < 2) return undefined;
  let best = 0;
  let mid = points[0];
  for (let i = 0; i + 1 < points.length; i++) {
    const len = dist(points[i], points[i + 1]);
    if (len > best) {
      best = len;
      mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    }
  }
  return mid;
}

function along(points: Point[], distance: number): Point {
  let left = distance;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = dist(points[i], points[i + 1]);
    if (left <= len && len > 0) return towards(points[i], points[i + 1], left);
    left -= len;
  }
  return points[points.length - 1];
}

function towards(from: Point, to: Point, d: number): Point {
  const len = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "") || "da";
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(text: string): string {
  return esc(text).replace(/"/g, "&quot;");
}

