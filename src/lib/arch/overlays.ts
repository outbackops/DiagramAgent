import type { Box, DiagramModel, DiagramNode } from "@/lib/model/types";
import { titleBox } from "./measure";
import type { NOverlay } from "./spec";

/** Overlays hug their members closely so they stay clear of the headers above them. */
export const OVERLAY_PAD = 6;

export interface OverlayGeometry {
  overlay: NOverlay;
  /** Members' current boxes plus padding. */
  box: Box;
  /** False when the box would enclose a component that isn't a member or cut a boundary's title: then members get tags instead. */
  clean: boolean;
  /** Node ids (paths) of the members. */
  memberIds: string[];
}

/**
 * Where an overlay (a boundary that spans others, e.g. an Auto Scaling group across two
 * Availability Zones) is drawn: around its members' current boxes, so it follows hand moves.
 * Shared by the layout (scoring), the renderer and the exports.
 */
export function overlayGeometry(model: DiagramModel, overlay: NOverlay): OverlayGeometry | null {
  const members = model.nodes.filter((n) => n.arch && overlay.members.includes(n.arch.id));
  if (members.length < 2) return null;
  const box = overlayBox(members.map((m) => m.box));
  const memberIds = members.map((m) => m.id);
  const clean =
    !model.nodes.some((n) => isComponentLike(n) && !memberIds.includes(n.id) && intersects(box, n.box)) &&
    !model.nodes.some((n) => n.container && !n.generated && intersects(box, titleBox({ name: n.label, facts: n.arch?.facts }, n.box)));
  return { overlay, box, clean, memberIds };
}

export function overlayGeometries(model: DiagramModel): OverlayGeometry[] {
  return (model.arch?.overlays ?? []).map((o) => overlayGeometry(model, o)).filter((g): g is OverlayGeometry => Boolean(g));
}

export function overlayBox(members: Box[]): Box {
  const x1 = Math.min(...members.map((b) => b.x)) - OVERLAY_PAD;
  const y1 = Math.min(...members.map((b) => b.y)) - OVERLAY_PAD;
  const x2 = Math.max(...members.map((b) => b.x + b.w)) + OVERLAY_PAD;
  const y2 = Math.max(...members.map((b) => b.y + b.h)) + OVERLAY_PAD;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function isComponentLike(node: DiagramNode): boolean {
  return !node.container && !node.generated;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
