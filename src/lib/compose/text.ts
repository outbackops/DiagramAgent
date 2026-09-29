import type { TextStyle } from "./theme";

/**
 * Deterministic text measurement for layout. Widths come from the Helvetica
 * AFM tables (Arial shares them) plus a little slack: Segoe UI is a touch
 * narrower, so text measured here always fits when drawn in it, and wider
 * fallback fonts rarely overflow. The same numbers run on the server and in
 * the browser, so a spec always lays out identically.
 */

// Advance widths in 1/1000 em for U+0020..U+007E.
// prettier-ignore
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

// prettier-ignore
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

const EXTRA: Record<number, number> = {
  0x00a0: 278, // no-break space
  0x00b0: 400, // °
  0x00b1: 584, // ±
  0x00b7: 278, // ·
  0x00d7: 584, // ×
  0x00f7: 584, // ÷
  0x2013: 556, // –
  0x2014: 1000, // —
  0x2018: 250, // ‘
  0x2019: 250, // ’
  0x201c: 420, // “
  0x201d: 420, // ”
  0x2022: 350, // •
  0x2026: 1000, // …
  0x2190: 840, // ←
  0x2191: 600, // ↑
  0x2192: 840, // →
  0x2193: 600, // ↓
  0x2194: 1000, // ↔
  0x21d2: 1000, // ⇒
  0x2260: 584, // ≠
  0x2264: 584, // ≤
  0x2265: 584, // ≥
  0x2122: 1000, // ™
  0x20ac: 556, // €
};

/** Headroom for font substitution; kept small so Segoe UI layouts don't look loose. */
const SANS_SLACK = 1.04;
const MONO_ADVANCE = 602;
export const ELLIPSIS = "…";

function advance(code: number, bold: number): number {
  if (code >= 0x20 && code <= 0x7e) {
    const i = code - 0x20;
    return REGULAR[i] + (BOLD[i] - REGULAR[i]) * bold;
  }
  const extra = EXTRA[code];
  if (extra !== undefined) return extra;
  if (code >= 0xc0 && code <= 0xde) return 722;
  if (code >= 0xdf && code <= 0x24f) return 580;
  if ((code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xff00 && code <= 0xffef) || code >= 0x1f000) return 1000;
  return 600;
}

/** Width of `text` on one line, in px. */
export function measureText(text: string, style: TextStyle): number {
  if (!text) return 0;
  let units = 0;
  let count = 0;
  if (style.mono) {
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0x20;
      units += (code >= 0x2e80 && code <= 0x9fff) || code >= 0x1f000 ? 1000 : MONO_ADVANCE;
      count++;
    }
  } else {
    const bold = style.weight >= 700 ? 1 : style.weight >= 600 ? 0.5 : 0;
    for (const ch of text) {
      units += advance(ch.codePointAt(0) ?? 0x20, bold);
      count++;
    }
    units *= SANS_SLACK;
  }
  return (units / 1000) * style.size + Math.max(0, count - 1) * (style.letterSpacing ?? 0);
}

export interface WrapResult {
  lines: string[];
  /** True when text was dropped or ellipsised to respect `maxLines` or the width. */
  truncated: boolean;
  /** True when a word wider than the line had to be split. */
  broken?: boolean;
}

const BREAK_AFTER = new Set(["/", ".", "-", "_", ":", ",", ";", "?", "&", "=", ")", "]", "}"]);

/** Splits one over-long word into pieces that fit, preferring to break after punctuation. */
function breakWord(word: string, maxWidth: number, style: TextStyle): string[] {
  const pieces: string[] = [];
  let rest = word;
  while (rest && measureText(rest, style) > maxWidth) {
    const chars = Array.from(rest);
    let fit = 0;
    while (fit < chars.length && measureText(chars.slice(0, fit + 1).join(""), style) <= maxWidth) fit++;
    fit = Math.max(1, fit);
    let cut = fit;
    for (let i = fit - 1; i >= Math.ceil(fit / 2); i--) {
      if (BREAK_AFTER.has(chars[i])) {
        cut = i + 1;
        break;
      }
    }
    pieces.push(chars.slice(0, cut).join(""));
    rest = chars.slice(cut).join("");
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Trims `text` from the end until it fits with an ellipsis. */
export function ellipsize(text: string, maxWidth: number, style: TextStyle): string {
  if (measureText(text, style) <= maxWidth) return text;
  const chars = Array.from(text.trimEnd());
  while (chars.length > 0 && measureText(chars.join("").trimEnd() + ELLIPSIS, style) > maxWidth) chars.pop();
  return chars.join("").trimEnd() + ELLIPSIS;
}

/**
 * Greedy word wrap to `maxWidth`. Explicit newlines are kept. Words wider
 * than a line are split (`broken`); beyond `maxLines` the last line is
 * ellipsised (`truncated`).
 */
export function wrapText(text: string, maxWidth: number, style: TextStyle, maxLines = Number.POSITIVE_INFINITY): WrapResult {
  const width = Math.max(maxWidth, style.size * 2);
  const lines: string[] = [];
  let broken = false;
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, style) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      const pieces = breakWord(word, width, style);
      if (pieces.length > 1) broken = true;
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    }
    if (current) lines.push(current);
  }
  if (lines.length <= maxLines) return { lines, truncated: false, broken };
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept.length - 1;
  kept[last] = ellipsize(kept[last] + ELLIPSIS, width, style);
  return { lines: kept, truncated: true, broken };
}

/** One line that fits `maxWidth`, ellipsised if needed. */
export function fitLine(text: string, maxWidth: number, style: TextStyle): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  const width = Math.max(maxWidth, style.size * 2);
  if (measureText(clean, style) <= width) return { text: clean, truncated: false };
  return { text: ellipsize(clean, width, style), truncated: true };
}
