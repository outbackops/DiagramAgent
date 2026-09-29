import { routeModelEdges } from "@/lib/model/route";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, LegendKind, NodeContent, NodeRole, NodeStyle, Point, Tone } from "@/lib/model/types";
import {
  bannerBlock,
  cardBlock,
  columnTitleBlock,
  laneFooterBlock,
  laneHasFooter,
  laneHeaderBlock,
  pageFooterBlock,
  pageHeaderBlock,
  stepBlock,
  type ContentContext,
  type ContentNode,
} from "./content";
import { FOOTER_ID, HEADER_ID, type NBanner, type NCard, type NColumn, type NConnector, type NFlow, type NGrid, type NItem, type NormalizedSpec, type NStep } from "./spec";
import { measureText } from "./text";
import { EDGE, PAGE, PAGE_WIDTH, SPACE, toneColors, TYPE } from "./theme";

/**
 * The composition engine: lays a normalised spec out the way a designer
 * would compose it by hand — a header band, equal-height column panels on a
 * grid, lanes with a row of steps, card grids, a footer — and draws
 * connectors by intent. Deterministic: the same spec always gives the same
 * model.
 */

export interface LayoutReport {
  width: number;
  height: number;
  aspectRatio: number;
  /** Text pieces the layout had to cut short. */
  truncated: number;
  /** Connectors drawn as used-by chips instead of lines (they would have crossed a column). */
  chipped: number;
}

export interface LayoutResult {
  model: DiagramModel;
  report: LayoutReport;
}

export interface LayoutOptions {
  /** Keep this page width unless another is clearly better, so edits don't reflow the whole page. */
  preferWidth?: number;
}

const PAGE_WIDTHS = [960, 1120, 1280, 1440, 1600, 1760, 1920, 2080, 2240, 2400];
/** Score advantage of the preferred width. */
const KEEP_WIDTH_BONUS = 0.35;
const ASPECT_LOW = 1.45;
const ASPECT_HIGH = 1.85;
const SIZE_WEIGHT = { narrow: 1, normal: 1.75, wide: 2.6 } as const;
const NARROW_MIN = 240;
/** Cards grow by at most this share of their natural height when a column has spare room. */
const STRETCH_SHARE = 0.25;
const STRETCH_MAX = 48;
const GRID_CELL_MIN = 180;
const VERTICAL_LANE_MIN = 220;

export function layoutSpec(spec: NormalizedSpec, options: LayoutOptions = {}): LayoutResult {
  const ctx: ContentContext = { flowTones: flowTonesOf(spec) };
  const minimum = minimumPageWidth(spec);
  const tightest = Math.max(PAGE_WIDTHS[0], Math.ceil(minimum / 40) * 40);
  const preferred = options.preferWidth && options.preferWidth >= minimum && options.preferWidth <= 4000 ? Math.round(options.preferWidth) : undefined;
  const widths = [...new Set([...PAGE_WIDTHS.filter((w) => w >= minimum), tightest, ...(preferred ? [preferred] : [])])].sort((a, b) => a - b);

  let best: { placed: Placed; score: number } | null = null;
  for (const width of widths) {
    const placed = place(spec, width, ctx);
    const aspect = placed.width / placed.height;
    const outside = aspect < ASPECT_LOW ? ASPECT_LOW / aspect - 1 : aspect > ASPECT_HIGH ? aspect / ASPECT_HIGH - 1 : 0;
    const score = outside * 10 + placed.truncated * 2 + Math.abs(width - PAGE_WIDTH) / PAGE_WIDTH - (width === preferred ? KEEP_WIDTH_BONUS : 0);
    if (!best || score < best.score - 1e-9) best = { placed, score };
  }
  const placed = best!.placed;
  const model = routeModelEdges({ version: 1, composed: true, nodes: placed.nodes, edges: placed.edges });
  return {
    model,
    report: {
      width: placed.width,
      height: placed.height,
      aspectRatio: Number((placed.width / placed.height).toFixed(2)),
      truncated: placed.truncated,
      chipped: placed.chipped,
    },
  };
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

function flowTonesOf(spec: NormalizedSpec): Record<string, Tone> {
  const tones: Record<string, Tone> = {};
  for (const column of spec.columns) {
    for (const item of column.items) if (item.type === "flow") tones[item.label] = item.tone;
  }
  return tones;
}

function iconUrl(key: string | undefined): string | undefined {
  return key ? `/icons/${key}.svg` : undefined;
}

const cardContent = (card: NCard): ContentNode => ({
  label: card.title,
  tone: card.tone,
  icon: iconUrl(card.icon),
  content: compact({ lines: card.lines, notes: card.note ? [card.note] : undefined, usedBy: card.usedBy }),
});

const stepContent = (step: NStep): ContentNode => ({ label: step.title, tone: step.tone, icon: iconUrl(step.icon), content: compact({ lines: step.lines }) });

const bannerContent = (banner: NBanner): ContentNode => ({ label: banner.title, tone: banner.tone, content: compact({ subtitle: banner.text }) });

function laneContent(flow: NFlow, vertical: boolean): ContentNode {
  return {
    label: flow.title,
    tone: flow.tone,
    content: compact({
      badge: flow.label,
      subtitle: flow.subtitle,
      tag: flow.tag,
      notes: flow.notes,
      chips: flow.chips?.items,
      chipsLabel: flow.chips?.label,
      vertical: vertical || undefined,
    }),
  };
}

/** Drops undefined, empty strings and empty arrays so saved models stay small. */
function compact(content: NodeContent): NodeContent | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(content)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? (out as NodeContent) : undefined;
}

function flowRowWidth(steps: number): number {
  return 2 * SPACE.lanePadX + steps * SPACE.stepMinWidth + Math.max(0, steps - 1) * SPACE.stepGap;
}

function minColumnWidth(column: NColumn): number {
  let min = NARROW_MIN;
  for (const item of column.items) {
    if (item.type === "grid") {
      const cols = Math.min(item.columns, item.items.length);
      min = Math.max(min, 2 * SPACE.panelPadX + cols * GRID_CELL_MIN + (cols - 1) * SPACE.gridGap);
    } else if (item.type === "flow") {
      const lane = column.size === "wide" ? flowRowWidth(item.steps.length) : VERTICAL_LANE_MIN;
      min = Math.max(min, 2 * SPACE.panelPadX + lane);
    }
  }
  return min;
}

function minimumPageWidth(spec: NormalizedSpec): number {
  const n = spec.columns.length;
  return spec.columns.reduce((sum, c) => sum + minColumnWidth(c), 0) + 2 * SPACE.margin + Math.max(0, n - 1) * SPACE.gutter;
}

/** Splits `total` by weight while honouring each minimum. */
function distributeWidths(total: number, weights: number[], mins: number[]): number[] {
  const widths = new Array<number>(weights.length).fill(0);
  const fixed = new Set<number>();
  for (let pass = 0; pass <= weights.length; pass++) {
    const free = weights.map((_, i) => i).filter((i) => !fixed.has(i));
    const remaining = total - [...fixed].reduce((sum, i) => sum + widths[i], 0);
    const weightSum = free.reduce((sum, i) => sum + weights[i], 0) || 1;
    let clamped = false;
    for (const i of free) {
      widths[i] = (remaining * weights[i]) / weightSum;
      if (widths[i] < mins[i]) {
        widths[i] = mins[i];
        fixed.add(i);
        clamped = true;
      }
    }
    if (!clamped) break;
  }
  // Integer widths that still add up to the total.
  const rounded = widths.map(Math.floor);
  let rest = Math.round(total - rounded.reduce((a, b) => a + b, 0));
  for (let i = 0; rest > 0 && i < rounded.length; i++, rest--) rounded[i]++;
  return rounded;
}

// ---------------------------------------------------------------------------
// Per-item measurements
// ---------------------------------------------------------------------------

interface GridRow {
  cards: NCard[];
  cellW: number;
  h: number;
}

interface FlowMeasure {
  vertical: boolean;
  headerH: number;
  footerH: number;
  hasFooter: boolean;
  stepW: number;
  stepHs: number[];
  stepsH: number;
  band: number;
}

interface Measured {
  item: NItem;
  natural: number;
  h: number;
  top: number;
  grid?: GridRow[];
  flow?: FlowMeasure;
}

function measureItem(item: NItem, innerW: number, ctx: ContentContext, bandUse: Map<string, number>, columnId: string): { measured: Measured; truncated: number } {
  switch (item.type) {
    case "card": {
      const block = cardBlock(cardContent(item), innerW, undefined, ctx);
      return { measured: { item, natural: block.height, h: block.height, top: 0 }, truncated: block.truncated };
    }
    case "banner": {
      const block = bannerBlock(bannerContent(item), innerW);
      return { measured: { item, natural: block.height, h: block.height, top: 0 }, truncated: block.truncated };
    }
    case "grid":
      return measureGrid(item, innerW, ctx);
    case "flow":
      return measureFlow(item, innerW, bandUse.get(`${columnId}.${item.id}`) ?? 0);
  }
}

function gridRows(grid: NGrid, innerW: number): { cards: NCard[]; cellW: number }[] {
  const cols = Math.max(1, Math.min(grid.columns, grid.items.length));
  const rows: { cards: NCard[]; cellW: number }[] = [];
  for (let i = 0; i < grid.items.length; i += cols) {
    const cards = grid.items.slice(i, i + cols);
    rows.push({ cards, cellW: (innerW - (cards.length - 1) * SPACE.gridGap) / cards.length });
  }
  return rows;
}

function measureGrid(grid: NGrid, innerW: number, ctx: ContentContext): { measured: Measured; truncated: number } {
  let truncated = 0;
  const rows = gridRows(grid, innerW).map((row) => {
    const heights = row.cards.map((card) => {
      const block = cardBlock(cardContent(card), row.cellW, undefined, ctx);
      truncated += block.truncated;
      return block.height;
    });
    return { ...row, h: Math.max(...heights) };
  });
  const h = rows.reduce((sum, r) => sum + r.h, 0) + Math.max(0, rows.length - 1) * SPACE.gridGap;
  return { measured: { item: grid, natural: h, h, top: 0, grid: rows }, truncated };
}

function measureFlow(flow: NFlow, innerW: number, band: number): { measured: Measured; truncated: number } {
  const avail = innerW - 2 * SPACE.lanePadX;
  const k = flow.steps.length;
  const rowStepW = (avail - (k - 1) * SPACE.stepGap) / k;
  const vertical = rowStepW < SPACE.stepMinWidth;
  const content = laneContent(flow, vertical);
  const header = laneHeaderBlock(content, innerW);
  const footer = laneFooterBlock(content, innerW);
  let truncated = header.truncated + footer.truncated;

  const stepW = vertical ? avail : rowStepW;
  const naturals = flow.steps.map((step) => {
    const block = stepBlock(stepContent(step), stepW);
    truncated += block.truncated;
    return block.height;
  });
  const stepHs = vertical ? naturals : naturals.map(() => Math.max(...naturals));
  const stepsH = vertical ? naturals.reduce((a, b) => a + b, 0) + (k - 1) * SPACE.stepGapVertical : stepHs[0] ?? 0;
  const bandH = !vertical && band > 0 ? SPACE.callBand + (band - 1) * SPACE.callTrackGap : 0;
  const hasFooter = laneHasFooter(content);
  const h = header.height + stepsH + bandH + (hasFooter ? SPACE.laneFootGap : 0) + footer.height;
  return {
    measured: {
      item: flow,
      natural: h,
      h,
      top: 0,
      flow: { vertical, headerH: header.height, footerH: footer.height, hasFooter, stepW, stepHs, stepsH, band: bandH ? band : 0 },
    },
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface ColumnPlan {
  column: NColumn;
  x: number;
  w: number;
  items: Measured[];
  /** Gap below each item but the last. */
  gaps: number[];
  contentH: number;
}

interface Placed {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
  truncated: number;
  chipped: number;
}

/** Where each lane step sits, for routing. */
interface StepSlot {
  laneId: string;
  index: number;
  count: number;
  vertical: boolean;
}

function place(spec: NormalizedSpec, pageW: number, ctx: ContentContext): Placed {
  const n = spec.columns.length;
  const innerTotal = pageW - 2 * SPACE.margin - Math.max(0, n - 1) * SPACE.gutter;
  const widths = distributeWidths(
    innerTotal,
    spec.columns.map((c) => SIZE_WEIGHT[c.size]),
    spec.columns.map(minColumnWidth),
  );
  const index = indexSpec(spec);
  const { chips, lines } = planConnectors(spec, index);
  const bandUse = bandUsage(lines, index);
  let truncated = 0;

  // 1. Natural sizes, top-packed.
  let x = SPACE.margin;
  const plans: ColumnPlan[] = spec.columns.map((column, i) => {
    const w = widths[i];
    const innerW = w - 2 * SPACE.panelPadX;
    const items = column.items.map((item) => {
      const result = measureItem(withChips(item, column.id, chips), innerW, ctx, bandUse, column.id);
      truncated += result.truncated;
      return result.measured;
    });
    const gaps = column.items.slice(1).map((item, j) => (linkedItems(lines, `${column.id}.${column.items[j].id}`, `${column.id}.${item.id}`) ? SPACE.linkedGap : SPACE.itemGap));
    const contentH = items.reduce((sum, m) => sum + m.h, 0) + gaps.reduce((a, b) => a + b, 0);
    const plan = { column, x, w, items, gaps, contentH };
    x += w + SPACE.gutter;
    return plan;
  });

  const panelTop = SPACE.headerHeight + SPACE.headerGap;
  const bodyTop = panelTop + SPACE.panelHead;
  const bodyH = Math.max(120, ...plans.map((p) => p.contentH));

  // 2. Equal-height columns: widen gaps, then stretch cards, then align with connector partners.
  for (const plan of plans) stackItems(plan, bodyTop);
  const anchors = anchorCentres(plans, lines);
  for (const plan of plans) equalise(plan, bodyTop, bodyH, anchors);

  // 3. Nodes.
  const nodes: DiagramNode[] = [];
  const slots = new Map<string, StepSlot>();
  const headerBlock = pageHeaderBlock(headerContent(spec), pageW);
  truncated += headerBlock.truncated;
  nodes.push(makeNode(HEADER_ID, null, "header", spec.title, { x: 0, y: 0, w: pageW, h: SPACE.headerHeight }, undefined, headerContent(spec).content));

  const panelH = SPACE.panelHead + bodyH + SPACE.panelPadBottom;
  const legendColumn = linesLegendColumn(plans, lines);
  plans.forEach((plan, i) => {
    const legend: LegendKind[] = [];
    if (i === legendColumn) legend.push("lines");
    if (plan.column.items.some((item) => hasUsedBy(withChips(item, plan.column.id, chips)))) legend.push("usedBy");
    const content = compact({ badge: String(i + 1), size: plan.column.size, legend });
    const titleBlock = columnTitleBlock({ label: plan.column.title, content }, plan.w, ctx);
    truncated += titleBlock.truncated;
    nodes.push(makeNode(plan.column.id, null, "column", plan.column.title, { x: plan.x, y: panelTop, w: plan.w, h: panelH }, undefined, content, true));
    for (const measured of plan.items) emitItem(nodes, slots, plan, measured, withChips(measured.item, plan.column.id, chips));
  });

  let bottom = panelTop + panelH;
  if (spec.footer) {
    const content = footerContent(spec);
    const w = pageW - 2 * SPACE.margin;
    const block = pageFooterBlock(content, w);
    truncated += block.truncated;
    const y = bottom + SPACE.footerGap;
    nodes.push(makeNode(FOOTER_ID, null, "footer", content.label, { x: SPACE.margin, y, w, h: block.height }, undefined, content.content));
    bottom = y + block.height;
  }

  // 4. Connectors.
  const edges = [...stepEdges(spec, nodes), ...routeConnectors(lines, nodes, slots, plans, panelTop, index)];
  return { nodes, edges, width: pageW, height: bottom + SPACE.margin, truncated, chipped: chips.size };
}

function headerContent(spec: NormalizedSpec): ContentNode {
  return { label: spec.title, content: compact({ subtitle: spec.subtitle, badge: spec.badge?.title, badgeDetail: spec.badge?.detail }) };
}

function footerContent(spec: NormalizedSpec): ContentNode {
  const footer = spec.footer!;
  return { label: footer.title || "Outcome", content: compact({ subtitle: footer.text, tag: footer.status, badgeDetail: footer.statusDetail }) };
}

function hasUsedBy(item: NItem): boolean {
  if (item.type === "card") return item.usedBy.length > 0;
  if (item.type === "grid") return item.items.some((c) => c.usedBy.length > 0);
  return false;
}

function stackItems(plan: ColumnPlan, top: number): void {
  let y = top;
  plan.items.forEach((m, i) => {
    m.top = y;
    y += m.h + (plan.gaps[i] ?? 0);
  });
}

/** Whether a connector joins these two items (or anything inside them). */
function linkedItems(lines: NConnector[], a: string, b: string): boolean {
  const inside = (id: string, item: string) => id === item || id.startsWith(`${item}.`);
  return lines.some((l) => (inside(l.from, a) && inside(l.to, b)) || (inside(l.from, b) && inside(l.to, a)));
}

function equalise(plan: ColumnPlan, top: number, bodyH: number, anchors: Map<string, number>): void {
  const items = plan.items;
  if (items.length === 0) return;
  let extra = bodyH - plan.contentH;
  if (extra <= 0.5) return;

  // Wider gaps first…
  const gaps = [...plan.gaps];
  if (gaps.length) {
    const grow = Math.min(extra / gaps.length, SPACE.maxItemGap - SPACE.itemGap);
    for (let i = 0; i < gaps.length; i++) gaps[i] += grow;
    extra -= grow * gaps.length;
  }
  // …then slightly taller cards (grids share it across their rows).
  const stretchable = items.filter((m) => m.item.type === "card" || m.item.type === "grid");
  if (stretchable.length && extra > 0.5) {
    const each = extra / stretchable.length;
    for (const m of stretchable) {
      const add = Math.min(each, Math.max(0, Math.min(m.natural * STRETCH_SHARE, STRETCH_MAX)));
      if (m.grid) {
        const perRow = add / m.grid.length;
        for (const row of m.grid) row.h += perRow;
      }
      m.h += add;
      extra -= add;
    }
  }

  // Top-pack with the new gaps, then slide items down towards the partners of their connectors.
  let y = top;
  items.forEach((m, i) => {
    m.top = y;
    y += m.h + (gaps[i] ?? 0);
  });
  if (extra <= 0.5) return;
  const bottom = top + bodyH;
  let floor = top;
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    const below = items.slice(i + 1).reduce((sum, next, j) => sum + next.h + gaps[i + j], 0);
    const maxTop = bottom - below - m.h;
    let wanted = Math.max(m.top, floor);
    const anchor = anchors.get(`${plan.column.id}.${m.item.id}`);
    if (anchor !== undefined) wanted = Math.max(wanted, Math.min(anchor - m.h / 2, maxTop));
    m.top = Math.min(wanted, maxTop);
    floor = m.top + m.h + (gaps[i] ?? 0);
  }
}

/** For items of shorter columns, the y their connector partner sits at (so lines can run level). */
function anchorCentres(plans: ColumnPlan[], lines: NConnector[]): Map<string, number> {
  const tallest = plans.reduce((best, p) => (p.contentH > best.contentH ? p : best), plans[0]);
  const centres = new Map<string, number>();
  if (!tallest) return centres;
  const itemCentre = new Map<string, number>();
  for (const m of tallest.items) {
    const id = `${tallest.column.id}.${m.item.id}`;
    if (m.flow) {
      const stepsTop = m.top + m.flow.headerH;
      itemCentre.set(id, stepsTop + (m.flow.vertical ? m.flow.stepHs[0] / 2 : m.flow.stepsH / 2));
      (m.item as NFlow).steps.forEach((step, i) => {
        const offset = m.flow!.vertical ? m.flow!.stepHs.slice(0, i).reduce((a, b) => a + b + SPACE.stepGapVertical, 0) + m.flow!.stepHs[i] / 2 : m.flow!.stepsH / 2;
        itemCentre.set(`${id}.${step.id}`, stepsTop + offset);
      });
    } else {
      itemCentre.set(id, m.top + m.h / 2);
    }
  }
  for (const line of lines) {
    for (const [mine, theirs] of [
      [line.from, line.to],
      [line.to, line.from],
    ]) {
      const centre = itemCentre.get(theirs);
      if (centre === undefined) continue;
      const owner = itemIdOf(mine);
      if (!centres.has(owner)) centres.set(owner, centre);
    }
  }
  return centres;
}

/** `col.item` for any node id inside a column item. */
function itemIdOf(id: string): string {
  return id.split(".").slice(0, 2).join(".");
}

function emitItem(nodes: DiagramNode[], slots: Map<string, StepSlot>, plan: ColumnPlan, m: Measured, item: NItem): void {
  const x = plan.x + SPACE.panelPadX;
  const w = plan.w - 2 * SPACE.panelPadX;
  const id = `${plan.column.id}.${item.id}`;
  const box = { x, y: m.top, w, h: m.h };
  switch (item.type) {
    case "card": {
      const c = cardContent(item);
      nodes.push(makeNode(id, plan.column.id, "card", c.label, box, item.tone, c.content, false, c.icon));
      return;
    }
    case "banner": {
      const c = bannerContent(item);
      nodes.push(makeNode(id, plan.column.id, "banner", c.label, box, item.tone, c.content));
      return;
    }
    case "grid": {
      nodes.push(makeNode(id, plan.column.id, "grid", "", box, undefined, compact({ columns: item.columns }), true));
      let y = m.top;
      for (const row of m.grid!) {
        let cx = x;
        for (const card of row.cards) {
          const c = cardContent(card);
          nodes.push(makeNode(`${id}.${card.id}`, id, "card", c.label, { x: cx, y, w: row.cellW, h: row.h }, card.tone, c.content, false, c.icon));
          cx += row.cellW + SPACE.gridGap;
        }
        y += row.h + SPACE.gridGap;
      }
      return;
    }
    case "flow": {
      const f = m.flow!;
      const content = laneContent(item, f.vertical);
      nodes.push(makeNode(id, plan.column.id, "lane", content.label, box, item.tone, content.content, true));
      const stepsTop = m.top + f.headerH;
      let y = stepsTop;
      item.steps.forEach((step, i) => {
        const c = stepContent(step);
        const stepBox = f.vertical
          ? { x: x + SPACE.lanePadX, y, w: f.stepW, h: f.stepHs[i] }
          : { x: x + SPACE.lanePadX + i * (f.stepW + SPACE.stepGap), y: stepsTop, w: f.stepW, h: f.stepHs[i] };
        if (f.vertical) y += f.stepHs[i] + SPACE.stepGapVertical;
        const stepId = `${id}.${step.id}`;
        nodes.push(makeNode(stepId, id, "step", c.label, stepBox, step.tone, c.content, false, c.icon));
        slots.set(stepId, { laneId: id, index: i, count: item.steps.length, vertical: f.vertical });
      });
      return;
    }
  }
}

function makeNode(
  id: string,
  parent: string | null,
  role: NodeRole,
  label: string,
  box: Box,
  tone?: Tone,
  content?: NodeContent,
  container = false,
  icon?: string,
): DiagramNode {
  const node: DiagramNode = { id, parent, label, shape: "rectangle", box: roundBox(box), style: styleFor(role, tone), container, role };
  if (tone) node.tone = tone;
  if (content) node.content = content;
  if (icon) node.icon = icon;
  return node;
}

/** Plain styles so exporters that don't know the composed theme still get its colours. */
function styleFor(role: NodeRole, tone: Tone | undefined): NodeStyle {
  const t = toneColors(tone);
  switch (role) {
    case "header":
      return { fill: PAGE.headerTo, stroke: PAGE.headerTo, fontColor: PAGE.headerText, fontSize: TYPE.pageTitle.size, bold: true };
    case "footer":
      return { fill: PAGE.footerFill, stroke: PAGE.footerFill, fontColor: PAGE.footerTitle, borderRadius: SPACE.footerRadius, bold: true };
    case "column":
      return { fill: PAGE.panelFill, stroke: PAGE.panelStroke, strokeWidth: 1.5, borderRadius: SPACE.panelRadius, shadow: true, fontColor: PAGE.ink, bold: true };
    case "grid":
      return { strokeWidth: 0, opacity: 0 };
    case "lane":
      return { fill: t.lane, stroke: t.laneStroke, strokeWidth: 1.5, borderRadius: SPACE.laneRadius, fontColor: PAGE.ink, bold: true };
    case "banner":
      return { fill: t.fill, stroke: t.main, strokeWidth: 1.5, borderRadius: SPACE.bannerRadius, fontColor: PAGE.ink, bold: true };
    case "step":
      return { fill: t.fill, stroke: t.main, strokeWidth: 2, borderRadius: SPACE.stepRadius, fontColor: PAGE.ink, fontSize: TYPE.stepTitle.size, bold: true };
    default:
      return { fill: t.fill, stroke: t.main, strokeWidth: 2, borderRadius: SPACE.cardRadius, fontColor: PAGE.ink, fontSize: TYPE.cardTitle.size, bold: true };
  }
}

function roundBox(box: Box): Box {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  return { x, y, w: Math.round(box.x + box.w) - x, h: Math.round(box.y + box.h) - y };
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

interface StepInfo {
  lane: string;
  index: number;
  count: number;
}

interface SpecIndex {
  /** Column index of every item, step and grid card (by model id). */
  columnOf: Map<string, number>;
  /** Lane steps in order (by lane model id). */
  laneSteps: Map<string, string[]>;
  steps: Map<string, StepInfo>;
  laneLetter: Map<string, string>;
  cards: Set<string>;
}

function indexSpec(spec: NormalizedSpec): SpecIndex {
  const index: SpecIndex = { columnOf: new Map(), laneSteps: new Map(), steps: new Map(), laneLetter: new Map(), cards: new Set() };
  spec.columns.forEach((column, i) => {
    for (const item of column.items) {
      const id = `${column.id}.${item.id}`;
      index.columnOf.set(id, i);
      if (item.type === "card") index.cards.add(id);
      if (item.type === "grid") {
        for (const card of item.items) {
          index.columnOf.set(`${id}.${card.id}`, i);
          index.cards.add(`${id}.${card.id}`);
        }
      }
      if (item.type === "flow") {
        index.laneLetter.set(id, item.label);
        const ids = item.steps.map((step) => `${id}.${step.id}`);
        index.laneSteps.set(id, ids);
        ids.forEach((stepId, s) => {
          index.columnOf.set(stepId, i);
          index.laneLetter.set(stepId, item.label);
          index.steps.set(stepId, { lane: id, index: s, count: ids.length });
        });
      }
    }
  });
  return index;
}

/** A connector to a whole lane attaches to the step facing the other end. */
function resolveEnd(id: string, facesRight: boolean, index: SpecIndex): string {
  const steps = index.laneSteps.get(id);
  if (!steps || steps.length === 0) return id;
  return facesRight ? steps[steps.length - 1] : steps[0];
}

/** A step in a row can only leave through its side when no other step is in the way. */
function blockedStep(info: StepInfo | undefined, facesRight: boolean): boolean {
  if (!info) return false;
  return facesRight ? info.index !== info.count - 1 : info.index !== 0;
}

/**
 * Connectors from a flow to a card more than one column away would cross the
 * column between them. Like a designer, show them as used-by chips instead.
 */
function planConnectors(spec: NormalizedSpec, index: SpecIndex): { chips: Map<string, string[]>; lines: NConnector[] } {
  const chips = new Map<string, string[]>();
  const lines: NConnector[] = [];
  for (const connector of spec.connectors) {
    const a = index.columnOf.get(connector.from);
    const b = index.columnOf.get(connector.to);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > 1) {
      const pair = (
        [
          [connector.from, connector.to],
          [connector.to, connector.from],
        ] as const
      ).find(([lane, card]) => index.laneLetter.has(lane) && index.cards.has(card));
      if (pair) {
        const letters = chips.get(pair[1]) ?? [];
        const letter = index.laneLetter.get(pair[0])!;
        if (!letters.includes(letter)) letters.push(letter);
        chips.set(pair[1], letters);
        continue;
      }
    }
    lines.push(connector);
  }
  return { chips, lines };
}

function withChips(item: NItem, columnId: string, chips: Map<string, string[]>): NItem {
  if (chips.size === 0) return item;
  const addTo = (card: NCard, id: string): NCard => {
    const extra = chips.get(id);
    if (!extra) return card;
    return { ...card, usedBy: [...card.usedBy, ...extra.filter((l) => !card.usedBy.includes(l))].sort() };
  };
  const id = `${columnId}.${item.id}`;
  if (item.type === "card") return addTo(item, id);
  if (item.type === "grid") return { ...item, items: item.items.map((card) => addTo(card, `${id}.${card.id}`)) };
  return item;
}

/** How many connector ends each lane routes through the call band under its steps. */
function bandUsage(lines: NConnector[], index: SpecIndex): Map<string, number> {
  const use = new Map<string, number>();
  for (const line of lines) {
    const a = index.columnOf.get(line.from);
    const b = index.columnOf.get(line.to);
    if (a === undefined || b === undefined || a === b || Math.abs(a - b) > 1) continue;
    for (const [end, facesRight] of [
      [line.from, b > a],
      [line.to, a > b],
    ] as const) {
      const info = index.steps.get(resolveEnd(end, facesRight, index));
      if (info && blockedStep(info, facesRight)) use.set(info.lane, (use.get(info.lane) ?? 0) + 1);
    }
  }
  return use;
}

function linesLegendColumn(plans: ColumnPlan[], lines: NConnector[]): number {
  if (!lines.some((l) => l.kind === "call")) return -1;
  let best = -1;
  let bestLanes = -1;
  plans.forEach((plan, i) => {
    const lanes = plan.column.items.filter((item) => item.type === "flow").length;
    if (lanes > bestLanes || (lanes === bestLanes && best >= 0 && plan.w > plans[best].w)) {
      best = i;
      bestLanes = lanes;
    }
  });
  return best;
}

function stepEdges(spec: NormalizedSpec, nodes: DiagramNode[]): DiagramEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: DiagramEdge[] = [];
  for (const column of spec.columns) {
    for (const item of column.items) {
      if (item.type !== "flow") continue;
      const vertical = Boolean(byId.get(`${column.id}.${item.id}`)?.content?.vertical);
      for (let i = 0; i + 1 < item.steps.length; i++) {
        const a = byId.get(`${column.id}.${item.id}.${item.steps[i].id}`);
        const b = byId.get(`${column.id}.${item.id}.${item.steps[i + 1].id}`);
        if (!a || !b) continue;
        const route = vertical
          ? [
              { x: a.box.x + a.box.w / 2, y: a.box.y + a.box.h },
              { x: b.box.x + b.box.w / 2, y: b.box.y },
            ]
          : [
              { x: a.box.x + a.box.w, y: a.box.y + a.box.h / 2 },
              { x: b.box.x, y: b.box.y + b.box.h / 2 },
            ];
        edges.push(makeEdge(a.id, b.id, "step", item.tone, route, edges));
      }
    }
  }
  return edges;
}

function makeEdge(from: string, to: string, kind: "flow" | "call" | "step", tone: Tone | undefined, route: Point[], existing: DiagramEdge[], label?: string): DiagramEdge {
  const n = existing.filter((e) => e.from === from && e.to === to).length;
  const width = kind === "call" ? EDGE.callWidth : kind === "step" ? EDGE.stepWidth : EDGE.flowWidth;
  const edge: DiagramEdge = {
    id: `(${from} -> ${to})[${n}]`,
    from,
    to,
    srcArrow: "none",
    dstArrow: "triangle",
    style: { stroke: toneColors(tone).main, strokeWidth: width, strokeDash: kind === "call" ? 6 : 0 },
    route: route.map((p) => ({ x: round1(p.x), y: round1(p.y) })),
    kind,
  };
  if (tone) edge.tone = tone;
  if (label) {
    edge.label = label;
    edge.labelSize = { w: Math.ceil(measureText(label, TYPE.edgeLabel)) + 8, h: 16 };
  }
  return edge;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

type Side = "left" | "right";

interface PlannedLine {
  line: NConnector;
  from: DiagramNode;
  to: DiagramNode;
  a: number;
  b: number;
  fromBand: boolean;
  toBand: boolean;
  /** Grid cells whose facing side is behind another cell leave or enter through the gap below them. */
  fromGap: boolean;
  toGap: boolean;
}

function routeConnectors(lines: NConnector[], nodes: DiagramNode[], slots: Map<string, StepSlot>, plans: ColumnPlan[], panelTop: number, index: SpecIndex): DiagramEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sideCount = new Map<string, number>();
  const sideUse = new Map<string, number>();
  const bandTrack = new Map<string, number>();
  const gutterCount = new Map<number, number>();
  const gutterUse = new Map<number, number>();
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  // Pass 1: resolve ends and count how many lines share each side and gutter, so ports and tracks spread evenly.
  const planned: PlannedLine[] = [];
  for (const line of lines) {
    const a = index.columnOf.get(line.from);
    const b = index.columnOf.get(line.to);
    if (a === undefined || b === undefined) continue;
    const from = byId.get(resolveEnd(line.from, b > a, index));
    const to = byId.get(resolveEnd(line.to, a > b, index));
    if (!from || !to || from.id === to.id) continue;
    const inRow = (node: DiagramNode, facesRight: boolean) => {
      const slot = slots.get(node.id);
      return Boolean(slot && !slot.vertical && blockedStep(index.steps.get(node.id), facesRight));
    };
    const behindCell = (node: DiagramNode, facesRight: boolean) => {
      if (!node.parent || byId.get(node.parent)?.role !== "grid") return false;
      const b = node.box;
      return nodes.some((s) => s.parent === node.parent && s.id !== node.id && s.box.y < b.y + b.h && b.y < s.box.y + s.box.h && (facesRight ? s.box.x > b.x : s.box.x < b.x));
    };
    const cross = a !== b;
    const plan: PlannedLine = {
      line,
      from,
      to,
      a,
      b,
      fromBand: cross && inRow(from, b > a),
      toBand: cross && inRow(to, a > b),
      fromGap: cross && behindCell(from, b > a),
      toGap: cross && behindCell(to, a > b),
    };
    planned.push(plan);
    if (a === b) continue;
    const sa: Side = b > a ? "right" : "left";
    const sb: Side = b > a ? "left" : "right";
    if (!plan.fromBand && !plan.fromGap) bump(sideCount, `${from.id}|${sa}`);
    if (!plan.toBand && !plan.toGap) bump(sideCount, `${to.id}|${sb}`);
    if (Math.abs(a - b) === 1) gutterCount.set(Math.min(a, b), (gutterCount.get(Math.min(a, b)) ?? 0) + 1);
  }

  const port = (node: DiagramNode, side: Side): Point => {
    const key = `${node.id}|${side}`;
    const count = sideCount.get(key) ?? 1;
    const i = sideUse.get(key) ?? 0;
    sideUse.set(key, i + 1);
    const box = node.box;
    const span = Math.min(box.h * 0.6, 24 * (count - 1));
    const y = count <= 1 ? box.y + box.h / 2 : box.y + box.h / 2 - span / 2 + (span * i) / (count - 1);
    return { x: side === "right" ? box.x + box.w : box.x, y };
  };

  /** Down from a step into its lane's call band, then along the band towards `side`. */
  const band = (node: DiagramNode): { points: Point[]; trackY: number; lane: DiagramNode } => {
    const slot = slots.get(node.id)!;
    const lane = byId.get(slot.laneId)!;
    const i = bandTrack.get(lane.id) ?? 0;
    bandTrack.set(lane.id, i + 1);
    const box = node.box;
    const trackY = box.y + box.h + SPACE.callBand - 8 + i * SPACE.callTrackGap;
    const cx = box.x + box.w / 2;
    return { points: [{ x: cx, y: box.y + box.h }, { x: cx, y: trackY }], trackY, lane };
  };

  const gutterX = (a: number, b: number): number => {
    const g = Math.min(a, b);
    const count = gutterCount.get(g) ?? 1;
    const i = gutterUse.get(g) ?? 0;
    gutterUse.set(g, i + 1);
    return plans[g].x + plans[g].w + SPACE.gutter / 2 + (i - (count - 1) / 2) * EDGE.trackGap;
  };

  const edges: DiagramEdge[] = [];
  for (const { line, from, to, a, b, fromBand, toBand, fromGap, toGap } of planned) {
    const tone = line.tone ?? (line.kind === "call" ? to.tone : from.tone) ?? from.tone;
    if (a === b) {
      edges.push(sameColumnEdge(line, from, to, plans[a], tone, edges));
      continue;
    }
    const sa: Side = b > a ? "right" : "left";
    const sb: Side = b > a ? "left" : "right";

    if (Math.abs(a - b) > 1) {
      // Across a column: up the gutter, over the panels through the header gap, and down.
      const s = port(from, sa);
      const e = port(to, sb);
      const topY = panelTop - SPACE.headerGap / 2;
      const gx1 = sa === "right" ? plans[a].x + plans[a].w + SPACE.gutter / 2 : plans[a].x - SPACE.gutter / 2;
      const gx2 = sb === "left" ? plans[b].x - SPACE.gutter / 2 : plans[b].x + plans[b].w + SPACE.gutter / 2;
      const route = [s, { x: gx1, y: s.y }, { x: gx1, y: topY }, { x: gx2, y: topY }, { x: gx2, y: e.y }, e];
      edges.push(withLabelAt(makeEdge(from.id, to.id, line.kind, tone, route, edges, line.label), { x: (gx1 + gx2) / 2, y: topY - 8 }));
      continue;
    }

    if (line.kind === "flow" && !fromBand && !toBand && !fromGap && !toGap) {
      const s = port(from, sa);
      const e = port(to, sb);
      const edge = makeEdge(from.id, to.id, "flow", tone, [s, e], edges, line.label);
      edge.curve = true;
      edges.push(withLabelAt(edge, { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 - 10 }));
      continue;
    }

    // Orthogonal: out of the source (through its lane's call band when other steps
    // are in the way), along the gutter between the columns, and into the target.
    const points: Point[] = [];
    let labelAt: Point | undefined;
    let startY: number;
    const gapBelow = (node: DiagramNode) => node.box.y + node.box.h + SPACE.gridGap / 2;
    if (fromBand) {
      const out = band(from);
      points.push(...out.points);
      startY = out.trackY;
      const edgeX = sa === "right" ? out.lane.box.x + out.lane.box.w : out.lane.box.x;
      labelAt = { x: (out.points[0].x + edgeX) / 2, y: out.trackY - 10 };
    } else if (fromGap) {
      const cx = from.box.x + from.box.w / 2;
      startY = gapBelow(from);
      points.push({ x: cx, y: from.box.y + from.box.h }, { x: cx, y: startY });
    } else {
      const s = port(from, sa);
      points.push(s);
      startY = s.y;
    }
    let tail: Point[];
    let endY: number;
    if (toBand) {
      const into = band(to);
      tail = [...into.points].reverse();
      endY = into.trackY;
    } else if (toGap) {
      const cx = to.box.x + to.box.w / 2;
      endY = gapBelow(to);
      tail = [
        { x: cx, y: endY },
        { x: cx, y: to.box.y + to.box.h },
      ];
    } else {
      const e = port(to, sb);
      tail = [e];
      endY = e.y;
    }
    const target = to.box;
    if (!toBand && !toGap && startY >= target.y + 10 && startY <= target.y + target.h - 10) {
      // The target spans the source's level: one straight run, no elbow.
      points.push({ x: tail[0].x, y: startY });
    } else {
      const gx = gutterX(a, b);
      points.push({ x: gx, y: startY }, { x: gx, y: endY }, ...tail);
    }
    const edge = makeEdge(from.id, to.id, line.kind, tone, simplify(points), edges, line.label);
    edges.push(withLabelAt(edge, labelAt ?? labelOnLongest(edge.route)));
  }
  return edges;
}

function withLabelAt(edge: DiagramEdge, at: Point): DiagramEdge {
  if (edge.label) edge.labelAt = { x: round1(at.x), y: round1(at.y) };
  return edge;
}

/**
 * Two items of one column: a short straight arrow between neighbours (label
 * beside it), or a bracket down the panel's right margin around the items in
 * between. Anything nested deeper is left to the obstacle router.
 */
function sameColumnEdge(line: NConnector, from: DiagramNode, to: DiagramNode, plan: ColumnPlan, tone: Tone | undefined, edges: DiagramEdge[]): DiagramEdge {
  const order = plan.column.items.map((item) => `${plan.column.id}.${item.id}`);
  const ia = order.indexOf(from.id);
  const ib = order.indexOf(to.id);
  if (ia < 0 || ib < 0) return makeEdge(from.id, to.id, line.kind, tone, [], edges, line.label);
  const down = from.box.y < to.box.y;
  const fb = from.box;
  const tb = to.box;
  if (Math.abs(ia - ib) === 1) {
    const left = Math.max(fb.x, tb.x);
    const right = Math.min(fb.x + fb.w, tb.x + tb.w);
    const x = left < right ? (left + right) / 2 : fb.x + fb.w / 2;
    const s = { x, y: down ? fb.y + fb.h : fb.y };
    const e = { x, y: down ? tb.y : tb.y + tb.h };
    const edge = makeEdge(from.id, to.id, line.kind, tone, [s, e], edges, line.label);
    return withLabelAt(edge, { x: x + 10 + (edge.labelSize?.w ?? 0) / 2, y: (s.y + e.y) / 2 });
  }
  const bx = plan.x + plan.w - SPACE.panelPadX / 2;
  const s = { x: fb.x + fb.w, y: fb.y + fb.h / 2 };
  const e = { x: tb.x + tb.w, y: tb.y + tb.h / 2 };
  const edge = makeEdge(from.id, to.id, line.kind, tone, [s, { x: bx, y: s.y }, { x: bx, y: e.y }, e], edges, line.label);
  return withLabelAt(edge, { x: bx, y: (s.y + e.y) / 2 });
}

function labelOnLongest(route: Point[]): Point {
  let best = { x: route[0]?.x ?? 0, y: route[0]?.y ?? 0 };
  let bestLen = -1;
  for (let i = 0; i + 1 < route.length; i++) {
    const len = Math.hypot(route[i + 1].x - route[i].x, route[i + 1].y - route[i].y);
    if (len > bestLen) {
      bestLen = len;
      best = { x: (route[i].x + route[i + 1].x) / 2, y: (route[i].y + route[i + 1].y) / 2 - 10 };
    }
  }
  return best;
}

/** Drops repeated points and the middle points of straight runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const b = out[i + 1];
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) || (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5));
  });
}

