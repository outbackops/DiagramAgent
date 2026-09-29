import { measureText, wrapText } from "@/lib/compose/text";
import type { Box } from "@/lib/model/types";
import { isBoundary, type NBoundary, type NComponent, type NItem } from "./spec";
import { ARCH_SPACE as S, ARCH_TYPE as T } from "./theme";

/**
 * Text-fitted sizes of Architecture nodes. The layout sizes boxes with these and the renderer
 * draws the same lines, so text always fits its box.
 */

export interface ComponentGeom {
  w: number;
  h: number;
  /** Name wrapped to at most two lines. */
  lines: string[];
  /** Detail line, ellipsised to the box when needed. */
  detail?: string;
}

export function componentGeom(component: NComponent): ComponentGeom {
  const name = wrapText(component.name, S.nameMaxWidth, T.name, 2);
  const detail = component.detail ? wrapText(component.detail, S.nameMaxWidth, T.detail, 1).lines[0] : undefined;
  const textW = Math.max(...name.lines.map((line) => measureText(line, T.name)), detail ? measureText(detail, T.detail) : 0);
  return {
    w: Math.max(S.nodeMinWidth, Math.ceil(textW) + S.nodeSidePad * 2),
    h: S.nodePadTop + S.icon + S.iconGap + name.lines.length * S.nameLineHeight + (detail ? S.detailLineHeight : 0) + S.nodePadBottom,
    lines: name.lines,
    detail,
  };
}

/** Header band height (name, and facts on a second line). */
export function headerHeight(boundary: Pick<NBoundary, "facts">): number {
  return boundary.facts ? S.headerHeightWithFacts : S.headerHeight;
}

function headerTextWidth(boundary: Pick<NBoundary, "name" | "facts">): number {
  return Math.max(measureText(boundary.name, T.boundary), boundary.facts ? measureText(boundary.facts, T.facts) : 0);
}

/** Narrowest box that fits the header: pad, icon, gap, text, pad. */
export function boundaryMinWidth(boundary: Pick<NBoundary, "name" | "facts">): number {
  return Math.ceil(S.groupPad + S.headerIcon + 8 + headerTextWidth(boundary) + S.groupPad);
}

/** The header's text area: no connector may cross it and no label may cover it. */
export function titleBox(boundary: Pick<NBoundary, "name" | "facts">, box: Box): Box {
  return { x: box.x + S.groupPad / 2, y: box.y + 8, w: S.headerIcon + 8 + headerTextWidth(boundary) + S.groupPad / 2, h: headerHeight(boundary) - 14 };
}

export interface Packed {
  w: number;
  h: number;
  /** Boxes of every descendant, relative to the packed item's top-left. */
  rel: Map<string, Box>;
}

/**
 * A subtree no connector touches is packed as a block: children in author order, in rows of
 * up to four, recursively. Zones inside an App Service plan, a pool of workers, a band of
 * shared services: designers draw these as ordered rows.
 */
export function pack(item: NItem): Packed {
  if (!isBoundary(item)) {
    const g = componentGeom(item);
    return { w: g.w, h: g.h, rel: new Map() };
  }
  const kids = item.items.map((child) => ({ child, packed: pack(child) }));
  const rel = new Map<string, Box>();
  const top = headerHeight(item);
  let y = top;
  let width = 0;
  for (let i = 0; i < kids.length; i += S.packPerRow) {
    const row = kids.slice(i, i + S.packPerRow);
    const rowH = Math.max(...row.map((k) => k.packed.h));
    let x = S.groupPad;
    for (const { child, packed } of row) {
      // Centre shorter siblings in their row so icons line up.
      const dy = Math.round((rowH - packed.h) / 2);
      rel.set(child.id, { x, y: y + dy, w: packed.w, h: packed.h });
      for (const [id, b] of packed.rel) rel.set(id, { x: x + b.x, y: y + dy + b.y, w: b.w, h: b.h });
      x += packed.w + S.packGap;
    }
    width = Math.max(width, x - S.packGap + S.groupPad);
    y += rowH + S.packGap;
  }
  return { w: Math.max(width, boundaryMinWidth(item)), h: kids.length ? y - S.packGap + S.groupPad : top + S.groupPad, rel };
}
