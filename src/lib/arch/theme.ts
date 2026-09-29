import type { TextStyle } from "@/lib/compose/theme";

/**
 * Sizes and spacing of the Architecture style. Every platform's style pack
 * (src/lib/arch/styles.ts) shares these, so measurement and layout don't depend on the
 * platform; packs vary colours, borders, header treatment and font families only.
 * Values follow docs/research/2026-09-29-architecture-diagram-conventions.md: 48 px icons
 * with the name centred below at 12–13 px, 11 px connector labels, 16–24 px group padding. Text runs one
 * step larger (14 / 12 px): the eval judges read whole pages scaled to fit, where 13 / 11 px looked small.
 */
export const ARCH_TYPE = {
  /** Component name under its icon. */
  name: { size: 14, weight: 400 } as TextStyle,
  /** Component detail line (SKU, count, version). */
  detail: { size: 12, weight: 400 } as TextStyle,
  /** Boundary name in its header. */
  boundary: { size: 14, weight: 600 } as TextStyle,
  /** Boundary facts (address range, region) under its name. */
  facts: { size: 12, weight: 400, mono: true } as TextStyle,
  /** Connector label. */
  edgeLabel: { size: 12, weight: 400 } as TextStyle,
  /** Page title and subtitle. */
  title: { size: 20, weight: 600 } as TextStyle,
  subtitle: { size: 13, weight: 400 } as TextStyle,
  /** Workflow, legend and assumptions blocks under the diagram. */
  sectionTitle: { size: 12, weight: 600 } as TextStyle,
  body: { size: 13, weight: 400 } as TextStyle,
  badge: { size: 11, weight: 700 } as TextStyle,
} as const;

export const ARCH_SPACE = {
  /** Service icon size. */
  icon: 48,
  /** Space above the icon, between icon and name, and under the last text line. */
  nodePadTop: 6,
  iconGap: 8,
  nodePadBottom: 6,
  nameLineHeight: 17,
  detailLineHeight: 15,
  /** Name wrap width; names wrap to at most two lines. */
  nameMaxWidth: 150,
  nodeMinWidth: 112,
  nodeSidePad: 8,
  /** Boundary header: icon size and height with and without a facts line. */
  headerIcon: 20,
  headerHeight: 40,
  headerHeightWithFacts: 54,
  groupPad: 20,
  /** Gap between packed siblings (rows of edge-free boundaries). */
  packGap: 24,
  /** Rows of at most this many children when packing edge-free boundaries. */
  packPerRow: 4,
  /** Gap between blocks and between the diagram and the page sections. */
  blockGap: 48,
  pageMargin: 32,
  /** Step badge diameter. */
  badge: 22,
  edgeLabelHeight: 16,
  edgeLabelPad: 5,
} as const;
