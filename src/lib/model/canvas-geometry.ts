import { containsBox, containsPoint, right, bottom } from "./geometry";
import { ancestors, descendants, indexModel, isGroup, isWithin } from "./query";
import type { Box, DiagramModel, Point } from "./types";

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Scale and offset of a viewBox drawn into a box with preserveAspectRatio "xMidYMid meet" (letterboxed). */
export function fitViewBox(rect: ClientRectLike, viewBox: Box): { scale: number; offsetX: number; offsetY: number } {
  if (rect.width === 0 || rect.height === 0 || viewBox.w === 0 || viewBox.h === 0) return { scale: 1, offsetX: rect.left, offsetY: rect.top };
  const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
  return {
    scale,
    offsetX: rect.left + (rect.width - viewBox.w * scale) / 2,
    offsetY: rect.top + (rect.height - viewBox.h * scale) / 2,
  };
}

export function clientToModel(clientPoint: Point, svgRect: ClientRectLike, viewBox: Box): Point {
  if (svgRect.width === 0 || svgRect.height === 0) return { x: viewBox.x, y: viewBox.y };
  const { scale, offsetX, offsetY } = fitViewBox(svgRect, viewBox);
  return {
    x: viewBox.x + (clientPoint.x - offsetX) / scale,
    y: viewBox.y + (clientPoint.y - offsetY) / scale,
  };
}

export function itemsInRect(model: DiagramModel, rect: Box): string[] {
  const ids: string[] = [];
  for (const node of model.nodes) {
    if (containsBox(rect, node.box)) ids.push(node.id);
  }
  for (const edge of model.edges) {
    if (edge.route.length > 0 && edge.route.every((point) => containsPoint(rect, point))) ids.push(edge.id);
  }
  return ids;
}

export function dropTargetAt(model: DiagramModel, point: Point, movingIds: string[]): string | null {
  const index = indexModel(model);
  const moving = new Set<string>();
  for (const id of movingIds) {
    const node = index.byId.get(id);
    if (!node) continue;
    moving.add(id);
    for (const child of descendants(index, id)) moving.add(child.id);
  }

  let best: { id: string; depth: number } | null = null;
  for (const node of model.nodes) {
    if (!isGroup(index, node.id) || moving.has(node.id) || !containsPoint(node.box, point)) continue;
    if (movingIds.some((id) => index.byId.has(id) && isWithin(index, node.id, id))) continue;
    const depth = ancestors(index, node.id).length;
    if (!best || depth > best.depth) best = { id: node.id, depth };
  }
  return best?.id ?? null;
}

export function resizeBox(box: Box, handle: ResizeHandle, dx: number, dy: number, minW: number, minH: number): Box {
  let x = box.x;
  let y = box.y;
  let w = box.w;
  let h = box.h;
  if (handle.includes("e")) w += dx;
  if (handle.includes("s")) h += dy;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  if (w < minW) {
    if (handle.includes("w")) x = right(box) - minW;
    w = minW;
  }
  if (h < minH) {
    if (handle.includes("n")) y = bottom(box) - minH;
    h = minH;
  }
  return { x, y, w, h };
}

export function nudgeDelta(key: string, shift: boolean): Point {
  const amount = shift ? 1 : 10;
  if (key === "ArrowLeft") return { x: -amount, y: 0 };
  if (key === "ArrowRight") return { x: amount, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -amount };
  if (key === "ArrowDown") return { x: 0, y: amount };
  return { x: 0, y: 0 };
}
