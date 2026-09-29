import type { Box, NodeContent, Point, Tone } from "@/lib/model/types";
import { fitLine, measureText, wrapText } from "./text";
import { lineHeightOf, PAGE, SPACE, toneColors, TYPE, type TextStyle } from "./theme";

/**
 * Where everything inside a composed node goes, for a given width (and
 * height, for blocks with bottom-pinned parts). The layout engine uses the
 * returned heights to size boxes; the renderer draws the runs and plates at
 * the node's actual box. Sharing this is what keeps text inside its box.
 *
 * All coordinates are relative to the block origin (the node box's top-left,
 * except lane footers, which are relative to the footer's own top).
 */

export interface TextRun {
  /** Baseline anchor point. */
  x: number;
  y: number;
  text: string;
  style: TextStyle;
  color: string;
  anchor: "start" | "middle" | "end";
}

/** A filled rounded rectangle drawn under the text: badges, pills, chips. */
export interface Plate {
  box: Box;
  rx: number;
  fill: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
}

/** A short sample arrow in a legend. */
export interface LegendArrow {
  from: Point;
  to: Point;
  dashed: boolean;
  color: string;
}

export interface ContentBlock {
  /** Height the block needs at this width. */
  height: number;
  plates: Plate[];
  runs: TextRun[];
  arrows: LegendArrow[];
  /** Where the node's icon goes. */
  icon?: Box;
  /** Text pieces that were cut short to fit. */
  truncated: number;
}

export interface ContentNode {
  label: string;
  tone?: Tone;
  icon?: string;
  content?: NodeContent;
}

export interface ContentContext {
  /** Tone of each flow letter, for used-by chips and legends. */
  flowTones?: Record<string, Tone>;
}

const emptyBlock = (height: number): ContentBlock => ({ height, plates: [], runs: [], arrows: [], truncated: 0 });

/** Baseline of a line whose line box starts at `top`. */
export function baselineOf(top: number, style: TextStyle): number {
  const lh = lineHeightOf(style);
  return top + (lh - style.size) / 2 + style.size * 0.78;
}

function pushLines(
  block: ContentBlock,
  lines: string[],
  x: number,
  top: number,
  style: TextStyle,
  color: string,
  anchor: TextRun["anchor"] = "start",
): number {
  const lh = lineHeightOf(style);
  lines.forEach((text, i) => block.runs.push({ x, y: baselineOf(top + i * lh, style), text, style, color, anchor }));
  return lines.length * lh;
}

/** Wraps each paragraph (up to `perItem` lines) and caps the total at `maxTotal` lines. */
function wrapAll(items: string[], width: number, style: TextStyle, perItem: number, maxTotal = Number.POSITIVE_INFINITY): { lines: string[]; truncated: number } {
  const lines: string[] = [];
  let truncated = 0;
  for (const item of items) {
    if (!item.trim()) continue;
    const wrapped = wrapText(item, width, style, perItem);
    if (wrapped.truncated) truncated++;
    for (const line of wrapped.lines) {
      if (lines.length >= maxTotal) {
        truncated++;
        return { lines, truncated };
      }
      lines.push(line);
    }
  }
  return { lines, truncated };
}

function flowTone(ctx: ContentContext | undefined, letter: string): Tone {
  return ctx?.flowTones?.[letter] ?? "gray";
}

function usedByChips(block: ContentBlock, letters: string[], right: number, centerY: number, ctx: ContentContext | undefined): void {
  const size = SPACE.usedBySize;
  let x = right - letters.length * size - Math.max(0, letters.length - 1) * SPACE.usedByGap;
  for (const letter of letters) {
    block.plates.push({ box: { x, y: centerY - size / 2, w: size, h: size }, rx: 4, fill: toneColors(flowTone(ctx, letter)).main });
    block.runs.push({ x: x + size / 2, y: centerY + TYPE.usedBy.size * 0.36, text: letter, style: TYPE.usedBy, color: PAGE.onTone, anchor: "middle" });
    x += size + SPACE.usedByGap;
  }
}

function usedByWidth(count: number): number {
  return count > 0 ? count * SPACE.usedBySize + (count - 1) * SPACE.usedByGap : 0;
}

/** Cards narrower than this (grid cells) show used-by chips on the footnote row. */
const CHIPS_BESIDE_MIN_WIDTH = 300;

/** Card: icon and title, used-by chips on the right, body lines, then footnotes pinned to the bottom. */
export function cardBlock(node: ContentNode, width: number, height?: number, ctx?: ContentContext): ContentBlock {
  const block = emptyBlock(0);
  const padX = SPACE.cardPadX;
  const innerW = width - 2 * padX;
  const usedBy = node.content?.usedBy ?? [];
  const chipsW = usedByWidth(usedBy.length);
  const iconW = node.icon ? SPACE.cardIcon + 10 : 0;
  const titleLh = lineHeightOf(TYPE.cardTitle);

  // Chips sit beside the title on roomy cards, unless that would wrap it; narrow cards (grid
  // cells) keep them on the footnote row so every card in a grid row matches.
  let title = wrapText(node.label, innerW - iconW - (chipsW ? chipsW + 10 : 0), TYPE.cardTitle, 2);
  let chipsBeside = usedBy.length > 0 && width >= CHIPS_BESIDE_MIN_WIDTH;
  if (usedBy.length > 0 && (!chipsBeside || title.lines.length > 1)) {
    const alone = wrapText(node.label, innerW - iconW, TYPE.cardTitle, 2);
    if (!chipsBeside || alone.lines.length < title.lines.length) {
      title = alone;
      chipsBeside = false;
    }
  }
  if (title.truncated) block.truncated++;
  const titleH = Math.max(title.lines.length, 1) * titleLh;
  const rowH = Math.max(titleH, node.icon ? SPACE.cardIcon : 0);
  const top = SPACE.cardPadTop;
  const titleTop = top + (rowH - titleH) / 2;
  pushLines(block, title.lines, padX + iconW, titleTop, TYPE.cardTitle, PAGE.ink);
  if (node.icon) block.icon = { x: padX, y: top + (rowH - SPACE.cardIcon) / 2, w: SPACE.cardIcon, h: SPACE.cardIcon };
  if (chipsBeside) usedByChips(block, usedBy, width - padX, titleTop + titleLh / 2, ctx);

  let y = top + rowH;
  const body = wrapAll(node.content?.lines ?? [], innerW, TYPE.cardLine, 2);
  block.truncated += body.truncated;
  if (body.lines.length) {
    y += 8;
    y += pushLines(block, body.lines, padX, y, TYPE.cardLine, PAGE.body);
  }

  const chipsBelow = usedBy.length > 0 && !chipsBeside;
  const notes = wrapAll(node.content?.notes ?? [], innerW - (chipsBelow ? chipsW + 10 : 0), TYPE.cardNote, 2);
  block.truncated += notes.truncated;
  const noteLh = lineHeightOf(TYPE.cardNote);
  const footH = Math.max(notes.lines.length * noteLh, chipsBelow ? SPACE.usedBySize : 0);
  const natural = y + (footH ? 10 + footH : 0) + SPACE.cardPadBottom;
  block.height = Math.max(natural, SPACE.cardMinHeight);
  if (footH) {
    const footTop = height !== undefined && height > natural ? height - SPACE.cardPadBottom - footH : y + 10;
    pushLines(block, notes.lines, padX, footTop + footH - notes.lines.length * noteLh, TYPE.cardNote, PAGE.muted);
    if (chipsBelow) usedByChips(block, usedBy, width - padX, footTop + footH - (notes.lines.length ? noteLh / 2 : SPACE.usedBySize / 2), ctx);
  }
  return block;
}

/** Lane step: optional icon, then title and up to three detail lines, centred. */
export function stepBlock(node: ContentNode, width: number, height?: number): ContentBlock {
  const block = emptyBlock(0);
  const innerW = width - 2 * SPACE.stepPadX;
  const title = wrapText(node.label, innerW, TYPE.stepTitle, 2);
  if (title.truncated) block.truncated++;
  const details = wrapAll(node.content?.lines ?? [], innerW, TYPE.stepLine, 2, 3);
  block.truncated += details.truncated;

  const iconH = node.icon ? SPACE.stepIcon + 6 : 0;
  const titleH = Math.max(title.lines.length, 1) * lineHeightOf(TYPE.stepTitle);
  const detailsH = details.lines.length ? 4 + details.lines.length * lineHeightOf(TYPE.stepLine) : 0;
  const contentH = iconH + titleH + detailsH;
  const natural = Math.max(contentH + 2 * SPACE.stepPadY, SPACE.stepMinHeight);
  block.height = natural;

  const boxH = height ?? natural;
  let y = Math.max(SPACE.stepPadY, (boxH - contentH) / 2);
  const cx = width / 2;
  if (node.icon) {
    block.icon = { x: cx - SPACE.stepIcon / 2, y, w: SPACE.stepIcon, h: SPACE.stepIcon };
    y += iconH;
  }
  y += pushLines(block, title.lines, cx, y, TYPE.stepTitle, PAGE.ink, "middle");
  if (details.lines.length) pushLines(block, details.lines, cx, y + 4, TYPE.stepLine, PAGE.soft, "middle");
  return block;
}

/** Banner: a centred title and a detail line across the column. */
export function bannerBlock(node: ContentNode, width: number, height?: number): ContentBlock {
  const block = emptyBlock(0);
  const innerW = width - 2 * SPACE.bannerPadX;
  const title = wrapText(node.label, innerW, TYPE.bannerTitle, 2);
  if (title.truncated) block.truncated++;
  const detail = wrapAll(node.content?.subtitle ? [node.content.subtitle] : [], innerW, TYPE.bannerText, 2);
  block.truncated += detail.truncated;
  const titleH = Math.max(title.lines.length, 1) * lineHeightOf(TYPE.bannerTitle);
  const detailH = detail.lines.length ? 2 + detail.lines.length * lineHeightOf(TYPE.bannerText) : 0;
  const contentH = titleH + detailH;
  block.height = contentH + 2 * SPACE.bannerPadY;
  const boxH = height ?? block.height;
  const y = Math.max(SPACE.bannerPadY, (boxH - contentH) / 2);
  pushLines(block, title.lines, width / 2, y, TYPE.bannerTitle, PAGE.ink, "middle");
  if (detail.lines.length) pushLines(block, detail.lines, width / 2, y + titleH + 2, TYPE.bannerText, PAGE.soft, "middle");
  return block;
}

/**
 * Lane header: letter badge, title with an optional tag pill, and the code
 * subtitle. `height` is where the steps start.
 */
export function laneHeaderBlock(node: ContentNode, width: number): ContentBlock {
  const block = emptyBlock(0);
  const tone = toneColors(node.tone);
  const x0 = SPACE.lanePadX;
  const y0 = SPACE.lanePadTop;
  const badge = node.content?.badge?.trim() ?? "";
  const subtitle = node.content?.subtitle?.trim() ?? "";
  const tag = node.content?.tag?.trim().toUpperCase() ?? "";

  let titleX = x0;
  if (badge) {
    const size = SPACE.laneBadge;
    block.plates.push({ box: { x: x0, y: y0, w: size, h: size }, rx: size / 2, fill: tone.main });
    block.runs.push({ x: x0 + size / 2, y: y0 + size / 2 + TYPE.laneBadge.size * 0.36, text: badge.slice(0, 2), style: TYPE.laneBadge, color: PAGE.onTone, anchor: "middle" });
    titleX = x0 + size + 12;
  }

  const titleLh = lineHeightOf(TYPE.laneTitle);
  const tagText = tag ? fitLine(tag, width * 0.4, TYPE.tag) : null;
  const tagW = tagText ? measureText(tagText.text, TYPE.tag) + 20 : 0;
  const title = fitLine(node.label, width - titleX - x0 - (tagW ? tagW + 12 : 0), TYPE.laneTitle);
  if (title.truncated) block.truncated++;
  const titleTop = subtitle ? y0 - 2 : y0 + (SPACE.laneBadge - titleLh) / 2;
  pushLines(block, [title.text], titleX, titleTop, TYPE.laneTitle, PAGE.ink);

  if (tagText) {
    if (tagText.truncated) block.truncated++;
    const x = titleX + measureText(title.text, TYPE.laneTitle) + 12;
    const y = titleTop + (titleLh - SPACE.tagHeight) / 2;
    block.plates.push({ box: { x, y, w: tagW, h: SPACE.tagHeight }, rx: SPACE.tagHeight / 2, fill: tone.main });
    block.runs.push({ x: x + tagW / 2, y: y + SPACE.tagHeight / 2 + TYPE.tag.size * 0.36, text: tagText.text, style: TYPE.tag, color: PAGE.onTone, anchor: "middle" });
  }

  let bottom = y0 + SPACE.laneBadge;
  if (subtitle) {
    const sub = fitLine(subtitle, width - titleX - x0, TYPE.laneSubtitle);
    if (sub.truncated) block.truncated++;
    const top = titleTop + titleLh;
    pushLines(block, [sub.text], titleX, top, TYPE.laneSubtitle, PAGE.muted);
    bottom = Math.max(bottom, top + lineHeightOf(TYPE.laneSubtitle));
  }
  block.height = bottom + SPACE.laneHeadGap;
  return block;
}

/**
 * Lane footer: chips (with their label) and then centred notes, relative to
 * the footer's top. `height` includes the lane's bottom padding; a lane
 * without notes or chips has a footer of just that padding.
 */
export function laneFooterBlock(node: ContentNode, width: number): ContentBlock {
  const block = emptyBlock(0);
  const tone = toneColors(node.tone);
  const innerW = width - 2 * SPACE.lanePadX;
  const chips = (node.content?.chips ?? []).filter((c) => c.trim());
  const label = node.content?.chipsLabel?.trim() ?? "";
  let y = 0;

  if (chips.length) {
    type Piece = { kind: "label" | "chip"; text: string; w: number };
    const pieces: Piece[] = [];
    if (label) {
      const fitted = fitLine(label, innerW * 0.5, TYPE.chipsLabel);
      if (fitted.truncated) block.truncated++;
      pieces.push({ kind: "label", text: fitted.text, w: measureText(fitted.text, TYPE.chipsLabel) + 4 });
    }
    for (const chip of chips) {
      const fitted = fitLine(chip, innerW - 2 * SPACE.chipPadX, TYPE.chip);
      if (fitted.truncated) block.truncated++;
      pieces.push({ kind: "chip", text: fitted.text, w: measureText(fitted.text, TYPE.chip) + 2 * SPACE.chipPadX });
    }
    const rows: Piece[][] = [];
    let row: Piece[] = [];
    let rowW = 0;
    for (const piece of pieces) {
      const add = (row.length ? SPACE.chipGap : 0) + piece.w;
      if (row.length && rowW + add > innerW) {
        rows.push(row);
        row = [];
        rowW = 0;
      }
      rowW += (row.length ? SPACE.chipGap : 0) + piece.w;
      row.push(piece);
    }
    if (row.length) rows.push(row);

    const h = SPACE.chipHeight;
    rows.forEach((pieces, r) => {
      const total = pieces.reduce((sum, p, i) => sum + p.w + (i ? SPACE.chipGap : 0), 0);
      let x = SPACE.lanePadX + (innerW - total) / 2;
      const top = y + r * (h + SPACE.chipGap);
      for (const piece of pieces) {
        if (piece.kind === "label") {
          block.runs.push({ x, y: top + h / 2 + TYPE.chipsLabel.size * 0.36, text: piece.text, style: TYPE.chipsLabel, color: PAGE.ink, anchor: "start" });
        } else {
          block.plates.push({ box: { x, y: top, w: piece.w, h }, rx: h / 2, fill: tone.fill, stroke: tone.main, strokeWidth: 1.2 });
          block.runs.push({ x: x + piece.w / 2, y: top + h / 2 + TYPE.chip.size * 0.36, text: piece.text, style: TYPE.chip, color: PAGE.ink, anchor: "middle" });
        }
        x += piece.w + SPACE.chipGap;
      }
    });
    y += rows.length * h + (rows.length - 1) * SPACE.chipGap;
  }

  const notes = wrapAll(node.content?.notes ?? [], innerW, TYPE.laneNote, 2, 4);
  block.truncated += notes.truncated;
  if (notes.lines.length) {
    if (y > 0) y += 10;
    y += pushLines(block, notes.lines, width / 2, y, TYPE.laneNote, PAGE.soft, "middle");
  }
  block.height = y + SPACE.lanePadBottom;
  return block;
}

/** Whether a lane footer has anything in it (and so needs the gap above it). */
export function laneHasFooter(node: ContentNode): boolean {
  return Boolean(node.content?.chips?.some((c) => c.trim()) || node.content?.notes?.some((n) => n.trim()));
}

const LEGEND_ARROW = 22;

/** Column title row: "N · Title" on the left, legends on the right. Height is the panel head. */
export function columnTitleBlock(node: ContentNode, width: number, ctx?: ContentContext): ContentBlock {
  const padX = SPACE.panelPadX + 4;
  const number = node.content?.badge?.trim();
  const text = number ? `${number} · ${node.label}` : node.label;
  const titleW = measureText(text, TYPE.columnTitle);
  const room = width - 2 * padX;
  const requested = node.content?.legend ?? [];
  // Legends give way to the title: drop the words first, then whole legends.
  const variants: { lines: boolean; usedBy: "full" | "chips" | "none" }[] = [
    { lines: requested.includes("lines"), usedBy: requested.includes("usedBy") ? "full" : "none" },
    { lines: requested.includes("lines"), usedBy: requested.includes("usedBy") ? "chips" : "none" },
    { lines: false, usedBy: requested.includes("usedBy") ? "chips" : "none" },
    { lines: false, usedBy: "none" },
  ];
  for (const variant of variants) {
    const block = columnTitleVariant(text, width, variant, ctx);
    if (block.legendW === 0 || titleW + 24 + block.legendW <= room) return block.block;
  }
  return columnTitleVariant(text, width, variants[variants.length - 1], ctx).block;
}

function columnTitleVariant(
  text: string,
  width: number,
  variant: { lines: boolean; usedBy: "full" | "chips" | "none" },
  ctx: ContentContext | undefined,
): { block: ContentBlock; legendW: number } {
  const block = emptyBlock(SPACE.panelHead);
  const padX = SPACE.panelPadX + 4;
  const baseline = 38;
  const legendY = 33;
  const start = width - SPACE.panelPadX - 4;

  // Lay legends out right to left so they hug the panel edge.
  let right = start;
  const place = (label: string): void => {
    block.runs.push({ x: right, y: baseline - 1, text: label, style: TYPE.legend, color: PAGE.muted, anchor: "end" });
    right -= measureText(label, TYPE.legend);
  };
  if (variant.usedBy !== "none") {
    const letters = Object.keys(ctx?.flowTones ?? {}).sort();
    const size = 16;
    for (let i = letters.length - 1; i >= 0; i--) {
      const x = right - size;
      block.plates.push({ box: { x, y: legendY - size / 2, w: size, h: size }, rx: 3, fill: toneColors(flowTone(ctx, letters[i])).main });
      block.runs.push({ x: x + size / 2, y: legendY + TYPE.usedBy.size * 0.36, text: letters[i], style: TYPE.usedBy, color: PAGE.onTone, anchor: "middle" });
      right = x - 3;
    }
    if (variant.usedBy === "full") {
      right -= 5;
      place("used by flow");
    }
    right -= 16;
  }
  if (variant.lines) {
    place("dependency call");
    right -= 6;
    block.arrows.push({ from: { x: right - LEGEND_ARROW, y: legendY }, to: { x: right, y: legendY }, dashed: true, color: PAGE.soft });
    right -= LEGEND_ARROW + 14;
    place("flow");
    right -= 6;
    block.arrows.push({ from: { x: right - LEGEND_ARROW, y: legendY }, to: { x: right, y: legendY }, dashed: false, color: PAGE.soft });
    right -= LEGEND_ARROW + 16;
  }
  const legendW = right < start ? start - right : 0;

  const title = fitLine(text, (legendW ? right : width - SPACE.panelPadX) - padX, TYPE.columnTitle);
  if (title.truncated) block.truncated++;
  block.runs.push({ x: padX, y: baseline, text: title.text, style: TYPE.columnTitle, color: PAGE.ink, anchor: "start" });
  return { block, legendW };
}

/** Page header band: title, subtitle and the platform badge pill on the right. */
export function pageHeaderBlock(node: ContentNode, width: number): ContentBlock {
  const block = emptyBlock(SPACE.headerHeight);
  const h = SPACE.headerHeight;
  const margin = SPACE.margin;
  const badge = node.content?.badge?.trim().toUpperCase() ?? "";
  const detail = node.content?.badgeDetail?.trim().toUpperCase() ?? "";

  let reserved = 0;
  if (badge) {
    const maxW = width * 0.34;
    const b = fitLine(badge, maxW, TYPE.badgeTitle);
    const d = detail ? fitLine(detail, maxW, TYPE.badgeDetail) : null;
    block.truncated += (b.truncated ? 1 : 0) + (d?.truncated ? 1 : 0);
    const bw = Math.max(measureText(b.text, TYPE.badgeTitle), d ? measureText(d.text, TYPE.badgeDetail) : 0) + 2 * SPACE.pageBadgePadX;
    const bh = d ? 52 : 36;
    const bx = width - margin - bw;
    const by = (h - bh) / 2;
    block.plates.push({ box: { x: bx, y: by, w: bw, h: bh }, rx: bh / 2, fill: "#ffffff", fillOpacity: 0.12, stroke: "#ffffff", strokeOpacity: 0.3, strokeWidth: 1 });
    block.runs.push({ x: bx + bw / 2, y: by + (d ? 22 : 23), text: b.text, style: TYPE.badgeTitle, color: PAGE.badgeText, anchor: "middle" });
    if (d) block.runs.push({ x: bx + bw / 2, y: by + 39, text: d.text, style: TYPE.badgeDetail, color: PAGE.badgeDetail, anchor: "middle" });
    reserved = bw + 32;
  }

  const maxW = width - 2 * margin - reserved;
  const subtitle = node.content?.subtitle?.trim() ?? "";
  const title = fitLine(node.label, maxW, TYPE.pageTitle);
  if (title.truncated) block.truncated++;
  block.runs.push({ x: margin, y: subtitle ? 52 : 64, text: title.text, style: TYPE.pageTitle, color: PAGE.headerText, anchor: "start" });
  if (subtitle) {
    const sub = fitLine(subtitle, maxW, TYPE.pageSubtitle);
    if (sub.truncated) block.truncated++;
    block.runs.push({ x: margin, y: 82, text: sub.text, style: TYPE.pageSubtitle, color: PAGE.headerSubtext, anchor: "start" });
  }
  return block;
}

/** Page footer band: outcome title and text on the left, status on the right. */
export function pageFooterBlock(node: ContentNode, width: number): ContentBlock {
  const block = emptyBlock(0);
  const padX = SPACE.footerPadX;
  const status = node.content?.tag?.trim().toUpperCase() ?? "";
  const detail = node.content?.badgeDetail?.trim() ?? "";
  const maxRight = width * 0.34;
  const s = status ? fitLine(status, maxRight, TYPE.footerStatus) : null;
  const d = detail ? fitLine(detail, maxRight, TYPE.footerStatusDetail) : null;
  block.truncated += (s?.truncated ? 1 : 0) + (d?.truncated ? 1 : 0);
  const rightW = Math.max(s ? measureText(s.text, TYPE.footerStatus) : 0, d ? measureText(d.text, TYPE.footerStatusDetail) : 0);
  const leftW = width - 2 * padX - (rightW ? rightW + 32 : 0);

  const title = fitLine(node.label || "Outcome", leftW, TYPE.footerTitle);
  if (title.truncated) block.truncated++;
  block.runs.push({ x: padX, y: 36, text: title.text, style: TYPE.footerTitle, color: PAGE.footerTitle, anchor: "start" });
  const text = node.content?.subtitle?.trim() ? wrapText(node.content.subtitle, leftW, TYPE.footerText, 3) : { lines: [], truncated: false };
  if (text.truncated) block.truncated++;
  const lh = lineHeightOf(TYPE.footerText);
  text.lines.forEach((line, i) => block.runs.push({ x: padX, y: 64 + i * lh, text: line, style: TYPE.footerText, color: PAGE.footerText, anchor: "start" }));
  if (s) block.runs.push({ x: width - padX, y: 36, text: s.text, style: TYPE.footerStatus, color: PAGE.footerStatus, anchor: "end" });
  if (d) block.runs.push({ x: width - padX, y: 64, text: d.text, style: TYPE.footerStatusDetail, color: PAGE.footerStatusDetail, anchor: "end" });
  block.height = Math.max(88, 64 + Math.max(0, text.lines.length - 1) * lh + 26);
  return block;
}

/** Content block for any composed node, by role, at the node's box. Lanes return their header. */
export function nodeBlock(role: string | undefined, node: ContentNode, box: { w: number; h: number }, ctx?: ContentContext): ContentBlock {
  switch (role) {
    case "header":
      return pageHeaderBlock(node, box.w);
    case "footer":
      return pageFooterBlock(node, box.w);
    case "column":
      return columnTitleBlock(node, box.w, ctx);
    case "banner":
      return bannerBlock(node, box.w, box.h);
    case "lane":
    case "zone":
      return laneHeaderBlock(node, box.w);
    case "step":
      return stepBlock(node, box.w, box.h);
    case "grid":
      return emptyBlock(0);
    default:
      return cardBlock(node, box.w, box.h, ctx);
  }
}
