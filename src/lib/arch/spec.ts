/**
 * The Architecture spec: what a model writes to describe a system as a topology — components
 * with service icons and details, nested typed boundaries, connections with a meaning, numbered
 * step sequences, overlays for boundaries that span others, and assumptions. No coordinates:
 * the engine (src/lib/arch/layout.ts) decides every position. Conventions: docs/research/
 * 2026-09-29-architecture-diagram-conventions.md; guide: docs/architecture-guide.md.
 */

export const PLATFORMS = ["azure", "aws", "gcp", "kubernetes", "neutral"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const VIEWS = ["deployment", "network", "application", "dataflow", "context"] as const;
export type ArchView = (typeof VIEWS)[number];

/** Kinds of boundary. Each platform's style pack draws them in its own convention; others use `group`. */
export const BOUNDARY_KINDS = [
  "group",
  "shared",
  "cloud",
  "account",
  "subscription",
  "resource-group",
  "project",
  "region",
  "zone",
  "vnet",
  "vpc",
  "subnet",
  "public-subnet",
  "private-subnet",
  "security-group",
  "scaling-group",
  "cluster",
  "namespace",
  "node-pool",
  "onprem",
  "external",
] as const;
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number];

/** What a connection means; each meaning has one consistent line style in every platform. */
export const MEANINGS = ["request", "async", "replication", "private-link", "peering", "vpn", "monitoring", "management", "egress"] as const;
export type Meaning = (typeof MEANINGS)[number];

/** Badge shape of a step sequence: the first sequence uses circles, the second squares. */
export type BadgeShape = "circle" | "square";

// ---------------------------------------------------------------- input (lenient; see normalize.ts)

export interface ArchComponentInput {
  id?: string;
  name: string;
  icon?: string;
  /** One detail line: SKU or tier, instance count, runtime or version, port. */
  detail?: string;
}

export interface ArchBoundaryInput {
  type: "group";
  id?: string;
  kind?: BoundaryKind | string;
  name: string;
  /** Boundary facts shown in its header: address range, region, zone, namespace. */
  facts?: string;
  /** Style this boundary in another platform's convention (multi-cloud diagrams). */
  platform?: Platform;
  items: ArchItemInput[];
}

export type ArchItemInput = ArchComponentInput | ArchBoundaryInput;

export interface ArchConnectionInput {
  from: string;
  to: string;
  meaning?: Meaning | string;
  /** Protocol, port or purpose, e.g. "HTTPS 443". */
  label?: string;
  /** Step reference: "in.2", 2, or { sequence: "in", number: 2 }. */
  step?: string | number | { sequence?: string; number: number };
}

export interface ArchSequenceInput {
  id?: string;
  name?: string;
  steps: string[];
}

export interface ArchOverlayInput {
  id?: string;
  kind?: BoundaryKind | string;
  name: string;
  members: string[];
}

export interface ArchSpecInput {
  version?: 1;
  title: string;
  subtitle?: string;
  platform?: Platform;
  view?: ArchView;
  items: ArchItemInput[];
  connections?: ArchConnectionInput[];
  sequences?: ArchSequenceInput[];
  overlays?: ArchOverlayInput[];
  assumptions?: string[];
}

// ---------------------------------------------------------------- normalised (strict)

export interface NComponent {
  type: "component";
  id: string;
  name: string;
  /** A key of the icon registry (public/icons/manifest.json), when one matched. */
  icon?: string;
  detail?: string;
}

export interface NBoundary {
  type: "boundary";
  id: string;
  kind: BoundaryKind;
  name: string;
  facts?: string;
  platform?: Platform;
  items: NItem[];
}

export type NItem = NComponent | NBoundary;

export interface NStepRef {
  sequence: string;
  number: number;
}

export interface NConnection {
  from: string;
  to: string;
  meaning: Meaning;
  label?: string;
  step?: NStepRef;
}

export interface NSequence {
  id: string;
  name: string;
  badge: BadgeShape;
  steps: string[];
}

export interface NOverlay {
  id: string;
  kind: BoundaryKind;
  name: string;
  members: string[];
}

export interface NormalizedArchSpec {
  version: 1;
  title: string;
  subtitle?: string;
  platform?: Platform;
  view?: ArchView;
  items: NItem[];
  connections: NConnection[];
  sequences: NSequence[];
  overlays: NOverlay[];
  assumptions: string[];
}

export interface ArchNormalizeResult {
  spec: NormalizedArchSpec;
  warnings: string[];
}

/**
 * The v1 support envelope (origin R16): layouts inside it meet the hard constraints and the
 * time budget. Beyond it, layout degrades without losing content; beyond `hardCap*` the spec
 * is rejected (SpecError) and the canvas is left alone.
 */
export const ARCH_LIMITS = {
  components: 60,
  connections: 80,
  depth: 5,
  hardCapComponents: 240,
  hardCapConnections: 320,
  titleChars: 80,
  subtitleChars: 160,
  nameChars: 60,
  detailChars: 60,
  factsChars: 60,
  labelChars: 40,
  idChars: 48,
  sequences: 2,
  stepsPerSequence: 12,
  stepChars: 160,
  overlays: 4,
  assumptions: 6,
  assumptionChars: 120,
  /** Lines the pipeline adds on top of the model's assumptions, listing facts the request didn't state (arch/disclose.ts). */
  disclosureLines: 2,
} as const;

/** Starts each assumption line the pipeline adds to list facts the request didn't state (arch/disclose.ts). */
export const PROPOSED_PREFIX = "Proposed, not in the request: ";

export const isBoundary = (item: NItem): item is NBoundary => item.type === "boundary";

/** Every item in reading order (depth first, author order). */
export function allItems(items: NItem[]): NItem[] {
  return items.flatMap((item) => (isBoundary(item) ? [item, ...allItems(item.items)] : [item]));
}
