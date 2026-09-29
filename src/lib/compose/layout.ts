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
import { FOOTER_ID, HEADER_ID, type NBanner, type NCard, type NColumn, type NConnector, type NFlow, type NGrid, type NItem, type NormalizedSpec, type NStep, type NZone } from "./spec";
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
  /** Words split across lines because they were wider than their box. */
  broken: number;
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
  /** Use exactly this page width (raised to the minimum the content needs). */
  width?: number;
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
/** A column whose content fills less than this share of the tallest stacks its grids. */
const SPARSE_SHARE = 0.4;
/** Furthest an item slides down from its packed place to line up with its connector partner. */
const MAX_ALIGN_SLIDE = 88;
/** Header and footer gaps when a connector passes over or under the panels. */
const PASS_GAP = 48;
/** Layout cost of a word split across lines: enough to prefer a slightly wider page, not a huge one. */
const BROKEN_WORD_COST = 0.35;

export function layoutSpec(spec: NormalizedSpec, options: LayoutOptions = {}): LayoutResult {
  const ctx: ContentContext = { flowTones: flowTonesOf(spec) };
  // Everything about connectors that doesn't depend on the page width is planned once.
  const index = indexSpec(spec);
  const { chips, lines } = planConnectors(spec, index);
  const prepared: Prepared = {
    index,
    chips,
    lines,
    bandUse: bandUsage(lines, index),
    gutters: gutterWidths(spec, lines, index),
    passes: lines.some((l) => Math.abs((index.columnOf.get(l.from) ?? 0) - (index.columnOf.get(l.to) ?? 0)) > 1),
  };
  const minimum = minimumPageWidth(spec, prepared.gutters);
  const tightest = Math.max(PAGE_WIDTHS[0], Math.ceil(minimum / 40) * 40);
  const preferred = options.preferWidth && options.preferWidth >= minimum && options.preferWidth <= 4000 ? Math.round(options.preferWidth) : undefined;
  const widths = options.width
    ? [Math.max(Math.round(options.width), Math.ceil(minimum))]
    : [...new Set([...PAGE_WIDTHS.filter((w) => w >= minimum), tightest, ...(preferred ? [preferred] : [])])].sort((a, b) => a - b);

  let best: { placed: Placed; score: number } | null = null;
  for (const width of widths) {
    const placed = place(spec, width, ctx, prepared);
    const aspect = placed.width / placed.height;
    const outside = aspect < ASPECT_LOW ? ASPECT_LOW / aspect - 1 : aspect > ASPECT_HIGH ? aspect / ASPECT_HIGH - 1 : 0;
    const score = outside * 10 + placed.truncated * 2 + placed.broken * BROKEN_WORD_COST + Math.abs(width - PAGE_WIDTH) / PAGE_WIDTH - (width === preferred ? KEEP_WIDTH_BONUS : 0);
    if (!best || score < best.score - 1e-9) best = { placed, score };
  }
  const placed = best!.placed;
  const model: DiagramModel = { version: 1, composed: true, nodes: placed.nodes, edges: placed.edges };
  return {
    model,
    report: {
      width: placed.width,
      height: placed.height,
      aspectRatio: Number((placed.width / placed.height).toFixed(2)),
      truncated: placed.truncated,
      broken: placed.broken,
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

const zoneContent = (zone: NZone): ContentNode => ({
  label: zone.title,
  tone: zone.tone,
  content: compact({ subtitle: zone.subtitle, tag: zone.tag, notes: zone.notes, columns: zone.columns }),
});

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
    } else if (item.type === "zone") {
      min = Math.max(min, 2 * SPACE.panelPadX + 2 * SPACE.lanePadX + GRID_CELL_MIN);
    } else if (item.type === "flow") {
      const lane = column.size === "wide" ? flowRowWidth(item.steps.length) : VERTICAL_LANE_MIN;
      min = Math.max(min, 2 * SPACE.panelPadX + lane);
    }
  }
  return min;
}

function minimumPageWidth(spec: NormalizedSpec, gutters: number[]): number {
  return spec.columns.reduce((sum, c) => sum + minColumnWidth(c), 0) + 2 * SPACE.margin + gutters.reduce((a, b) => a + b, 0);
}

/** Widest a gutter grows to hold a connector label. */
const GUTTER_MAX = 170;

/**
 * Gutters are 32 px unless a labelled connector between two cards crosses
 * them: then the gutter opens up so the label sits in the gap instead of on
 * the panel borders (labels of lane steps sit in the lane's band instead).
 */
function gutterWidths(spec: NormalizedSpec, lines: NConnector[], index: SpecIndex): number[] {
  const widths = new Array<number>(Math.max(0, spec.columns.length - 1)).fill(SPACE.gutter);
  const tracks = new Array<number>(widths.length).fill(0);
  for (const line of lines) {
    const a = index.columnOf.get(line.from);
    const b = index.columnOf.get(line.to);
    if (a === undefined || b === undefined) continue;
    for (const g of guttersUsed(a, b)) tracks[g]++;
    if (!line.label || Math.abs(a - b) !== 1) continue;
    const inLane = (end: string, facesRight: boolean) => index.steps.has(resolveEnd(end, facesRight, index));
    if (inLane(line.from, b > a) || inLane(line.to, a > b)) continue;
    const g = Math.min(a, b);
    widths[g] = Math.max(widths[g], Math.min(GUTTER_MAX, Math.ceil(measureText(line.label, TYPE.edgeLabel)) + 28));
  }
  // Room for every parallel track, so dashed lines don't sit on top of each other.
  return widths.map((w, g) => Math.max(w, Math.min(GUTTER_MAX, (tracks[g] + 1) * EDGE.trackGap)));
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
  stepW: number;
  stepHs: number[];
  stepsH: number;
}

interface Measured {
  item: NItem;
  natural: number;
  h: number;
  top: number;
  grid?: GridRow[];
  flow?: FlowMeasure;
  zone?: { headerH: number };
}

/** A measured item and what its text cost. */
interface Sized {
  measured: Measured;
  truncated: number;
  broken: number;
}

function measureItem(item: NItem, innerW: number, ctx: ContentContext, bandUse: Map<string, number>, columnId: string): Sized {
  switch (item.type) {
    case "card": {
      const block = cardBlock(cardContent(item), innerW, undefined, ctx);
      return { measured: { item, natural: block.height, h: block.height, top: 0 }, truncated: block.truncated, broken: block.broken };
    }
    case "banner": {
      const block = bannerBlock(bannerContent(item), innerW);
      return { measured: { item, natural: block.height, h: block.height, top: 0 }, truncated: block.truncated, broken: block.broken };
    }
    case "grid":
      return measureGrid(item, innerW, ctx);
    case "zone":
      return measureZone(item, innerW, ctx);
    case "flow":
      return measureFlow(item, innerW, bandUse.get(`${columnId}.${item.id}`) ?? 0);
  }
}

/** A boundary: a header like a lane's (no letter), its cards in a grid, notes at the bottom. */
function measureZone(zone: NZone, innerW: number, ctx: ContentContext, columns = zone.columns): Sized {
  const content = zoneContent(zone);
  const header = laneHeaderBlock(content, innerW);
  const footer = laneFooterBlock(content, innerW);
  const hasFooter = laneHasFooter(content);
  const cardsW = innerW - 2 * SPACE.lanePadX;
  // Fewer columns rather than cramped cards.
  let cols = Math.max(1, Math.min(columns, zone.items.length));
  while (cols > 1 && (cardsW - (cols - 1) * SPACE.gridGap) / cols < GRID_CELL_MIN) cols--;
  const grid = measureGrid({ type: "grid", id: zone.id, columns: cols, items: zone.items }, cardsW, ctx);
  const h = header.height + grid.measured.h + (hasFooter ? SPACE.laneFootGap : 0) + footer.height;
  return {
    measured: { item: zone, natural: h, h, top: 0, grid: grid.measured.grid, zone: { headerH: header.height } },
    truncated: header.truncated + footer.truncated + grid.truncated,
    broken: header.broken + footer.broken + grid.broken,
  };
}

function gridRows(grid: NGrid, innerW: number, columns = grid.columns): { cards: NCard[]; cellW: number }[] {
  const cols = Math.max(1, Math.min(columns, grid.items.length));
  const rows: { cards: NCard[]; cellW: number }[] = [];
  for (let i = 0; i < grid.items.length; i += cols) {
    const cards = grid.items.slice(i, i + cols);
    rows.push({ cards, cellW: (innerW - (cards.length - 1) * SPACE.gridGap) / cards.length });
  }
  return rows;
}

function measureGrid(grid: NGrid, innerW: number, ctx: ContentContext, columns = grid.columns): Sized {
  let truncated = 0;
  let broken = 0;
  const rows = gridRows(grid, innerW, columns).map((row) => {
    const heights = row.cards.map((card) => {
      const block = cardBlock(cardContent(card), row.cellW, undefined, ctx);
      truncated += block.truncated;
      broken += block.broken;
      return block.height;
    });
    return { ...row, h: Math.max(...heights) };
  });
  const h = rows.reduce((sum, r) => sum + r.h, 0) + Math.max(0, rows.length - 1) * SPACE.gridGap;
  return { measured: { item: grid, natural: h, h, top: 0, grid: rows }, truncated, broken };
}

function measureFlow(flow: NFlow, innerW: number, band: number): Sized {
  const avail = innerW - 2 * SPACE.lanePadX;
  const k = flow.steps.length;
  const rowStepW = (avail - (k - 1) * SPACE.stepGap) / k;
  const vertical = rowStepW < SPACE.stepMinWidth;
  const content = laneContent(flow, vertical);
  const header = laneHeaderBlock(content, innerW);
  const footer = laneFooterBlock(content, innerW);
  let truncated = header.truncated + footer.truncated;
  let broken = header.broken + footer.broken;

  const stepW = vertical ? avail : rowStepW;
  const naturals = flow.steps.map((step) => {
    const block = stepBlock(stepContent(step), stepW);
    truncated += block.truncated;
    broken += block.broken;
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
      flow: { vertical, headerH: header.height, stepW, stepHs, stepsH },
    },
    truncated,
    broken,
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
  /** Width of the gutter to the right of this column. */
  gutter: number;
}

interface Placed {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
  truncated: number;
  broken: number;
  chipped: number;
}

/** Where each lane step sits, for routing. */
interface StepSlot {
  laneId: string;
  index: number;
  count: number;
  vertical: boolean;
}

/** Connector planning that doesn't depend on the page width. */
interface Prepared {
  index: SpecIndex;
  chips: Map<string, string[]>;
  lines: NConnector[];
  bandUse: Map<string, number>;
  gutters: number[];
  /** Some connector crosses a whole column, over or under the panels. */
  passes: boolean;
}

function place(spec: NormalizedSpec, pageW: number, ctx: ContentContext, prepared: Prepared): Placed {
  const { index, chips, lines, bandUse, gutters } = prepared;
  const innerTotal = pageW - 2 * SPACE.margin - gutters.reduce((a, b) => a + b, 0);
  const widths = distributeWidths(
    innerTotal,
    spec.columns.map((c) => SIZE_WEIGHT[c.size]),
    spec.columns.map(minColumnWidth),
  );
  let truncated = 0;
  let broken = 0;

  // 1. Natural sizes, top-packed.
  let x = SPACE.margin;
  const plans: ColumnPlan[] = spec.columns.map((column, i) => {
    const w = widths[i];
    const innerW = w - 2 * SPACE.panelPadX;
    const items = column.items.map((item) => {
      const result = measureItem(withChips(item, column.id, chips), innerW, ctx, bandUse, column.id);
      truncated += result.truncated;
      broken += result.broken;
      return result.measured;
    });
    const gaps = column.items.slice(1).map((item, j) => (linkedItems(lines, `${column.id}.${column.items[j].id}`, `${column.id}.${item.id}`) ? SPACE.linkedGap : SPACE.itemGap));
    const contentH = items.reduce((sum, m) => sum + m.h, 0) + gaps.reduce((a, b) => a + b, 0);
    const gutter = gutters[i] ?? SPACE.gutter;
    const plan = { column, x, w, items, gaps, contentH, gutter };
    x += w + gutter;
    return plan;
  });

  const panelTop = SPACE.headerHeight + (prepared.passes ? PASS_GAP : SPACE.headerGap);
  const bodyTop = panelTop + SPACE.panelHead;
  let bodyH = Math.max(120, ...plans.map((p) => p.contentH));

  // A column that would stay mostly empty stacks its grids one card per row: the
  // cards fill the height the way a designer would lay them out, instead of
  // leaving a block of cards over blank space.
  for (const plan of plans) {
    if (plan.contentH >= bodyH * (1 - SPARSE_SHARE)) continue;
    const innerW = plan.w - 2 * SPACE.panelPadX;
    const remeasure = (item: NItem, columns?: number) =>
      item.type === "grid" ? measureGrid(item, innerW, ctx, columns) : item.type === "zone" ? measureZone(item, innerW, ctx, columns) : null;
    const original = plan.items;
    plan.items = plan.items.map((m) => {
      if ((m.item.type !== "grid" && m.item.type !== "zone") || m.item.columns < 2 || m.item.items.length < 2) return m;
      const stacked = remeasure(m.item, 1);
      return stacked && stacked.truncated === 0 ? stacked.measured : m;
    });
    const contentH = plan.items.reduce((sum, m) => sum + m.h, 0) + plan.gaps.reduce((a, b) => a + b, 0);
    if (contentH <= bodyH) plan.contentH = contentH;
    else plan.items = original;
  }
  bodyH = Math.max(120, ...plans.map((p) => p.contentH));

  // 2. Equal-height columns: widen gaps, then stretch cards, then align with connector partners.
  for (const plan of plans) stackItems(plan, bodyTop);
  const anchors = anchorCentres(plans, lines);
  for (const plan of plans) equalise(plan, bodyTop, bodyH, anchors);

  // 3. Nodes.
  const nodes: DiagramNode[] = [];
  const slots = new Map<string, StepSlot>();
  const headerBlock = pageHeaderBlock(headerContent(spec), pageW);
  truncated += headerBlock.truncated;
  broken += headerBlock.broken;
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
    broken += titleBlock.broken;
    nodes.push(makeNode(plan.column.id, null, "column", plan.column.title, { x: plan.x, y: panelTop, w: plan.w, h: panelH }, undefined, content, true));
    for (const measured of plan.items) emitItem(nodes, slots, plan, measured, withChips(measured.item, plan.column.id, chips));
  });

  let bottom = panelTop + panelH;
  if (spec.footer) {
    const content = footerContent(spec);
    const w = pageW - 2 * SPACE.margin;
    const block = pageFooterBlock(content, w);
    truncated += block.truncated;
    broken += block.broken;
    const y = bottom + (prepared.passes ? PASS_GAP : SPACE.footerGap);
    nodes.push(makeNode(FOOTER_ID, null, "footer", content.label, { x: SPACE.margin, y, w, h: block.height }, undefined, content.content));
    bottom = y + block.height;
  }

  // 4. Connectors, then their labels kept clear of cards and each other.
  const arrows = stepEdges(spec, nodes);
  const routed = routeConnectors(lines, nodes, slots, plans, panelTop, panelTop + panelH, index, prepared.passes ? PASS_GAP : SPACE.headerGap, arrows);
  const edges = placeLabels([...arrows, ...routed], nodes, pageW);
  return { nodes, edges, width: pageW, height: bottom + SPACE.margin, truncated, broken, chipped: chips.size };
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
  if (item.type === "grid" || item.type === "zone") return item.items.some((c) => c.usedBy.length > 0);
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
  // …then slightly taller cards (grids and zones share it across their rows).
  const stretchable = items.filter((m) => m.item.type === "card" || m.item.type === "grid" || m.item.type === "zone");
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
    // Slide towards the partner, but never open a hole the column reads as empty.
    m.top = Math.min(wanted, maxTop, floor + MAX_ALIGN_SLIDE);
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
      emitCards(nodes, id, m.grid!, x, m.top);
      return;
    }
    case "zone": {
      const c = zoneContent(item);
      nodes.push(makeNode(id, plan.column.id, "zone", c.label, box, item.tone, c.content, true));
      emitCards(nodes, id, m.grid!, x + SPACE.lanePadX, m.top + m.zone!.headerH);
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

function emitCards(nodes: DiagramNode[], parentId: string, rows: GridRow[], x: number, top: number): void {
  let y = top;
  for (const row of rows) {
    let cx = x;
    for (const card of row.cards) {
      const c = cardContent(card);
      nodes.push(makeNode(`${parentId}.${card.id}`, parentId, "card", c.label, { x: cx, y, w: row.cellW, h: row.h }, card.tone, c.content, false, c.icon));
      cx += row.cellW + SPACE.gridGap;
    }
    y += row.h + SPACE.gridGap;
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
export function styleFor(role: NodeRole, tone: Tone | undefined): NodeStyle {
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
    case "zone":
      return { fill: t.lane, stroke: t.main, strokeWidth: 1.5, strokeDash: 6, borderRadius: SPACE.laneRadius, fontColor: PAGE.ink, bold: true };
    case "banner":
      return { fill: t.lane, stroke: t.laneStroke, strokeWidth: 1.5, borderRadius: SPACE.bannerRadius, fontColor: PAGE.ink, bold: true };
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
      if (item.type === "grid" || item.type === "zone") {
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
 * A flow's link to a service card more than one column away would cross the
 * column between them. Like a designer, show it as a used-by chip on the card
 * instead. Links in the other direction (a caller starting a flow) stay lines.
 */
function planConnectors(spec: NormalizedSpec, index: SpecIndex): { chips: Map<string, string[]>; lines: NConnector[] } {
  const chips = new Map<string, string[]>();
  const lines: NConnector[] = [];
  for (const connector of spec.connectors) {
    const a = index.columnOf.get(connector.from);
    const b = index.columnOf.get(connector.to);
    if (a === undefined || b === undefined) continue;
    if (Math.abs(a - b) > 1 && index.laneLetter.has(connector.from) && index.cards.has(connector.to)) {
      const letters = chips.get(connector.to) ?? [];
      const letter = index.laneLetter.get(connector.from)!;
      if (!letters.includes(letter)) letters.push(letter);
      chips.set(connector.to, letters);
      continue;
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
  if (item.type === "grid" || item.type === "zone") return { ...item, items: item.items.map((card) => addTo(card, `${id}.${card.id}`)) };
  return item;
}

/**
 * Which connector ends run through the band under a lane's steps: a step with
 * other steps in the way, or any step end of a labelled connector (the label
 * then sits in the band, clear of gutters and borders).
 */
function usesBand(line: NConnector, info: StepInfo | undefined, facesRight: boolean): boolean {
  return Boolean(info && (blockedStep(info, facesRight) || line.label));
}

/** How many connector ends each lane routes through the call band under its steps. */
function bandUsage(lines: NConnector[], index: SpecIndex): Map<string, number> {
  const use = new Map<string, number>();
  for (const line of lines) {
    const a = index.columnOf.get(line.from);
    const b = index.columnOf.get(line.to);
    if (a === undefined || b === undefined || repeatsStepArrow(line, index)) continue;
    const { fromRight, toRight } = facing(line, a, b, index);
    for (const [end, facesRight] of [
      [line.from, fromRight],
      [line.to, toRight],
    ] as const) {
      const info = index.steps.get(resolveEnd(end, facesRight, index));
      if (info && usesBand(line, info, facesRight)) use.set(info.lane, (use.get(info.lane) ?? 0) + 1);
    }
  }
  return use;
}

/** A connector from a step to the next step of its lane: the lane's own arrow already draws it. */
function repeatsStepArrow(line: NConnector, index: SpecIndex): boolean {
  const from = index.steps.get(line.from);
  const to = index.steps.get(line.to);
  return Boolean(from && to && from.lane === to.lane && to.index === from.index + 1);
}

/**
 * The sides a connector's ends face: towards each other across columns.
 * Within one column both face the margin nearer to them: links between
 * early steps in their rows take the left margin, the rest the right.
 */
function facing(line: NConnector, a: number, b: number, index: SpecIndex): { fromRight: boolean; toRight: boolean } {
  if (a !== b) return { fromRight: b > a, toRight: a > b };
  const place = (end: string) => {
    const info = index.steps.get(end);
    if (info) return info.count > 1 ? info.index / (info.count - 1) : 0.5;
    return index.laneSteps.has(end) ? 0.5 : 1;
  };
  const right = (place(line.from) + place(line.to)) / 2 >= 0.5;
  return { fromRight: right, toRight: right };
}

/** Gutters a connector runs through: the one between adjacent columns, or the one beside each end of a longer link. */
function guttersUsed(a: number, b: number): number[] {
  if (a === b) return [];
  if (Math.abs(a - b) === 1) return [Math.min(a, b)];
  return [b > a ? a : a - 1, b > a ? b - 1 : b];
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

/** How a connector end leaves its node: from its side, down through its lane's band, or down into the gap under its grid cell. */
type Attach = "port" | "band" | "gap";

interface PlannedLine {
  line: NConnector;
  from: DiagramNode;
  to: DiagramNode;
  a: number;
  b: number;
  fromRight: boolean;
  toRight: boolean;
  fromAttach: Attach;
  toAttach: Attach;
}

interface Exit {
  /** From the node outwards; the last point is where the route continues. */
  points: Point[];
  lane?: DiagramNode;
}

/**
 * Routes every connector by intent, designer style:
 * - between neighbouring columns: an S-curve for flows, otherwise an elbow
 *   through the gutter (or one straight run when the ends are level);
 * - across a column: along the gutters and over or under the panels;
 * - within one column: a straight arrow between neighbours, otherwise a
 *   bracket down the panel's right margin.
 * Ends on lane steps with other steps in the way (or with a label) run
 * through the lane's band under its steps; cards behind other grid cells
 * leave through the gap below them.
 */
function routeConnectors(
  lines: NConnector[],
  nodes: DiagramNode[],
  slots: Map<string, StepSlot>,
  plans: ColumnPlan[],
  panelTop: number,
  panelBottom: number,
  index: SpecIndex,
  passGap: number,
  /** The lanes' step arrows: connectors that repeat one only add its label, and ids never collide with them. */
  arrows: DiagramEdge[],
): DiagramEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sideCount = new Map<string, number>();
  const sideUse = new Map<string, number>();
  const bandTrack = new Map<string, number>();
  const gutterCount = new Map<number, number>();
  const gutterUse = new Map<number, number>();
  const marginUse = new Map<string, number>();
  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  const behindCell = (node: DiagramNode, facesRight: boolean) => {
    const role = node.parent ? byId.get(node.parent)?.role : undefined;
    if (role !== "grid" && role !== "zone") return false;
    const b = node.box;
    return nodes.some((s) => s.parent === node.parent && s.id !== node.id && s.box.y < b.y + b.h && b.y < s.box.y + s.box.h && (facesRight ? s.box.x > b.x : s.box.x < b.x));
  };
  const attachOf = (line: NConnector, node: DiagramNode, facesRight: boolean): Attach => {
    const slot = slots.get(node.id);
    if (slot && !slot.vertical && usesBand(line, index.steps.get(node.id), facesRight)) return "band";
    if (behindCell(node, facesRight)) return "gap";
    return "port";
  };

  // Pass 1: resolve ends and count shared sides and gutters, so ports and tracks spread evenly.
  const planned: PlannedLine[] = [];
  for (const line of lines) {
    const a = index.columnOf.get(line.from);
    const b = index.columnOf.get(line.to);
    if (a === undefined || b === undefined) continue;
    const { fromRight, toRight } = facing(line, a, b, index);
    const from = byId.get(resolveEnd(line.from, fromRight, index));
    const to = byId.get(resolveEnd(line.to, toRight, index));
    if (!from || !to || from.id === to.id) continue;
    const plan: PlannedLine = { line, from, to, a, b, fromRight, toRight, fromAttach: attachOf(line, from, fromRight), toAttach: attachOf(line, to, toRight) };
    planned.push(plan);
    if (plan.fromAttach === "port") bump(sideCount, `${from.id}|${fromRight}`);
    if (plan.toAttach === "port") bump(sideCount, `${to.id}|${toRight}`);
    for (const g of guttersUsed(a, b)) bump(gutterCount, g);
  }

  const port = (node: DiagramNode, right: boolean): Point => {
    const key = `${node.id}|${right}`;
    const count = sideCount.get(key) ?? 1;
    const i = sideUse.get(key) ?? 0;
    sideUse.set(key, i + 1);
    const box = node.box;
    const span = Math.min(box.h * 0.6, 24 * (count - 1));
    const y = count <= 1 ? box.y + box.h / 2 : box.y + box.h / 2 - span / 2 + (span * i) / (count - 1);
    return { x: right ? box.x + box.w : box.x, y };
  };

  const exit = (node: DiagramNode, attach: Attach, right: boolean): Exit => {
    const box = node.box;
    const cx = box.x + box.w / 2;
    if (attach === "band") {
      const lane = byId.get(slots.get(node.id)!.laneId)!;
      const i = bandTrack.get(lane.id) ?? 0;
      bandTrack.set(lane.id, i + 1);
      const trackY = box.y + box.h + SPACE.callBand - 8 + i * SPACE.callTrackGap;
      return { points: [{ x: cx, y: box.y + box.h }, { x: cx, y: trackY }], lane };
    }
    if (attach === "gap") return { points: [{ x: cx, y: box.y + box.h }, { x: cx, y: box.y + box.h + SPACE.gridGap / 2 }] };
    return { points: [port(node, right)] };
  };

  /** Centre of the gutter to the right of column `g`. */
  const gutterCentre = (g: number): number => plans[g].x + plans[g].w + plans[g].gutter / 2;
  const gutterTrack = (g: number): number => {
    const count = gutterCount.get(g) ?? 1;
    const i = gutterUse.get(g) ?? 0;
    gutterUse.set(g, i + 1);
    return gutterCentre(g) + (i - (count - 1) / 2) * EDGE.trackGap;
  };
  /** A label in the band, between the step and the lane edge the route heads for. */
  const bandLabel = (out: Exit, right: boolean): Point => {
    const lane = out.lane!;
    const edgeX = right ? lane.box.x + lane.box.w : lane.box.x;
    return { x: (out.points[0].x + edgeX) / 2, y: out.points[1].y - 10 };
  };

  const edges: DiagramEdge[] = [];
  for (const p of planned) {
    const { line, from, to, a, b, fromRight, toRight, fromAttach, toAttach } = p;
    const tone = line.tone ?? (line.kind === "call" ? to.tone : from.tone) ?? from.tone;
    const push = (route: Point[], labelAt: Point, curve = false) => {
      const edge = makeEdge(from.id, to.id, line.kind, tone, curve ? route : simplify(route), [...arrows, ...edges], line.label);
      if (curve) edge.curve = true;
      edges.push(withLabelAt(edge, labelAt));
    };

    // The lane already draws this arrow between neighbouring steps: just give it the label.
    const arrow = arrows.find((e) => e.from === from.id && e.to === to.id);
    if (arrow) {
      if (line.label && !arrow.label) {
        const mid = arrow.route.length ? { x: (arrow.route[0].x + arrow.route[arrow.route.length - 1].x) / 2, y: (arrow.route[0].y + arrow.route[arrow.route.length - 1].y) / 2 - 10 } : { x: 0, y: 0 };
        arrow.label = line.label;
        arrow.labelSize = { w: Math.ceil(measureText(line.label, TYPE.edgeLabel)) + 8, h: 16 };
        withLabelAt(arrow, mid);
      }
      continue;
    }

    if (a === b && fromAttach === "port" && toAttach === "port") {
      const stacked = neighbourArrow(from, to, plans[a]);
      if (stacked) {
        push(stacked.route, stacked.labelAt);
        continue;
      }
    }
    if (a === b && fromAttach === "band" && toAttach === "band" && slots.get(from.id)!.laneId === slots.get(to.id)!.laneId) {
      // Two steps of one lane: along its band, under the steps between them.
      const out = exit(from, "band", true);
      const y = out.points[1].y;
      const tx = to.box.x + to.box.w / 2;
      push([out.points[0], { x: out.points[0].x, y }, { x: tx, y }, { x: tx, y: to.box.y + to.box.h }], { x: (out.points[0].x + tx) / 2, y: y - 10 });
      continue;
    }
    if (Math.abs(a - b) === 1 && line.kind === "flow" && fromAttach === "port" && toAttach === "port") {
      const s = port(from, fromRight);
      const e = port(to, toRight);
      push([s, e], { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 - 10 }, true);
      continue;
    }

    const out = exit(from, fromAttach, fromRight);
    const into = exit(to, toAttach, toRight);
    const s = out.points[out.points.length - 1];
    const e = into.points[into.points.length - 1];
    const tail = [...into.points].reverse();
    let middle: Point[];
    let labelAt: Point;
    if (a === b) {
      // Within a column: a bracket down the panel's right margin.
      const key = `${a}|${fromRight}`;
      const i = marginUse.get(key) ?? 0;
      marginUse.set(key, i + 1);
      const offset = 7 + (i % 3) * 5;
      const mx = fromRight ? plans[a].x + plans[a].w - SPACE.panelPadX + offset : plans[a].x + SPACE.panelPadX - offset;
      middle = [
        { x: mx, y: s.y },
        { x: mx, y: e.y },
      ];
      labelAt = { x: mx, y: (s.y + e.y) / 2 };
    } else if (Math.abs(a - b) === 1) {
      const g = Math.min(a, b);
      if (toAttach === "port" && s.y >= to.box.y + 10 && s.y <= to.box.y + to.box.h - 10) {
        // The target spans the source's level: one straight run.
        middle = [];
        tail.splice(0, tail.length, { x: e.x, y: s.y });
        labelAt = { x: gutterCentre(g), y: s.y - 10 };
      } else {
        const gx = gutterTrack(g);
        middle = [
          { x: gx, y: s.y },
          { x: gx, y: e.y },
        ];
        labelAt = Math.abs(e.y - s.y) >= 28 ? { x: gx, y: (s.y + e.y) / 2 } : { x: gutterCentre(g), y: Math.min(s.y, e.y) - 10 };
      }
    } else {
      // Across a column: along the gutters, over or under the panels, whichever is nearer.
      const [g1, g2] = guttersUsed(a, b);
      const below = (s.y + e.y) / 2 > (panelTop + panelBottom) / 2;
      const passY = below ? panelBottom + passGap / 2 : panelTop - passGap / 2;
      const gx1 = gutterTrack(g1);
      const gx2 = gutterTrack(g2);
      middle = [
        { x: gx1, y: s.y },
        { x: gx1, y: passY },
        { x: gx2, y: passY },
        { x: gx2, y: e.y },
      ];
      labelAt = { x: (gx1 + gx2) / 2, y: passY - 8 };
    }
    if (fromAttach === "band") labelAt = bandLabel(out, fromRight);
    else if (toAttach === "band") labelAt = bandLabel(into, toRight);
    push([...out.points, ...middle, ...tail], labelAt);
  }
  return edges;
}

function withLabelAt(edge: DiagramEdge, at: Point): DiagramEdge {
  if (edge.label) edge.labelAt = { x: round1(at.x), y: round1(at.y) };
  return edge;
}

/** Two neighbouring items of one column: a short straight arrow between them, labelled beside it. */
function neighbourArrow(from: DiagramNode, to: DiagramNode, plan: ColumnPlan): { route: Point[]; labelAt: Point } | null {
  const order = plan.column.items.map((item) => `${plan.column.id}.${item.id}`);
  const ia = order.indexOf(from.id);
  const ib = order.indexOf(to.id);
  if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) return null;
  const down = from.box.y < to.box.y;
  const fb = from.box;
  const tb = to.box;
  const left = Math.max(fb.x, tb.x);
  const right = Math.min(fb.x + fb.w, tb.x + tb.w);
  const x = left < right ? (left + right) / 2 : fb.x + fb.w / 2;
  const s = { x, y: down ? fb.y + fb.h : fb.y };
  const e = { x, y: down ? tb.y : tb.y + tb.h };
  return { route: [s, e], labelAt: { x: x + 60, y: (s.y + e.y) / 2 } };
}

const LABEL_H = 18;

function labelBox(edge: DiagramEdge, at: Point): Box {
  const w = measureText(edge.label ?? "", TYPE.edgeLabel) + 8;
  return { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Keeps connector labels off cards, steps and each other: each label tries
 * its preferred spot, then the midpoints of its route's segments (above a
 * horizontal run, beside a vertical one), and takes the first clear one, or
 * the least covered.
 */
function placeLabels(edges: DiagramEdge[], nodes: DiagramNode[], pageW: number): DiagramEdge[] {
  const solid = nodes.filter((n) => n.role === "card" || n.role === "step" || n.role === "banner" || n.role === "header" || n.role === "footer" || (!n.role && !n.container)).map((n) => n.box);
  const placed: Box[] = [];
  return edges.map((edge) => {
    if (!edge.label || !edge.labelAt || edge.route.length < 2) return edge;
    const w = measureText(edge.label, TYPE.edgeLabel) + 8;
    const candidates: Point[] = [edge.labelAt];
    const segments = edge.route.slice(1).map((p, i) => [edge.route[i], p] as const).sort((x, y) => Math.hypot(y[1].x - y[0].x, y[1].y - y[0].y) - Math.hypot(x[1].x - x[0].x, x[1].y - x[0].y));
    for (const [p, q] of segments) {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      if (Math.abs(p.y - q.y) < 0.5) candidates.push({ x: mx, y: my - 10 }, { x: mx, y: my + 12 });
      else candidates.push({ x: mx - w / 2 - 6, y: my }, { x: mx + w / 2 + 6, y: my }, { x: mx, y: my });
    }
    let best = candidates[0];
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const box = labelBox(edge, c);
      if (box.x < 4 || box.x + box.w > pageW - 4) continue;
      const cost = [...solid, ...placed].reduce((sum, o) => sum + overlapArea(box, o), 0);
      if (cost < bestCost - 1e-6) {
        best = c;
        bestCost = cost;
        if (cost === 0) break;
      }
    }
    placed.push(labelBox(edge, best));
    return best === edge.labelAt ? edge : { ...edge, labelAt: { x: round1(best.x), y: round1(best.y) } };
  });
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

