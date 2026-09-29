/**
 * The editable diagram model: the single source of truth for the canvas,
 * exports, quality checks and vision review.
 *
 * Conventions shared by every module in src/lib/model:
 * - Coordinates are absolute (not relative to the parent group), in px.
 * - A node's `id` is always its D2 path (`parent.child`), so D2 export and
 *   re-import keep ids stable. Operations that change a node's parent rename
 *   the ids of its subtree and of the edges touching it.
 * - Models are immutable: operations return a new model.
 * - `nodes` is ordered parents-before-children (render order). `edges` keep
 *   their original order.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface NodeStyle {
  /** CSS colour; undefined means transparent. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** D2 semantics: 0 = solid, otherwise the dash length. */
  strokeDash?: number;
  borderRadius?: number;
  opacity?: number;
  shadow?: boolean;
  multiple?: boolean;
  doubleBorder?: boolean;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface EdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  /** D2 semantics: 0 = solid, otherwise the dash length. */
  strokeDash?: number;
  opacity?: number;
  /** Corner rounding at bends. */
  borderRadius?: number;
  animated?: boolean;
  fontSize?: number;
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
}

/** D2 arrowhead names. */
export type Arrowhead =
  | "none"
  | "arrow"
  | "triangle"
  | "unfilled-triangle"
  | "diamond"
  | "filled-diamond"
  | "circle"
  | "filled-circle"
  | "box"
  | "filled-box"
  | "line"
  | "cross"
  | "cf-one"
  | "cf-many"
  | "cf-one-required"
  | "cf-many-required";

/** Layout hints carried through D2 export so a Tidy up reproduces the author's intent. */
export interface LayoutHints {
  direction?: "up" | "down" | "left" | "right";
  gridRows?: number;
  gridColumns?: number;
  gridGap?: number;
}

export interface DiagramNode {
  /** Stable, unique; always the D2 path (e.g. `Subscription.AppVNet.Web`). */
  id: string;
  /** Id of the containing group, or null at the top level. */
  parent: string | null;
  label: string;
  /** D2 shape type: rectangle, cylinder, queue, person, cloud, image, ... */
  shape: string;
  /** Icon URL: a vendored `/icons/<key>.svg` path or a `data:image/...` URI. */
  icon?: string;
  /** Absolute position and size. */
  box: Box;
  style: NodeStyle;
  /** True for groups (containers), including empty ones. */
  container: boolean;
  /** D2 placement name, e.g. `INSIDE_TOP_CENTER` or `OUTSIDE_BOTTOM_CENTER`. */
  labelPosition?: string;
  iconPosition?: string;
  /** Measured label size when known (from D2), used for label placement. */
  labelSize?: Size;
  /** D2 classes the node had when imported; used to keep D2 export concise. */
  classes?: string[];
  layout?: LayoutHints;
  tooltip?: string;
  link?: string;
}

export interface DiagramEdge {
  /** Stable, unique; D2 style `(from -> to)[n]`. */
  id: string;
  from: string;
  to: string;
  label?: string;
  labelSize?: Size;
  srcArrow: Arrowhead;
  dstArrow: Arrowhead;
  style: EdgeStyle;
  /** Absolute polyline from the `from` border to the `to` border; empty means it needs routing. */
  route: Point[];
}

export interface DiagramModel {
  version: 1;
  /** Top-level layout hints (e.g. `direction: right`). */
  layout?: LayoutHints;
  /** Parents before children. */
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /**
   * Set when the user has moved or resized items by hand since the last full
   * layout; "Apply suggested fixes" warns before re-laying out such a diagram.
   */
  handArranged?: boolean;
}

export const MODEL_VERSION = 1 as const;

export function emptyModel(): DiagramModel {
  return { version: MODEL_VERSION, nodes: [], edges: [] };
}
