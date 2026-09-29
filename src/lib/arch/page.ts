import { measureText, wrapText } from "@/lib/compose/text";
import type { TextStyle } from "@/lib/compose/theme";
import { MEANINGS, type Meaning, type NOverlay, type NSequence } from "./spec";
import { ARCH_SPACE as S, ARCH_TYPE as T } from "./theme";

/**
 * The page around an Architecture diagram: a small title top-left, and under the diagram the
 * numbered workflow (left), the legend (right) and the assumptions (under the workflow)
 * (origin R6). Layout sizes these blocks and the renderer draws the same runs, so text always
 * fits. All coordinates are relative to the block's top-left.
 */

export interface TextRun {
  text: string;
  x: number;
  /** Baseline. */
  y: number;
  style: TextStyle;
  tone: "text" | "muted";
}

export interface BadgeMark {
  /** Centre. */
  x: number;
  y: number;
  sequenceIndex: number;
  number: number;
}

export type LegendSwatch = { kind: "line"; meaning: Meaning; x: number; y: number; w: number } | { kind: "badge"; sequenceIndex: number; x: number; y: number } | { kind: "tag"; text: string; x: number; y: number };

export interface PageBlock {
  w: number;
  h: number;
  runs: TextRun[];
  badges: BadgeMark[];
  swatches: LegendSwatch[];
}

const empty = (): PageBlock => ({ w: 0, h: 0, runs: [], badges: [], swatches: [] });
const lineHeight = (style: TextStyle) => Math.round(style.size * 1.45);

export function titleBlock(title: string, subtitle: string | undefined, maxWidth: number): PageBlock {
  const block = empty();
  const t = wrapText(title, maxWidth, T.title, 2);
  let y = 0;
  for (const line of t.lines) {
    y += lineHeight(T.title);
    block.runs.push({ text: line, x: 0, y: y - 6, style: T.title, tone: "text" });
    block.w = Math.max(block.w, measureText(line, T.title));
  }
  if (subtitle) {
    const s = wrapText(subtitle, maxWidth, T.subtitle, 2);
    y += 2;
    for (const line of s.lines) {
      y += lineHeight(T.subtitle);
      block.runs.push({ text: line, x: 0, y: y - 5, style: T.subtitle, tone: "muted" });
      block.w = Math.max(block.w, measureText(line, T.subtitle));
    }
  }
  block.h = y;
  block.w = Math.ceil(block.w);
  return block;
}

/**
 * The numbered workflow, as in Microsoft's "Workflow" sections: each sequence's name, then its
 * steps with the same badges the diagram shows. Long workflows flow into two columns.
 */
export function workflowBlock(sequences: NSequence[], maxWidth: number): PageBlock | null {
  const withSteps = sequences.filter((s) => s.steps.length > 0);
  if (withSteps.length === 0) return null;
  const totalSteps = withSteps.reduce((n, s) => n + s.steps.length, 0);
  const columns = totalSteps > 6 && maxWidth >= 760 ? 2 : 1;
  const colGap = 32;
  const colW = Math.floor((maxWidth - colGap * (columns - 1)) / columns);
  const textX = S.badge + 8;
  const entries: Array<{ kind: "heading"; text: string } | { kind: "step"; sequenceIndex: number; number: number; lines: string[] }> = [];
  sequences.forEach((sequence, sequenceIndex) => {
    if (sequence.steps.length === 0) return;
    if (withSteps.length > 1) entries.push({ kind: "heading", text: sequence.name });
    sequence.steps.forEach((step, i) => entries.push({ kind: "step", sequenceIndex, number: i + 1, lines: wrapText(step, colW - textX, T.body, 5).lines }));
  });
  const entryHeight = (e: (typeof entries)[number]) => (e.kind === "heading" ? lineHeight(T.sectionTitle) + 4 : Math.max(S.badge + 4, e.lines.length * lineHeight(T.body) + 4));
  const total = entries.reduce((h, e) => h + entryHeight(e), 0);
  const target = columns === 2 ? total / 2 : Infinity;
  const block = empty();
  let col = 0;
  let y = lineHeight(T.sectionTitle) + 6;
  block.runs.push({ text: "Workflow", x: 0, y: lineHeight(T.sectionTitle) - 4, style: T.sectionTitle, tone: "text" });
  let colHeight = 0;
  let maxY = y;
  for (const entry of entries) {
    const h = entryHeight(entry);
    if (columns === 2 && col === 0 && colHeight + h / 2 > target && colHeight > 0) {
      col = 1;
      y = lineHeight(T.sectionTitle) + 6;
    }
    const x0 = col * (colW + colGap);
    if (entry.kind === "heading") {
      block.runs.push({ text: entry.text, x: x0, y: y + lineHeight(T.sectionTitle) - 4, style: T.sectionTitle, tone: "muted" });
    } else {
      block.badges.push({ x: x0 + S.badge / 2, y: y + S.badge / 2, sequenceIndex: entry.sequenceIndex, number: entry.number });
      entry.lines.forEach((line, i) => block.runs.push({ text: line, x: x0 + textX, y: y + 4 + (i + 1) * lineHeight(T.body) - 5, style: T.body, tone: "text" }));
    }
    y += h;
    if (col === 0) colHeight += h;
    maxY = Math.max(maxY, y);
  }
  block.w = columns === 2 ? maxWidth : Math.min(maxWidth, Math.ceil(textX + Math.max(0, ...entries.map((e) => (e.kind === "heading" ? measureText(e.text, T.sectionTitle) - textX : Math.max(...e.lines.map((l) => measureText(l, T.body)))))) + 4));
  block.h = maxY;
  return block;
}

export interface LegendInput {
  /** Meanings of the connections drawn (hidden links excluded). */
  meanings: Meaning[];
  sequences: NSequence[];
  /** Overlays drawn as membership tags (no clean box was possible). */
  taggedOverlays: NOverlay[];
}

const MEANING_LABEL: Record<Meaning, string> = {
  request: "Request",
  async: "Asynchronous / event",
  replication: "Replication",
  "private-link": "Private link",
  peering: "Peering",
  vpn: "VPN / private circuit",
  monitoring: "Monitoring",
  management: "Management",
  egress: "Forced egress",
};

/** Legend rows: only what the diagram uses; shown when line styles or badges carry meaning (R3). */
export function legendBlock(input: LegendInput): PageBlock | null {
  const meanings = MEANINGS.filter((m) => input.meanings.includes(m));
  const sequences = input.sequences.filter((s) => s.steps.length > 0 || input.sequences.length > 0);
  if (meanings.length <= 1 && sequences.length === 0 && input.taggedOverlays.length === 0) return null;
  const block = empty();
  const rowH = 22;
  let y = lineHeight(T.sectionTitle) + 6;
  block.runs.push({ text: "Legend", x: 0, y: lineHeight(T.sectionTitle) - 4, style: T.sectionTitle, tone: "text" });
  let w = measureText("Legend", T.sectionTitle);
  const sample = 36;
  if (meanings.length > 1) {
    for (const meaning of meanings) {
      block.swatches.push({ kind: "line", meaning, x: 0, y: y + rowH / 2, w: sample });
      block.runs.push({ text: MEANING_LABEL[meaning], x: sample + 10, y: y + rowH / 2 + 4, style: T.body, tone: "text" });
      w = Math.max(w, sample + 10 + measureText(MEANING_LABEL[meaning], T.body));
      y += rowH;
    }
  }
  sequences.forEach((sequence, index) => {
    // "Inbound steps", "Checkout steps": never the bare name, which may match a line style ("Request").
    const label = /\bsteps?$/i.test(sequence.name) ? sequence.name : `${sequence.name} steps`;
    block.swatches.push({ kind: "badge", sequenceIndex: index, x: S.badge / 2, y: y + rowH / 2 });
    block.runs.push({ text: label, x: sample + 10, y: y + rowH / 2 + 4, style: T.body, tone: "text" });
    w = Math.max(w, sample + 10 + measureText(label, T.body));
    y += rowH;
  });
  for (const overlay of input.taggedOverlays) {
    const tag = overlayTag(overlay);
    block.swatches.push({ kind: "tag", text: tag, x: 0, y: y + rowH / 2 });
    block.runs.push({ text: overlay.name, x: sample + 10, y: y + rowH / 2 + 4, style: T.body, tone: "text" });
    w = Math.max(w, sample + 10 + measureText(overlay.name, T.body));
    y += rowH;
  }
  block.w = Math.ceil(w);
  block.h = y;
  return block;
}

/** Short tag for an overlay drawn on its members when no clean box fits, e.g. "ASG". */
export function overlayTag(overlay: Pick<NOverlay, "name" | "kind">): string {
  const words = overlay.name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  const acronym = words.map((w) => w[0].toUpperCase()).join("").slice(0, 4);
  return acronym.length >= 2 ? acronym : overlay.name.slice(0, 6);
}

export function assumptionsBlock(assumptions: string[], maxWidth: number): PageBlock | null {
  if (assumptions.length === 0) return null;
  const block = empty();
  let y = lineHeight(T.sectionTitle) + 4;
  block.runs.push({ text: "Assumptions", x: 0, y: lineHeight(T.sectionTitle) - 4, style: T.sectionTitle, tone: "muted" });
  let w = measureText("Assumptions", T.sectionTitle);
  for (const assumption of assumptions) {
    // Wide enough for the spec's longest assumption at the narrowest section width: never cut off.
    const lines = wrapText(`• ${assumption}`, maxWidth, T.body, 4).lines;
    for (const line of lines) {
      y += lineHeight(T.body);
      block.runs.push({ text: line, x: 0, y: y - 5, style: T.body, tone: "muted" });
      w = Math.max(w, measureText(line, T.body));
    }
  }
  block.w = Math.ceil(w);
  block.h = y + 4;
  return block;
}

export interface PageSections {
  workflow: PageBlock | null;
  legend: PageBlock | null;
  assumptions: PageBlock | null;
  /** Height of everything under the diagram, including the gap above it. */
  height: number;
  /** Relative placements under the diagram's bottom-left. */
  at: { workflow?: { x: number; y: number }; legend?: { x: number; y: number }; assumptions?: { x: number; y: number } };
}

/** Lays the three blocks out under a diagram of the given width. */
export function pageSections(width: number, sequences: NSequence[], assumptions: string[], legend: LegendInput): PageSections {
  const legendBox = legendBlock(legend);
  const leftW = Math.max(320, width - (legendBox ? legendBox.w + 48 : 0));
  const workflow = workflowBlock(sequences, Math.min(leftW, 880));
  const notes = assumptionsBlock(assumptions, Math.min(leftW, 720));
  const at: PageSections["at"] = {};
  let leftH = 0;
  if (workflow) {
    at.workflow = { x: 0, y: 0 };
    leftH = workflow.h;
  }
  if (notes) {
    at.assumptions = { x: 0, y: leftH ? leftH + 16 : 0 };
    leftH = at.assumptions.y + notes.h;
  }
  if (legendBox) at.legend = { x: Math.max(workflow || notes ? leftW + 48 : 0, width - legendBox.w), y: 0 };
  const content = Math.max(leftH, legendBox?.h ?? 0);
  return { workflow, legend: legendBox, assumptions: notes, height: content ? content + S.blockGap / 2 : 0, at };
}
