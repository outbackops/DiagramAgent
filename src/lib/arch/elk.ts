import type { ELK, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";

/** The part of an ELK instance the engine uses; tests inject failing or recording fakes. */
export type ElkLike = Pick<ELK, "layout">;

let shared: Promise<ElkLike> | null = null;

/**
 * ELK (elkjs, EPL-2.0) is ~1.6 MB, so it is imported on first use: in the browser it becomes a
 * separate chunk, loaded only when an Architecture diagram is laid out. A failed load is not
 * cached, so the next layout retries.
 */
export function loadElk(): Promise<ElkLike> {
  shared ??= import("elkjs/lib/elk.bundled.js")
    .then((mod) => {
      const Ctor = ((mod as unknown as { default?: unknown }).default ?? mod) as new () => ELK;
      return new Ctor();
    })
    .catch((err: unknown) => {
      shared = null;
      throw err;
    });
  return shared;
}

export async function runElk(elk: ElkLike, graph: ElkNode): Promise<ElkNode> {
  return elk.layout(graph) as Promise<ElkNode>;
}

/** Shared by every candidate: layered, hierarchical, orthogonal, spacious. */
export const BASE_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
  "elk.edgeLabels.placement": "CENTER",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

/**
 * Author order as a tie-breaker and cycle breaker. Only on the root graph: set on child graphs,
 * these options crash ELK 0.12 (spike finding, docs/spikes/2026-09-29-architecture-layout-spike.md).
 */
export const ORDERED_OPTIONS: LayoutOptions = {
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
};

export interface FlatCandidate {
  id: string;
  options: LayoutOptions;
  /** Also try without the author-order options when this one throws. */
  ordered: boolean;
}

const dir = (direction: "RIGHT" | "DOWN", placement: "NETWORK_SIMPLEX" | "BRANDES_KOEPF"): LayoutOptions => ({
  "elk.direction": direction,
  "elk.layered.nodePlacement.strategy": placement,
});

/**
 * Whole-graph candidates. MULTI_EDGE wrapping folds long flows into rows; SINGLE_EDGE
 * wrapping is left out because it crashed ELK in the spike. The `greedy` variants use ELK's
 * default cycle breaking, so a spec listed in reverse still reads left to right.
 */
export const FLAT_CANDIDATES: FlatCandidate[] = [
  { id: "right-bk", options: dir("RIGHT", "BRANDES_KOEPF"), ordered: true },
  { id: "right-ns", options: dir("RIGHT", "NETWORK_SIMPLEX"), ordered: true },
  { id: "down-ns", options: dir("DOWN", "NETWORK_SIMPLEX"), ordered: true },
  { id: "wrap", options: { ...dir("RIGHT", "NETWORK_SIMPLEX"), "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" }, ordered: true },
  { id: "right-greedy", options: dir("RIGHT", "BRANDES_KOEPF"), ordered: false },
];

export interface HybridCandidate {
  id: string;
  /** Direction inside each top-level block. */
  inner: "RIGHT" | "DOWN";
  /** Options for placing the blocks. */
  outer: LayoutOptions;
}

/**
 * Large diagrams (see LARGE_DIAGRAM) try only the candidates that win on the acceptance fixtures;
 * every ELK run costs a few hundred milliseconds at that size, and layout must stay near two seconds.
 */
export const LARGE_CANDIDATE_IDS: ReadonlySet<string> = new Set(["right-bk", "right-ns", "right-greedy", "blocks-right", "blocks-inner-down"]);

/** Top-level blocks laid out separately, then placed as boxes; for diagrams with 3+ blocks. */
export const HYBRID_CANDIDATES: HybridCandidate[] = [
  { id: "blocks-right", inner: "RIGHT", outer: { "elk.direction": "RIGHT" } },
  { id: "blocks-wrap", inner: "RIGHT", outer: { "elk.direction": "RIGHT", "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" } },
  { id: "blocks-down", inner: "RIGHT", outer: { "elk.direction": "DOWN" } },
  { id: "blocks-inner-down", inner: "DOWN", outer: { "elk.direction": "RIGHT", "elk.layered.wrapping.strategy": "MULTI_EDGE", "elk.aspectRatio": "1.6" } },
];
