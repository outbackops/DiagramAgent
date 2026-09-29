import { setArchTitle } from "@/lib/arch/edit";
import { boxesOverlap, bottom, containsBox, polylineHitsBox, right, unionBoxes } from "./geometry";
import { ancestors, descendants, ensureParentsFirst, indexModel, isGroup, isWithin, joinPath, keyOf, renumberEdges, uniqueKey } from "./query";
import type { Box, DiagramEdge, DiagramModel, DiagramNode, EdgeStyle, NodeStyle, Point } from "./types";

const GROUP_PADDING = 24;
const GROUP_GAP = 40;
const PLACEMENT_GAP = 12;
const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: "#ffffff",
  stroke: "#757575",
  strokeWidth: 1,
  borderRadius: 6,
  fontSize: 16,
  bold: true,
  fontColor: "#424242",
};
const DEFAULT_GROUP_STYLE: NodeStyle = {
  fill: "#f5f5f5",
  stroke: "#9e9e9e",
  strokeWidth: 2,
  borderRadius: 8,
  fontSize: 20,
  bold: true,
};
const DEFAULT_EDGE_STYLE: EdgeStyle = { stroke: "#757575", strokeWidth: 2, fontSize: 14, fontColor: "#424242" };

export interface AddNodeOptions {
  parent: string | null;
  label: string;
  icon?: string;
  shape?: string;
  near?: string;
  at?: Point;
}

export interface AddGroupOptions {
  parent: string | null;
  label: string;
  wrap?: string[];
  at?: Point;
}

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
type Axis = "horizontal" | "vertical";

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function topHeadroom(node: DiagramNode): number {
  return (node.labelSize?.h ?? (node.style.fontSize ?? 20) * 1.3) + GROUP_PADDING;
}

function contentOrigin(group: DiagramNode): Point {
  return { x: group.box.x + GROUP_PADDING, y: group.box.y + topHeadroom(group) };
}

function cloneWithNode(model: DiagramModel, id: string, update: (node: DiagramNode) => DiagramNode): DiagramModel {
  let changed = false;
  const nodes = model.nodes.map((node) => {
    if (node.id !== id) return node;
    changed = true;
    return update(node);
  });
  return changed ? { ...model, nodes } : model;
}

function shiftNodeIds(model: DiagramModel, ids: Set<string>, dx: number, dy: number): DiagramModel {
  if (dx === 0 && dy === 0) return model;
  return {
    ...model,
    nodes: model.nodes.map((node) => (ids.has(node.id) ? { ...node, box: { ...node.box, x: node.box.x + dx, y: node.box.y + dy } } : node)),
  };
}

function subtreeIds(model: DiagramModel, roots: Iterable<string>): Set<string> {
  const index = indexModel(model);
  const ids = new Set<string>();
  for (const id of roots) {
    const node = index.byId.get(id);
    if (!node || ids.has(id)) continue;
    ids.add(id);
    for (const child of descendants(index, id)) ids.add(child.id);
  }
  return ids;
}

function minimalRootIds(model: DiagramModel, ids: string[]): string[] {
  const index = indexModel(model);
  return [...new Set(ids)]
    .filter((id) => index.byId.has(id))
    .filter((id) => !ancestors(index, id).some((ancestor) => ids.includes(ancestor.id)));
}

function siblingNodes(model: DiagramModel, parent: string | null): DiagramNode[] {
  return model.nodes.filter((node) => node.parent === parent);
}

function neededGroupBox(model: DiagramModel, group: DiagramNode): Box {
  const children = siblingNodes(model, group.id);
  if (children.length === 0) return group.box;
  const minChildX = Math.min(...children.map((child) => child.box.x));
  const minChildY = Math.min(...children.map((child) => child.box.y));
  const maxChildRight = Math.max(...children.map((child) => right(child.box)));
  const maxChildBottom = Math.max(...children.map((child) => bottom(child.box)));
  const x = minChildX < group.box.x ? minChildX - GROUP_PADDING : group.box.x;
  const y = minChildY < group.box.y ? minChildY - GROUP_PADDING : group.box.y;
  const groupRight = maxChildRight > right(group.box) ? maxChildRight + GROUP_PADDING : right(group.box);
  const groupBottom = maxChildBottom > bottom(group.box) ? maxChildBottom + GROUP_PADDING : bottom(group.box);
  return {
    x,
    y,
    w: groupRight - x,
    h: groupBottom - y,
  };
}

function shiftSiblingsForGrowth(model: DiagramModel, group: DiagramNode, oldBox: Box, newBox: Box): DiagramModel {
  const rightGrowth = Math.max(0, right(newBox) - right(oldBox));
  const bottomGrowth = Math.max(0, bottom(newBox) - bottom(oldBox));
  const leftGrowth = Math.max(0, oldBox.x - newBox.x);
  const topGrowth = Math.max(0, oldBox.y - newBox.y);
  if (rightGrowth === 0 && bottomGrowth === 0 && leftGrowth === 0 && topGrowth === 0) return model;
  const shifts = new Map<string, Point>();
  for (const sibling of siblingNodes(model, group.parent)) {
    if (sibling.id === group.id) continue;
    let sx = 0;
    let sy = 0;
    const verticalOverlap = sibling.box.y < bottom(newBox) && bottom(sibling.box) > newBox.y;
    const horizontalOverlap = sibling.box.x < right(newBox) && right(sibling.box) > newBox.x;
    if (rightGrowth > 0 && sibling.box.x >= right(oldBox) && verticalOverlap) sx = rightGrowth;
    if (leftGrowth > 0 && right(sibling.box) <= oldBox.x && verticalOverlap) sx = -leftGrowth;
    if (bottomGrowth > 0 && sibling.box.y >= bottom(oldBox) && horizontalOverlap) sy = bottomGrowth;
    if (topGrowth > 0 && bottom(sibling.box) <= oldBox.y && horizontalOverlap) sy = -topGrowth;
    if (sx !== 0 || sy !== 0) shifts.set(sibling.id, { x: sx, y: sy });
  }
  if (shifts.size === 0) return model;
  const index = indexModel(model);
  const all = new Map<string, Point>();
  for (const [id, shift] of shifts) {
    all.set(id, shift);
    for (const child of descendants(index, id)) all.set(child.id, shift);
  }
  return {
    ...model,
    nodes: model.nodes.map((node) => {
      const shift = all.get(node.id);
      return shift ? { ...node, box: { ...node.box, x: node.box.x + shift.x, y: node.box.y + shift.y } } : node;
    }),
  };
}

function groupIdsToCheck(model: DiagramModel, changedIds: Iterable<string>): Set<string> {
  const index = indexModel(model);
  const ids = new Set<string>();
  for (const id of changedIds) {
    if (isGroup(index, id)) ids.add(id);
    for (const ancestor of ancestors(index, id)) ids.add(ancestor.id);
  }
  return ids;
}

export function growGroupsAndMakeRoom(model: DiagramModel, changedIds: Iterable<string> = []): DiagramModel {
  const check = groupIdsToCheck(model, changedIds);
  if (check.size === 0) return model;
  let current = model;
  let changed = true;
  let guard = 0;
  while (changed && guard < 100) {
    changed = false;
    guard += 1;
    const groups = [...current.nodes].filter((node) => node.container && check.has(node.id)).reverse();
    for (const group of groups) {
      const fresh = current.nodes.find((node) => node.id === group.id);
      if (!fresh) continue;
      const needed = neededGroupBox(current, fresh);
      if (sameBox(needed, fresh.box)) continue;
      const oldBox = fresh.box;
      current = cloneWithNode(current, fresh.id, (node) => ({ ...node, box: needed }));
      current = shiftSiblingsForGrowth(current, { ...fresh, box: needed }, oldBox, needed);
      changed = true;
    }
  }
  return current;
}

function makeRoomForExplicitGroupGrowth(prev: DiagramModel, next: DiagramModel): DiagramModel {
  let current = next;
  const nextIndex = indexModel(next);
  for (const oldNode of prev.nodes) {
    if (!oldNode.container) continue;
    const newNode = nextIndex.byId.get(oldNode.id);
    if (!newNode) continue;
    if (newNode.box.w === oldNode.box.w && newNode.box.h === oldNode.box.h) continue;
    if (newNode.box.x < oldNode.box.x || newNode.box.y < oldNode.box.y || right(newNode.box) > right(oldNode.box) || bottom(newNode.box) > bottom(oldNode.box)) {
      current = shiftSiblingsForGrowth(current, newNode, oldNode.box, newNode.box);
    }
  }
  return current;
}

function labelMinWidth(node: DiagramNode, label: string): number {
  return (node.style.fontSize ?? 16) * 0.6 * label.length + 24;
}

function routeIgnores(index: ReturnType<typeof indexModel>, edge: DiagramEdge, boxId: string): boolean {
  return boxId === edge.from || boxId === edge.to || ancestors(index, edge.from).some((node) => node.id === boxId) || ancestors(index, edge.to).some((node) => node.id === boxId);
}

export function clearAffectedRoutes(prev: DiagramModel, next: DiagramModel): DiagramModel {
  const prevIndex = indexModel(prev);
  const nextIndex = indexModel(next);
  const changedBoxes = next.nodes.filter((node) => {
    const old = prevIndex.byId.get(node.id);
    return !old || !sameBox(old.box, node.box);
  });
  if (changedBoxes.length === 0) return next;
  const changedIds = new Set(changedBoxes.map((node) => node.id));
  // A re-routed line needs its label and badges placed again, so their old spots go with the old route.
  const unrouted = (edge: DiagramEdge): DiagramEdge => {
    const next = { ...edge, route: [] };
    delete next.labelAt;
    if (next.badges) next.badges = next.badges.map(({ sequence, number }) => ({ sequence, number }));
    return next;
  };
  const edges = next.edges.map((edge) => {
    if (edge.route.length === 0) return edge;
    if (changedIds.has(edge.from) || changedIds.has(edge.to)) return unrouted(edge);
    for (const node of changedBoxes) {
      if (!routeIgnores(nextIndex, edge, node.id) && polylineHitsBox(edge.route, node.box)) return unrouted(edge);
    }
    return edge;
  });
  return edges.some((edge, i) => edge !== next.edges[i]) ? { ...next, edges } : next;
}

/** Reparenting renames nodes in place and new groups are inserted early; restore the parents-first order. */
function withParentsFirst(model: DiagramModel): DiagramModel {
  const nodes = ensureParentsFirst(model.nodes);
  return nodes && nodes !== model.nodes ? { ...model, nodes } : model;
}

function finalizePositionChange(prev: DiagramModel, draft: DiagramModel): DiagramModel {
  const ordered = withParentsFirst(draft);
  const prevIndex = indexModel(prev);
  const changedIds = ordered.nodes.filter((node) => {
    const old = prevIndex.byId.get(node.id);
    return !old || !sameBox(old.box, node.box);
  }).map((node) => node.id);
  const grown = growGroupsAndMakeRoom(makeRoomForExplicitGroupGrowth(prev, ordered), changedIds);
  return clearAffectedRoutes(prev, { ...grown, handArranged: true });
}

function finalizeNonPositionChange(prev: DiagramModel, draft: DiagramModel): DiagramModel {
  return clearAffectedRoutes(prev, withParentsFirst(draft));
}

function clampIntoParent(model: DiagramModel, node: DiagramNode, parent: string | null): Point {
  if (parent === null) return { x: node.box.x, y: node.box.y };
  const group = indexModel(model).byId.get(parent);
  if (!group) return { x: node.box.x, y: node.box.y };
  const origin = contentOrigin(group);
  const maxX = Math.max(origin.x, right(group.box) - GROUP_PADDING - node.box.w);
  const maxY = Math.max(origin.y, bottom(group.box) - GROUP_PADDING - node.box.h);
  return { x: Math.min(Math.max(node.box.x, origin.x), maxX), y: Math.min(Math.max(node.box.y, origin.y), maxY) };
}

function commonBy<T>(items: T[], fallback: T): T {
  if (items.length === 0) return fallback;
  const counts = new Map<string, { item: T; count: number }>();
  for (const item of items) {
    const key = JSON.stringify(item);
    const entry = counts.get(key);
    counts.set(key, { item, count: (entry?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.item ?? fallback;
}

function leafStyleFor(model: DiagramModel, parent: string | null): { style: NodeStyle; labelPosition?: string; iconPosition?: string; shape: string } {
  const index = indexModel(model);
  const sibling = model.nodes.find((node) => node.parent === parent && !isGroup(index, node.id));
  if (sibling) return { style: sibling.style, labelPosition: sibling.labelPosition, iconPosition: sibling.iconPosition, shape: sibling.shape };
  const leaves = model.nodes.filter((node) => !isGroup(index, node.id));
  const style = commonBy(leaves.map((node) => node.style), DEFAULT_NODE_STYLE);
  return { style, labelPosition: "INSIDE_TOP_CENTER", iconPosition: "INSIDE_MIDDLE_CENTER", shape: "rectangle" };
}

function groupStyleFor(model: DiagramModel, parent: string | null): NodeStyle {
  const depth = parent ? parent.split(".").length + 1 : 1;
  const sameDepth = model.nodes.filter((node) => node.container && node.id.split(".").length === depth);
  if (sameDepth[0]) return sameDepth[0].style;
  return model.nodes.find((node) => node.container)?.style ?? DEFAULT_GROUP_STYLE;
}

function translateRoot(model: DiagramModel, rootId: string, x: number, y: number): DiagramModel {
  const root = indexModel(model).byId.get(rootId);
  if (!root) return model;
  const ids = subtreeIds(model, [rootId]);
  return shiftNodeIds(model, ids, x - root.box.x, y - root.box.y);
}

function candidateFits(model: DiagramModel, id: string, x: number, y: number, requireWithinParent = false): boolean {
  const index = indexModel(model);
  const node = index.byId.get(id);
  if (!node) return false;
  const box = { ...node.box, x, y };
  if (requireWithinParent && node.parent) {
    const parent = index.byId.get(node.parent);
    if (parent && !containsBox(parent.box, box)) return false;
  }
  const siblings = siblingNodes(model, node.parent).filter((sibling) => sibling.id !== id);
  return siblings.every((sibling) => !boxesOverlap(box, { x: sibling.box.x - PLACEMENT_GAP, y: sibling.box.y - PLACEMENT_GAP, w: sibling.box.w + PLACEMENT_GAP * 2, h: sibling.box.h + PLACEMENT_GAP * 2 }));
}

function placementCandidates(anchor: DiagramNode, node: DiagramNode): Point[] {
  return [
    { x: right(anchor.box) + GROUP_GAP, y: anchor.box.y },
    { x: anchor.box.x, y: bottom(anchor.box) + GROUP_GAP },
    { x: anchor.box.x - GROUP_GAP - node.box.w, y: anchor.box.y },
    { x: anchor.box.x, y: anchor.box.y - GROUP_GAP - node.box.h },
  ];
}

function fallbackPlacement(model: DiagramModel, node: DiagramNode, parent: DiagramNode | undefined): Point {
  const siblings = siblingNodes(model, node.parent).filter((sibling) => sibling.id !== node.id);
  if (siblings.length === 0) return parent ? contentOrigin(parent) : { x: 0, y: 0 };
  const bounds = unionBoxes(siblings.map((sibling) => sibling.box));
  if (!bounds) return parent ? contentOrigin(parent) : { x: 0, y: 0 };
  const rightPoint = { x: right(bounds) + GROUP_GAP, y: bounds.y };
  const belowPoint = { x: bounds.x, y: bottom(bounds) + GROUP_GAP };
  if (!parent) return rightPoint;
  const parentAspect = parent.box.w / Math.max(1, parent.box.h);
  const aspectWith = (point: Point) => {
    const placed = { ...node.box, x: point.x, y: point.y };
    const next = unionBoxes([...siblings.map((sibling) => sibling.box), placed]);
    return next ? next.w / Math.max(1, next.h) : parentAspect;
  };
  return Math.abs(aspectWith(rightPoint) - parentAspect) <= Math.abs(aspectWith(belowPoint) - parentAspect) ? rightPoint : belowPoint;
}

export function placeNear(model: DiagramModel, id: string, anchorIds: string[]): DiagramModel {
  const index = indexModel(model);
  const node = index.byId.get(id);
  if (!node) return model;
  for (const anchorId of anchorIds) {
    const anchor = index.byId.get(anchorId);
    if (!anchor) continue;
    const requireWithinParent = node.parent !== null && anchor.parent !== node.parent;
    for (const point of placementCandidates(anchor, node)) {
      if (candidateFits(model, id, point.x, point.y, requireWithinParent)) return translateRoot(model, id, point.x, point.y);
    }
  }
  const parent = node.parent ? index.byId.get(node.parent) : undefined;
  const fallback = fallbackPlacement(model, node, parent);
  if (candidateFits(model, id, fallback.x, fallback.y)) return translateRoot(model, id, fallback.x, fallback.y);
  const start = parent ? contentOrigin(parent) : { x: Math.max(0, ...model.nodes.filter((n) => n.parent === null && n.id !== id).map((n) => right(n.box) + GROUP_GAP)), y: 0 };
  const limitX = parent ? right(parent.box) - GROUP_PADDING : start.x + 2000;
  const limitY = parent ? bottom(parent.box) - GROUP_PADDING : start.y + 2000;
  for (let y = start.y; y <= limitY; y += GROUP_GAP) {
    for (let x = start.x; x <= limitX; x += GROUP_GAP) {
      if (candidateFits(model, id, x, y)) return translateRoot(model, id, x, y);
    }
  }
  return translateRoot(model, id, fallback.x, fallback.y);
}

/** Architecture page projections (title, workflow, legend, assumptions) are regenerated, never edited as shapes. */
function editableIds(model: DiagramModel, ids: string[]): string[] {
  const generated = new Set(model.nodes.filter((n) => n.generated).map((n) => n.id));
  return generated.size ? ids.filter((id) => !generated.has(id)) : ids;
}

export function moveItems(model: DiagramModel, ids: string[], dx: number, dy: number): DiagramModel {
  const roots = minimalRootIds(model, editableIds(model, ids));
  const moved = subtreeIds(model, roots);
  const draft = shiftNodeIds(model, moved, dx, dy);
  return finalizePositionChange(model, draft);
}

export function reparent(model: DiagramModel, id: string, newParent: string | null, at?: Point): { model: DiagramModel; id: string } {
  const index = indexModel(model);
  const node = index.byId.get(id);
  if (!node || node.generated || (newParent !== null && index.byId.get(newParent)?.generated)) return { model, id };
  if (newParent !== null && (!isGroup(index, newParent) || isWithin(index, newParent, id))) return { model, id };
  const siblingKeys = siblingNodes(model, newParent).filter((sibling) => sibling.id !== id).map((sibling) => keyOf(sibling.id));
  const key = uniqueKey(keyOf(id), siblingKeys);
  const newId = joinPath(newParent, key);
  const oldIds = [node, ...descendants(index, id)];
  const idMap = new Map<string, string>();
  for (const item of oldIds) idMap.set(item.id, item.id === id ? newId : `${newId}${item.id.slice(id.length)}`);
  let draft: DiagramModel = {
    ...model,
    nodes: model.nodes.map((item) => {
      const mapped = idMap.get(item.id);
      if (!mapped) return item;
      const parent = item.id === id ? newParent : idMap.get(item.parent ?? "") ?? item.parent;
      return { ...item, id: mapped, parent };
    }),
    edges: renumberEdges(model.edges.map((edge) => ({ ...edge, from: idMap.get(edge.from) ?? edge.from, to: idMap.get(edge.to) ?? edge.to }))),
  };
  const renamed = indexModel(draft).byId.get(newId);
  if (renamed) {
    const target = at ?? clampIntoParent(draft, renamed, newParent);
    draft = translateRoot(draft, newId, target.x, target.y);
  }
  return { model: finalizePositionChange(model, draft), id: newId };
}

export function resizeGroup(model: DiagramModel, id: string, box: Box): DiagramModel {
  const index = indexModel(model);
  const group = index.byId.get(id);
  if (!group || !isGroup(index, id)) return model;
  const children = siblingNodes(model, id);
  const childBox = unionBoxes(children.map((child) => child.box));
  const minW = childBox ? right(childBox) - box.x + GROUP_PADDING : 0;
  const minH = childBox ? bottom(childBox) - box.y + GROUP_PADDING : 0;
  const draft = cloneWithNode(model, id, (node) => ({ ...node, box: { ...box, w: Math.max(box.w, minW), h: Math.max(box.h, minH, topHeadroom(node) + GROUP_PADDING) } }));
  return finalizePositionChange(model, draft);
}

export function deleteItems(model: DiagramModel, ids: string[]): DiagramModel {
  ids = editableIds(model, ids);
  const nodeIds = ids.filter((id) => indexModel(model).byId.has(id));
  const deleting = subtreeIds(model, nodeIds);
  const edgeIds = new Set(ids.filter((id) => indexModel(model).edgeById.has(id)));
  const draft = {
    ...model,
    nodes: model.nodes.filter((node) => !deleting.has(node.id)),
    edges: renumberEdges(model.edges.filter((edge) => !edgeIds.has(edge.id) && !deleting.has(edge.from) && !deleting.has(edge.to))),
  };
  return finalizeNonPositionChange(model, draft);
}

export function renameItem(model: DiagramModel, id: string, label: string): DiagramModel {
  const index = indexModel(model);
  const node = index.byId.get(id);
  if (node?.generated) return node.role === "title" ? setArchTitle(model, label) : model;
  if (node) {
    const minWidth = labelMinWidth(node, label);
    const draft = cloneWithNode(model, id, (item) => ({ ...item, label, box: { ...item.box, w: Math.max(item.box.w, minWidth) } }));
    return finalizeNonPositionChange(model, growGroupsAndMakeRoom(draft, [id]));
  }
  const edge = index.edgeById.get(id);
  if (!edge) return model;
  return { ...model, edges: model.edges.map((item) => (item.id === id ? { ...item, label } : item)) };
}

export function setIcon(model: DiagramModel, id: string, icon: string | undefined): DiagramModel {
  return cloneWithNode(model, id, (node) => ({ ...node, icon }));
}

export function addNode(model: DiagramModel, opts: AddNodeOptions): { model: DiagramModel; id: string } {
  const index = indexModel(model);
  if (opts.parent !== null && !isGroup(index, opts.parent)) return { model, id: "" };
  const key = uniqueKey(opts.label, siblingNodes(model, opts.parent).map((node) => keyOf(node.id)));
  const id = joinPath(opts.parent, key);
  const template = leafStyleFor(model, opts.parent);
  const size = opts.icon ? { w: 110, h: 118 } : { w: 140, h: 60 };
  const node: DiagramNode = {
    id,
    parent: opts.parent,
    label: opts.label,
    icon: opts.icon,
    shape: opts.shape ?? template.shape,
    box: { x: opts.at?.x ?? 0, y: opts.at?.y ?? 0, ...size },
    style: template.style,
    container: false,
    labelPosition: template.labelPosition,
    iconPosition: opts.icon ? (template.iconPosition ?? "INSIDE_MIDDLE_CENTER") : template.iconPosition,
  };
  let draft: DiagramModel = { ...model, nodes: [...model.nodes, node] };
  if (opts.at) {
    const placed = indexModel(draft).byId.get(id);
    if (placed) {
      const point = clampIntoParent(draft, placed, opts.parent);
      draft = translateRoot(draft, id, point.x, point.y);
    }
  } else {
    const anchors = opts.near ? [opts.near] : siblingNodes(model, opts.parent).map((item) => item.id);
    draft = placeNear(draft, id, anchors);
  }
  return { model: finalizePositionChange(model, draft), id };
}

export function addGroup(model: DiagramModel, opts: AddGroupOptions): { model: DiagramModel; id: string } {
  const index = indexModel(model);
  if (opts.parent !== null && !isGroup(index, opts.parent)) return { model, id: "" };
  const wrap = opts.wrap ? minimalRootIds(model, opts.wrap) : [];
  const wrapped = wrap.map((id) => index.byId.get(id)).filter((node): node is DiagramNode => Boolean(node));
  if (wrapped.length > 0 && !wrapped.every((node) => node.parent === wrapped[0]?.parent)) return { model, id: "" };
  const parent = wrapped[0]?.parent ?? opts.parent;
  const key = uniqueKey(opts.label, siblingNodes(model, parent).map((node) => keyOf(node.id)));
  const id = joinPath(parent, key);
  const wrappedBox = unionBoxes(wrapped.map((node) => node.box));
  const style = groupStyleFor(model, parent);
  const group: DiagramNode = {
    id,
    parent,
    label: opts.label,
    shape: "rectangle",
    box: wrappedBox
      ? { x: wrappedBox.x - GROUP_PADDING, y: wrappedBox.y - topHeadroom({ id, parent, label: opts.label, shape: "rectangle", box: { x: 0, y: 0, w: 0, h: 0 }, style, container: true }), w: wrappedBox.w + GROUP_PADDING * 2, h: wrappedBox.h + GROUP_PADDING + topHeadroom({ id, parent, label: opts.label, shape: "rectangle", box: { x: 0, y: 0, w: 0, h: 0 }, style, container: true }) }
      : { x: opts.at?.x ?? 0, y: opts.at?.y ?? 0, w: 320, h: 220 },
    style,
    container: true,
    labelPosition: "INSIDE_TOP_LEFT",
  };
  const wrapSet = new Set(wrap);
  const map = new Map<string, string>();
  for (const root of wrap) {
    const rootNode = index.byId.get(root);
    if (!rootNode) continue;
    const newRoot = joinPath(id, keyOf(root));
    map.set(root, newRoot);
    for (const child of descendants(index, root)) map.set(child.id, `${newRoot}${child.id.slice(root.length)}`);
  }
  let inserted = false;
  const nodes: DiagramNode[] = [];
  for (const node of model.nodes) {
    if (!inserted && (wrapSet.has(node.id) || wrapped.length === 0)) {
      nodes.push(group);
      inserted = true;
    }
    const mapped = map.get(node.id);
    if (mapped) nodes.push({ ...node, id: mapped, parent: wrapSet.has(node.id) ? id : map.get(node.parent ?? "") ?? node.parent });
    else nodes.push(node);
  }
  if (!inserted) nodes.push(group);
  let draft: DiagramModel = {
    ...model,
    nodes,
    edges: renumberEdges(model.edges.map((edge) => ({ ...edge, from: map.get(edge.from) ?? edge.from, to: map.get(edge.to) ?? edge.to }))),
  };
  if (!wrappedBox && !opts.at) draft = placeNear(draft, id, siblingNodes(model, parent).map((node) => node.id));
  return { model: finalizePositionChange(model, draft), id };
}

export function connect(model: DiagramModel, from: string, to: string, label?: string): { model: DiagramModel; id: string } {
  if (from === to) return { model, id: "" };
  const index = indexModel(model);
  if (!index.byId.has(from) || !index.byId.has(to) || index.byId.get(from)?.generated || index.byId.get(to)?.generated) return { model, id: "" };
  const style = commonBy(model.edges.map((edge) => edge.style), DEFAULT_EDGE_STYLE);
  const [edge] = renumberEdges([...model.edges, { id: "", from, to, label, srcArrow: "none", dstArrow: "triangle", style, route: [] }]).slice(-1);
  return { model: { ...model, edges: [...model.edges, edge] }, id: edge.id };
}

export function alignItems(model: DiagramModel, ids: string[], mode: AlignMode): DiagramModel {
  const roots = minimalRootIds(model, editableIds(model, ids));
  const index = indexModel(model);
  const nodes = roots.map((id) => index.byId.get(id)).filter((node): node is DiagramNode => Boolean(node));
  if (nodes.length < 2) return model;
  const target = mode === "left" ? Math.min(...nodes.map((n) => n.box.x)) : mode === "center" ? nodes.reduce((sum, n) => sum + n.box.x + n.box.w / 2, 0) / nodes.length : mode === "right" ? Math.max(...nodes.map((n) => right(n.box))) : mode === "top" ? Math.min(...nodes.map((n) => n.box.y)) : mode === "middle" ? nodes.reduce((sum, n) => sum + n.box.y + n.box.h / 2, 0) / nodes.length : Math.max(...nodes.map((n) => bottom(n.box)));
  let draft = model;
  for (const node of nodes) {
    const dx = mode === "left" ? target - node.box.x : mode === "center" ? target - (node.box.x + node.box.w / 2) : mode === "right" ? target - right(node.box) : 0;
    const dy = mode === "top" ? target - node.box.y : mode === "middle" ? target - (node.box.y + node.box.h / 2) : mode === "bottom" ? target - bottom(node.box) : 0;
    draft = shiftNodeIds(draft, subtreeIds(draft, [node.id]), dx, dy);
  }
  return finalizePositionChange(model, draft);
}

export function distributeItems(model: DiagramModel, ids: string[], axis: Axis): DiagramModel {
  const roots = minimalRootIds(model, editableIds(model, ids));
  const index = indexModel(model);
  const nodes = roots.map((id) => index.byId.get(id)).filter((node): node is DiagramNode => Boolean(node));
  if (nodes.length < 3) return model;
  const sorted = [...nodes].sort((a, b) => (axis === "horizontal" ? a.box.x - b.box.x : a.box.y - b.box.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((sum, node) => sum + (axis === "horizontal" ? node.box.w : node.box.h), 0);
  const span = axis === "horizontal" ? right(last.box) - first.box.x : bottom(last.box) - first.box.y;
  const gap = (span - total) / (sorted.length - 1);
  let cursor = axis === "horizontal" ? first.box.x : first.box.y;
  let draft = model;
  for (const node of sorted) {
    const desired = cursor;
    const dx = axis === "horizontal" ? desired - node.box.x : 0;
    const dy = axis === "vertical" ? desired - node.box.y : 0;
    draft = shiftNodeIds(draft, subtreeIds(draft, [node.id]), dx, dy);
    cursor += (axis === "horizontal" ? node.box.w : node.box.h) + gap;
  }
  return finalizePositionChange(model, draft);
}
