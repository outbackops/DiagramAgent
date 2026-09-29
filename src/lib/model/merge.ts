import { polylineHitsBox } from "./geometry";
import { clearAffectedRoutes, growGroupsAndMakeRoom, placeNear } from "./ops";
import { ancestors, indexModel, keyOf } from "./query";
import type { Box, DiagramModel, DiagramNode } from "./types";

export { placeNear };

export interface MergeStableResult {
  model: DiagramModel;
  added: string[];
  regrouped: string[];
  removed: string[];
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameParentPrev(prevByKeyLabel: Map<string, DiagramNode[]>, node: DiagramNode): DiagramNode | undefined {
  const candidates = prevByKeyLabel.get(`${keyOf(node.id)}\u0000${node.label}`) ?? [];
  return candidates.find((candidate) => candidate.parent !== node.parent);
}

function parentStable(prev: DiagramModel, node: DiagramNode): boolean {
  const prevNode = indexModel(prev).byId.get(node.id);
  return Boolean(prevNode && prevNode.parent === node.parent);
}

function edgeAnchors(model: DiagramModel, id: string): string[] {
  const anchors: string[] = [];
  for (const edge of model.edges) {
    if (edge.from === id) anchors.push(edge.to);
    if (edge.to === id) anchors.push(edge.from);
  }
  return anchors;
}

function routeCrossesBoxes(route: { x: number; y: number }[], boxes: DiagramNode[], model: DiagramModel, from: string, to: string): boolean {
  const index = indexModel(model);
  for (const node of boxes) {
    const ignored = node.id === from || node.id === to || ancestors(index, from).some((ancestor) => ancestor.id === node.id) || ancestors(index, to).some((ancestor) => ancestor.id === node.id);
    if (!ignored && polylineHitsBox(route, node.box)) return true;
  }
  return false;
}

function sizeGroupsToChildren(model: DiagramModel): DiagramModel {
  return growGroupsAndMakeRoom(model);
}

export function mergeStable(prev: DiagramModel, next: DiagramModel): MergeStableResult {
  const prevIndex = indexModel(prev);
  const nextIds = new Set(next.nodes.map((node) => node.id));
  const removed = prev.nodes.filter((node) => !nextIds.has(node.id)).map((node) => node.id);
  const prevByKeyLabel = new Map<string, DiagramNode[]>();
  for (const node of prev.nodes) {
    const key = `${keyOf(node.id)}\u0000${node.label}`;
    prevByKeyLabel.set(key, [...(prevByKeyLabel.get(key) ?? []), node]);
  }

  const added: string[] = [];
  const regrouped: string[] = [];
  const stableNodes = next.nodes.map((node) => {
    const previous = prevIndex.byId.get(node.id);
    if (previous && previous.parent === node.parent) return { ...node, box: previous.box };
    if (sameParentPrev(prevByKeyLabel, node)) regrouped.push(node.id);
    else added.push(node.id);
    return node;
  });

  let draft: DiagramModel = { ...next, nodes: stableNodes, handArranged: prev.handArranged };
  for (const node of draft.nodes) {
    if (!added.includes(node.id) && !regrouped.includes(node.id)) continue;
    const anchors = edgeAnchors(next, node.id).filter((anchor) => parentStable(prev, indexModel(draft).byId.get(anchor) ?? { ...node, id: anchor }));
    draft = placeNear(draft, node.id, anchors);
  }
  draft = sizeGroupsToChildren(draft);

  const draftIndex = indexModel(draft);
  const movedOrAdded = draft.nodes.filter((node) => {
    const previous = prevIndex.byId.get(node.id);
    return !previous || !sameBox(previous.box, node.box);
  });
  const edges = draft.edges.map((edge) => {
    const previous = prevIndex.edgeById.get(edge.id);
    const endpointsMoved = movedOrAdded.some((node) => node.id === edge.from || node.id === edge.to);
    if (!previous || endpointsMoved || routeCrossesBoxes(previous.route, movedOrAdded, draft, edge.from, edge.to)) return { ...edge, route: [] };
    const fromExists = draftIndex.byId.has(edge.from);
    const toExists = draftIndex.byId.has(edge.to);
    return fromExists && toExists ? { ...edge, route: previous.route } : { ...edge, route: [] };
  });
  draft = clearAffectedRoutes(prev, { ...draft, edges, handArranged: prev.handArranged });
  return { model: draft, added, regrouped, removed };
}
