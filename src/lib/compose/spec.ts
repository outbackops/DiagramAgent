import type { Tone } from "@/lib/model/types";

/**
 * The composition spec: the language models (and people) write to describe
 * an architecture diagram. It is semantic — structure, text and intent, no
 * coordinates. `normalizeSpec` (normalize.ts) turns untrusted input into a
 * `NormalizedSpec`; the engine (layout.ts) lays that out as a DiagramModel;
 * `modelToSpec` (from-model.ts) derives a spec back from any model.
 *
 * Documented for models in src/lib/compose/prompt.ts and for people in
 * docs/composition-guide.md.
 */

export type ColumnSize = "narrow" | "normal" | "wide";
export type ConnectorKind = "flow" | "call";

/** A service, system or actor. */
export interface SpecCard {
  type: "card";
  id?: string;
  title: string;
  /** Short body lines (what it is, what it holds). */
  lines?: string[];
  /** A muted footnote at the bottom (constraints, security posture). */
  note?: string;
  tone?: Tone;
  /** Icon key from the vendored set (e.g. "azure-key-vault"). */
  icon?: string;
  /** Flows (letters, ids or titles) that use this service; drawn as chips instead of lines. */
  usedBy?: string[];
}

/** Cards laid out in a grid of 2–3 columns. */
export interface SpecGrid {
  type: "grid";
  id?: string;
  columns?: number;
  items: SpecCard[];
}

/** A full-width strip of context across a column (hosting, network, runtime). */
export interface SpecBanner {
  type: "banner";
  id?: string;
  title: string;
  text?: string;
  tone?: Tone;
}

/** A boundary that contains components: a VNet or subnet, a cluster or namespace, an account or region. */
export interface SpecZone {
  type: "zone";
  id?: string;
  title: string;
  /** Boundary facts in monospace, e.g. an address range or namespace. */
  subtitle?: string;
  /** Short pill after the title, e.g. "PRIVATE". */
  tag?: string;
  tone?: Tone;
  /** Card columns inside the zone (1–3, default 2). */
  columns?: number;
  items: SpecCard[];
  notes?: string[];
}

export interface SpecStep {
  id?: string;
  title: string;
  lines?: string[];
  tone?: Tone;
  icon?: string;
}

/** One end-to-end path: a lettered lane with a row of steps. */
export interface SpecFlow {
  type: "flow";
  id?: string;
  /** Letter badge; assigned A, B, C… when absent. */
  label?: string;
  title: string;
  /** Trigger or entry point, shown in monospace (route, function, topic). */
  subtitle?: string;
  /** Short pill after the title, e.g. "ALWAYS ON". */
  tag?: string;
  tone?: Tone;
  steps: SpecStep[];
  /** One-line invariants shown under the steps. */
  notes?: string[];
  chips?: { label?: string; items: string[] };
}

export type SpecItem = SpecCard | SpecGrid | SpecBanner | SpecZone | SpecFlow;

export interface SpecColumn {
  id?: string;
  title: string;
  size?: ColumnSize;
  items: SpecItem[];
}

export interface SpecConnector {
  /** Item or step reference: id, `flow.step`, or exact title. A flow means its first (to) or last (from) step. */
  from: string;
  to: string;
  kind?: ConnectorKind;
  label?: string;
  tone?: Tone;
}

export interface SpecFooter {
  title?: string;
  text: string;
  status?: string;
  statusDetail?: string;
}

export interface CompositionSpec {
  version?: 1;
  title: string;
  subtitle?: string;
  badge?: { title: string; detail?: string };
  columns: SpecColumn[];
  connectors?: SpecConnector[];
  footer?: SpecFooter;
}

// ---------------------------------------------------------------------------
// Normalised form: every id present, slugged and globally unique; tones and
// flow letters resolved; connector ends resolved to model node ids.
// ---------------------------------------------------------------------------

export interface NCard {
  type: "card";
  id: string;
  title: string;
  lines: string[];
  note?: string;
  tone: Tone;
  /** Vendored icon key (validated). */
  icon?: string;
  /** Flow letters. */
  usedBy: string[];
}

export interface NGrid {
  type: "grid";
  id: string;
  columns: number;
  items: NCard[];
}

export interface NBanner {
  type: "banner";
  id: string;
  title: string;
  text?: string;
  tone: Tone;
}

export interface NZone {
  type: "zone";
  id: string;
  title: string;
  subtitle?: string;
  tag?: string;
  tone: Tone;
  columns: number;
  items: NCard[];
  notes: string[];
}

export interface NStep {
  id: string;
  title: string;
  lines: string[];
  tone: Tone;
  icon?: string;
}

export interface NFlow {
  type: "flow";
  id: string;
  label: string;
  title: string;
  subtitle?: string;
  tag?: string;
  tone: Tone;
  steps: NStep[];
  notes: string[];
  chips?: { label?: string; items: string[] };
}

export type NItem = NCard | NGrid | NBanner | NZone | NFlow;

export interface NColumn {
  id: string;
  title: string;
  size: ColumnSize;
  items: NItem[];
}

export interface NConnector {
  /** Model node id (D2 path) of a card, step, banner or lane. */
  from: string;
  to: string;
  kind: ConnectorKind;
  label?: string;
  tone?: Tone;
}

export interface NormalizedSpec {
  title: string;
  subtitle?: string;
  badge?: { title: string; detail?: string };
  columns: NColumn[];
  connectors: NConnector[];
  footer?: SpecFooter;
}

/** Hard limits. Beyond these, content is dropped with a warning. */
export const SPEC_LIMITS = {
  columns: 4,
  itemsPerColumn: 10,
  gridItems: 9,
  gridColumns: 3,
  zoneItems: 9,
  steps: 6,
  linesPerCard: 5,
  linesPerStep: 3,
  notesPerFlow: 3,
  chips: 8,
  connectors: 24,
  titleChars: 60,
  subtitleChars: 140,
  lineChars: 90,
  noteChars: 140,
  chipChars: 40,
  labelChars: 60,
  idChars: 40,
} as const;

/** Model node ids of the page header and footer. */
export const HEADER_ID = "header";
export const FOOTER_ID = "footer";

/** The spec is unusable (no title and no items, or not JSON at all). */
export class SpecError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "SpecError";
    this.issues = issues;
  }
}
