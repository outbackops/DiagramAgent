import { parseSpecText } from "@/lib/compose/normalize";
import { SpecError } from "@/lib/compose/spec";
import { iconRegistry } from "@/lib/icon-registry";
import {
  ARCH_LIMITS,
  BOUNDARY_KINDS,
  MEANINGS,
  PLATFORMS,
  VIEWS,
  allItems,
  isBoundary,
  type ArchNormalizeResult,
  type ArchView,
  type BoundaryKind,
  type Meaning,
  type NBoundary,
  type NComponent,
  type NConnection,
  type NItem,
  type NOverlay,
  type NSequence,
  type NStepRef,
  type NormalizedArchSpec,
  type Platform,
} from "./spec";

type JsonRecord = Record<string, unknown>;

/**
 * Lenient normaliser for Architecture specs (origin R17/R18). Aliases, missing optional values
 * and unresolved references are repaired with a warning; nothing is dropped silently. Input
 * that can't be repaired — an empty topology, containment cycles, ids that would merge two
 * items, input beyond the absolute cap — throws SpecError, so callers keep the current canvas.
 */
export function normalizeArchSpec(raw: unknown): ArchNormalizeResult {
  if (!isRecord(raw)) throw new SpecError("The spec must be a JSON object");
  const warnings: string[] = [];
  const ctx: Ctx = { warnings, explicitIds: new Map(), used: new Set(), platform: normalizePlatform(valueOf(raw, ["platform", "provider", "cloud"]), warnings) };
  checkFields(raw, FIELDS.root, "spec", warnings);

  const title = text(valueOf(raw, ["title", "name"]), ARCH_LIMITS.titleChars, warnings, "title") ?? "Architecture";
  if (!valueOf(raw, ["title", "name"])) warnings.push("Missing title; using Architecture");

  const rawItems = arrayOf(raw, ["items", "components", "nodes", "resources", "elements"]);
  if (rawItems.length === 0) throw new SpecError("The spec has no components", ["Add components under items"]);
  const items = rawItems.map((item) => normalizeItem(item, ctx, 1)).filter((item): item is NItem => Boolean(item));
  const nested = applyParentAliases(items, rawItems, ctx);
  const components = allItems(nested).filter((i) => !isBoundary(i));
  if (components.length === 0) throw new SpecError("The spec has no components", ["Add at least one component (an item without child items)"]);
  if (components.length > ARCH_LIMITS.hardCapComponents) throw new SpecError(`The spec has ${components.length} components; the limit is ${ARCH_LIMITS.hardCapComponents}`, ["Split the system into several diagrams"]);
  if (components.length > ARCH_LIMITS.components) warnings.push(`${components.length} components exceed the ${ARCH_LIMITS.components}-component envelope; the layout may be less tidy`);
  const depth = maxDepth(nested);
  if (depth > ARCH_LIMITS.depth) warnings.push(`Boundaries nest ${depth} deep; beyond ${ARCH_LIMITS.depth} the layout may be less tidy`);

  const refs = buildRefs(nested);
  const sequences = normalizeSequences(raw, warnings);
  const connections = normalizeConnections(raw, refs, sequences, warnings);
  const overlays = normalizeOverlays(raw, refs, ctx);
  const assumptions = arrayOf(raw, ["assumptions", "assumed"])
    .slice(0, ARCH_LIMITS.assumptions)
    .map((a) => text(a, ARCH_LIMITS.assumptionChars, warnings, "assumption"))
    .filter((a): a is string => Boolean(a));
  if (arrayOf(raw, ["assumptions", "assumed"]).length > ARCH_LIMITS.assumptions) warnings.push(`Dropped assumptions beyond ${ARCH_LIMITS.assumptions}`);

  const spec: NormalizedArchSpec = { version: 1, title, items: nested, connections, sequences, overlays, assumptions };
  const subtitle = text(valueOf(raw, ["subtitle", "description", "summary"]), ARCH_LIMITS.subtitleChars, warnings, "subtitle");
  if (subtitle) spec.subtitle = subtitle;
  if (ctx.platform) spec.platform = ctx.platform;
  const view = normalizeView(valueOf(raw, ["view", "diagramType", "type"]), warnings);
  if (view) spec.view = view;
  return { spec, warnings: [...new Set(warnings)] };
}

export function normalizeArchSpecText(textValue: string): ArchNormalizeResult {
  return normalizeArchSpec(parseSpecText(textValue));
}

/** True when a parsed value looks like an Architecture spec rather than a Poster (composition) spec. */
export function isArchSpecShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.columns) || Array.isArray(value.sections)) return false;
  // Poster specs call their links `connectors`; Architecture specs call them `connections`.
  if (Array.isArray(value.connectors) && !Array.isArray(value.connections)) return false;
  return ["items", "components", "nodes", "resources"].some((key) => Array.isArray(value[key])) && (Array.isArray(value.connections) || Array.isArray(value.edges) || Array.isArray(value.links) || "platform" in value || "view" in value || containsGroup(value));
}

// ---------------------------------------------------------------- items

interface Ctx {
  warnings: string[];
  /** Explicit ids by slug, to reject two different items claiming one id. */
  explicitIds: Map<string, string>;
  used: Set<string>;
  platform?: Platform;
}

const FIELDS = {
  root: ["version", "$schema", "title", "name", "subtitle", "description", "summary", "platform", "provider", "cloud", "view", "diagramType", "type", "items", "components", "nodes", "resources", "elements", "connections", "edges", "links", "flows", "sequences", "workflow", "steps", "overlays", "spans", "assumptions", "assumed"],
  component: ["type", "id", "name", "title", "label", "icon", "detail", "details", "sku", "description", "parent", "group", "in", "boundary"],
  boundary: ["type", "id", "kind", "name", "title", "label", "facts", "cidr", "subtitle", "platform", "provider", "items", "children", "nodes", "components", "parent", "group", "in", "boundary"],
  connection: ["from", "source", "to", "target", "meaning", "kind", "type", "label", "protocol", "title", "step"],
  sequence: ["id", "name", "title", "steps", "items"],
  overlay: ["id", "kind", "type", "name", "title", "label", "members", "items"],
} as const;

function normalizeItem(raw: unknown, ctx: Ctx, depth: number): NItem | undefined {
  if (!isRecord(raw)) {
    if (typeof raw === "string" && raw.trim()) raw = { name: raw };
    else {
      ctx.warnings.push("Dropped an item that is not an object");
      return undefined;
    }
  }
  const record = raw as JsonRecord;
  const children = arrayOf(record, ["items", "children", "nodes", "components"]);
  const typeText = String(valueOf(record, ["type"]) ?? "").toLowerCase();
  const kindValue = valueOf(record, ["kind"]);
  const looksBoundary = typeText === "group" || typeText === "boundary" || Array.isArray(valueOf(record, ["items", "children", "nodes", "components"])) || (kindValue !== undefined && kindOf(String(kindValue)) !== undefined);
  const name = text(valueOf(record, ["name", "title", "label"]), ARCH_LIMITS.nameChars, ctx.warnings, looksBoundary ? "boundary name" : "component name");
  const explicit = valueOf(record, ["id"]);

  if (looksBoundary && children.length > 0) {
    checkFields(record, FIELDS.boundary, "boundary", ctx.warnings);
    const id = claimId(explicit, name, "group", ctx);
    const kind = normalizeKind(kindValue, ctx.warnings);
    const boundary: NBoundary = { type: "boundary", id, kind, name: name ?? id, items: [] };
    if (!name) ctx.warnings.push(`Boundary ${id} has no name; using its id`);
    const facts = text(valueOf(record, ["facts", "cidr", "subtitle"]), ARCH_LIMITS.factsChars, ctx.warnings, "boundary facts");
    if (facts) boundary.facts = facts;
    const platform = normalizePlatform(valueOf(record, ["platform", "provider"]), ctx.warnings);
    if (platform) boundary.platform = platform;
    boundary.items = children.map((child) => normalizeItem(child, ctx, depth + 1)).filter((item): item is NItem => Boolean(item));
    if (boundary.items.length === 0) return asComponent(record, name, explicit, ctx, `Converted empty boundary ${boundary.name} to a component`);
    parentAlias.set(boundary, record);
    return boundary;
  }
  if (looksBoundary) return asComponent(record, name, explicit, ctx, `Converted empty boundary ${name ?? String(explicit ?? "")} to a component`.trim());
  checkFields(record, FIELDS.component, "component", ctx.warnings);
  const component = componentOf(record, name, explicit, ctx);
  parentAlias.set(component, record);
  return component;
}

/** Raw records of normalised items, to read their `parent` alias afterwards. */
const parentAlias = new WeakMap<NItem, JsonRecord>();

function asComponent(record: JsonRecord, name: string | undefined, explicit: unknown, ctx: Ctx, warning: string): NComponent {
  ctx.warnings.push(warning);
  const component = componentOf(record, name, explicit, ctx);
  if (!component.detail) {
    const facts = text(valueOf(record, ["facts", "cidr", "subtitle"]), ARCH_LIMITS.detailChars, ctx.warnings, "component detail");
    if (facts) component.detail = facts;
  }
  parentAlias.set(component, record);
  return component;
}

function componentOf(record: JsonRecord, name: string | undefined, explicit: unknown, ctx: Ctx): NComponent {
  const id = claimId(explicit, name, "component", ctx);
  if (!name) ctx.warnings.push(`Component ${id} has no name; using its id`);
  const component: NComponent = { type: "component", id, name: name ?? id };
  const icon = resolveIcon(valueOf(record, ["icon"]), name, ctx);
  if (icon) component.icon = icon;
  const detail = text(valueOf(record, ["detail", "details", "sku", "description"]), ARCH_LIMITS.detailChars, ctx.warnings, "component detail");
  if (detail) component.detail = detail;
  return component;
}

/**
 * Ids are global. An explicit id is kept (as a slug); two different items with the same
 * explicit id would merge, which can't be repaired. Derived ids (from names) get a suffix.
 */
function claimId(explicit: unknown, name: string | undefined, fallback: string, ctx: Ctx): string {
  const explicitText = typeof explicit === "string" || typeof explicit === "number" ? String(explicit).trim() : "";
  if (explicitText) {
    const id = slugify(explicitText).slice(0, ARCH_LIMITS.idChars) || fallback;
    const prior = ctx.explicitIds.get(id);
    if (prior !== undefined) throw new SpecError(`Two items share the id "${id}"`, [`"${prior}" and "${explicitText}" would merge into one; give each item its own id`]);
    ctx.explicitIds.set(id, explicitText);
    if (ctx.used.has(id)) throw new SpecError(`Two items share the id "${id}"`, [`An item named like "${explicitText}" already uses it; give each item its own id`]);
    ctx.used.add(id);
    return id;
  }
  const base = slugify(name ?? "").slice(0, ARCH_LIMITS.idChars) || fallback;
  let id = base;
  for (let i = 2; ctx.used.has(id) || ctx.explicitIds.has(id); i++) id = `${base}-${i}`;
  ctx.used.add(id);
  return id;
}

/**
 * The flat form: an item may name its boundary with `parent` (or `group`, `in`, `boundary`)
 * instead of being nested. Nesting wins when both are given; cycles can't be repaired.
 */
function applyParentAliases(items: NItem[], _raw: unknown[], ctx: Ctx): NItem[] {
  const byId = new Map(allItems(items).map((item) => [item.id, item]));
  const parentOf = new Map<string, string | null>();
  const walk = (list: NItem[], parent: string | null) => {
    for (const item of list) {
      parentOf.set(item.id, parent);
      if (isBoundary(item)) walk(item.items, item.id);
    }
  };
  walk(items, null);
  const moves: Array<{ item: NItem; to: NBoundary }> = [];
  for (const item of allItems(items)) {
    const record = parentAlias.get(item);
    const alias = record ? valueOf(record, ["parent", "group", "in", "boundary"]) : undefined;
    if (typeof alias !== "string" || !alias.trim()) continue;
    const target = byId.get(slugify(alias)) ?? [...byId.values()].find((candidate) => isBoundary(candidate) && candidate.name.toLowerCase() === alias.trim().toLowerCase());
    if (!target || !isBoundary(target)) {
      ctx.warnings.push(`Ignored unknown parent "${alias}" of ${item.id}`);
      continue;
    }
    const current = parentOf.get(item.id) ?? null;
    if (current === target.id) continue;
    if (current !== null) {
      ctx.warnings.push(`${item.id} is nested in ${current} but names ${target.id} as its parent; kept the nesting`);
      continue;
    }
    moves.push({ item, to: target });
  }
  if (moves.length === 0) return items;
  // Apply moves and reject containment cycles.
  const moved = new Set(moves.map((m) => m.item.id));
  let top = items.filter((item) => !moved.has(item.id));
  for (const { item, to } of moves) {
    let p: string | null = to.id;
    const seen = new Set<string>([item.id]);
    while (p) {
      if (seen.has(p)) throw new SpecError("Boundaries contain each other", [`${item.id} and ${to.id} form a containment cycle`]);
      seen.add(p);
      p = moves.find((m) => m.item.id === p)?.to.id ?? parentOf.get(p) ?? null;
    }
    to.items.push(item);
  }
  top = top.filter((item) => !moved.has(item.id));
  return top;
}

function maxDepth(items: NItem[], depth = 1): number {
  return Math.max(depth - 1, ...items.map((item) => (isBoundary(item) ? maxDepth(item.items, depth + 1) : depth - 1)), 0);
}

// ---------------------------------------------------------------- references

interface RefIndex {
  byId: Map<string, NItem>;
  byName: Map<string, NItem[]>;
}

function buildRefs(items: NItem[]): RefIndex {
  const byId = new Map<string, NItem>();
  const byName = new Map<string, NItem[]>();
  for (const item of allItems(items)) {
    byId.set(item.id, item);
    const key = item.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }
  return { byId, byName };
}

function resolveRef(ref: unknown, refs: RefIndex, warnings: string[]): NItem | undefined {
  if (typeof ref !== "string" && typeof ref !== "number") return undefined;
  const value = String(ref).trim();
  if (!value) return undefined;
  const exact = refs.byId.get(value);
  if (exact) return exact;
  // Names before slugged ids: "Web server" must not silently pick the first of two web servers.
  const named = refs.byName.get(value.toLowerCase());
  if (named?.length) {
    if (named.length > 1) warnings.push(`Ambiguous reference "${value}" matches ${named.length} items; used ${named[0].id} (use an id)`);
    return named[0];
  }
  return refs.byId.get(slugify(value)) ?? refs.byId.get(slugify(value.split(".").at(-1) ?? value));
}

// ---------------------------------------------------------------- connections, steps, overlays

function normalizeSequences(raw: JsonRecord, warnings: string[]): NSequence[] {
  let list = arrayOf(raw, ["sequences"]);
  const flat = valueOf(raw, ["workflow", "steps"]);
  if (list.length === 0 && Array.isArray(flat) && flat.length > 0) list = [{ id: "main", name: "Workflow", steps: flat }];
  const out: NSequence[] = [];
  const used = new Set<string>();
  for (const value of list) {
    if (!isRecord(value)) continue;
    if (out.length >= ARCH_LIMITS.sequences) {
      warnings.push(`Dropped step sequences beyond ${ARCH_LIMITS.sequences}`);
      break;
    }
    checkFields(value, FIELDS.sequence, "sequence", warnings);
    const name = text(valueOf(value, ["name", "title"]), ARCH_LIMITS.nameChars, warnings, "sequence name") ?? (out.length === 0 ? "Workflow" : "Second flow");
    let id = slugify(String(valueOf(value, ["id"]) ?? name)) || `flow-${out.length + 1}`;
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    const rawSteps = arrayOf(value, ["steps", "items"]);
    if (rawSteps.length > ARCH_LIMITS.stepsPerSequence) warnings.push(`Dropped steps beyond ${ARCH_LIMITS.stepsPerSequence} in ${name}`);
    const steps = rawSteps
      .slice(0, ARCH_LIMITS.stepsPerSequence)
      .map((s) => text(isRecord(s) ? valueOf(s, ["text", "description", "name"]) : s, ARCH_LIMITS.stepChars, warnings, "step"))
      .filter((s): s is string => Boolean(s));
    out.push({ id, name, badge: out.length === 0 ? "circle" : "square", steps });
  }
  return out;
}

function normalizeConnections(raw: JsonRecord, refs: RefIndex, sequences: NSequence[], warnings: string[]): NConnection[] {
  const list = arrayOf(raw, ["connections", "edges", "links", "flows"]);
  if (list.length > ARCH_LIMITS.hardCapConnections) throw new SpecError(`The spec has ${list.length} connections; the limit is ${ARCH_LIMITS.hardCapConnections}`, ["Split the system into several diagrams"]);
  if (list.length > ARCH_LIMITS.connections) warnings.push(`${list.length} connections exceed the ${ARCH_LIMITS.connections}-connection envelope; the layout may be less tidy`);
  const out: NConnection[] = [];
  const seen = new Map<string, NConnection>();
  for (const value of list) {
    if (!isRecord(value)) continue;
    checkFields(value, FIELDS.connection, "connection", warnings);
    const fromRaw = valueOf(value, ["from", "source"]);
    const toRaw = valueOf(value, ["to", "target"]);
    const from = resolveRef(fromRaw, refs, warnings);
    const to = resolveRef(toRaw, refs, warnings);
    if (!from || !to) {
      warnings.push(`Dropped connection with unresolved endpoint ${String(!from ? fromRaw : toRaw)}`);
      continue;
    }
    if (from.id === to.id) {
      warnings.push(`Dropped self-loop connection on ${from.id}`);
      continue;
    }
    const meaning = normalizeMeaning(valueOf(value, ["meaning", "kind", "type"]), warnings);
    const key = `${from.id}\u0000${to.id}\u0000${meaning}`;
    const label = text(valueOf(value, ["label", "protocol", "title"]), ARCH_LIMITS.labelChars, warnings, "connection label");
    const prior = seen.get(key);
    if (prior) {
      warnings.push(`Merged duplicate connection ${from.id} → ${to.id}`);
      if (!prior.label && label) prior.label = label;
      continue;
    }
    const connection: NConnection = { from: from.id, to: to.id, meaning };
    if (label) connection.label = label;
    const step = normalizeStepRef(valueOf(value, ["step"]), sequences, warnings);
    if (step) connection.step = step;
    seen.set(key, connection);
    out.push(connection);
  }
  return out;
}

function normalizeStepRef(value: unknown, sequences: NSequence[], warnings: string[]): NStepRef | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let sequence: string | undefined;
  let number: number | undefined;
  if (typeof value === "number") number = value;
  else if (typeof value === "string") {
    const match = value.trim().match(/^(?:([A-Za-z][\w-]*)[.:#])?(\d{1,2})$/);
    if (match) {
      sequence = match[1] ? slugify(match[1]) : undefined;
      number = Number(match[2]);
    }
  } else if (isRecord(value)) {
    const n = Number(valueOf(value, ["number", "step", "n"]));
    if (Number.isFinite(n)) number = n;
    const s = valueOf(value, ["sequence", "flow"]);
    if (typeof s === "string") sequence = slugify(s);
  }
  if (!number || number < 1 || !Number.isInteger(number)) {
    warnings.push(`Dropped unreadable step reference ${JSON.stringify(value)}`);
    return undefined;
  }
  if (sequences.length === 0) sequences.push({ id: "main", name: "Workflow", badge: "circle", steps: [] });
  let target = sequence ? sequences.find((s) => s.id === sequence) : sequences[0];
  if (!target) {
    warnings.push(`Unknown step sequence "${sequence}"; used ${sequences[0].id}`);
    target = sequences[0];
  }
  if (number > target.steps.length) warnings.push(`Step ${target.id}.${number} has no description in the workflow`);
  return { sequence: target.id, number };
}

function normalizeOverlays(raw: JsonRecord, refs: RefIndex, ctx: Ctx): NOverlay[] {
  const list = arrayOf(raw, ["overlays", "spans"]);
  const out: NOverlay[] = [];
  for (const value of list) {
    if (!isRecord(value)) continue;
    if (out.length >= ARCH_LIMITS.overlays) {
      ctx.warnings.push(`Dropped overlays beyond ${ARCH_LIMITS.overlays}`);
      break;
    }
    checkFields(value, FIELDS.overlay, "overlay", ctx.warnings);
    const name = text(valueOf(value, ["name", "title", "label"]), ARCH_LIMITS.nameChars, ctx.warnings, "overlay name") ?? "Group";
    const members: string[] = [];
    for (const member of arrayOf(value, ["members", "items"])) {
      const item = resolveRef(member, refs, ctx.warnings);
      if (!item) ctx.warnings.push(`Dropped unknown overlay member ${String(member)} from ${name}`);
      else if (!members.includes(item.id)) members.push(item.id);
    }
    if (members.length < 2) {
      ctx.warnings.push(`Dropped overlay ${name}: it needs at least two members`);
      continue;
    }
    const kindRaw = valueOf(value, ["kind", "type"]);
    const kind = kindRaw === undefined ? "scaling-group" : normalizeKind(kindRaw, ctx.warnings);
    let id = slugify(String(valueOf(value, ["id"]) ?? name)) || "overlay";
    while (ctx.used.has(id)) id = `${id}-2`;
    ctx.used.add(id);
    out.push({ id, kind, name, members });
  }
  return out;
}

// ---------------------------------------------------------------- vocabularies

const KIND_ALIASES: Record<string, BoundaryKind> = {
  boundary: "group",
  generic: "group",
  "shared-services": "shared",
  "cross-cutting": "shared",
  "aws-cloud": "cloud",
  "azure-cloud": "cloud",
  "google-cloud": "cloud",
  "gcp-cloud": "cloud",
  "aws-account": "account",
  "azure-subscription": "subscription",
  rg: "resource-group",
  resourcegroup: "resource-group",
  "gcp-project": "project",
  "google-project": "project",
  "azure-region": "region",
  "aws-region": "region",
  "gcp-region": "region",
  az: "zone",
  "availability-zone": "zone",
  "availability-zones": "zone",
  "virtual-network": "vnet",
  "azure-vnet": "vnet",
  "aws-vpc": "vpc",
  "gcp-vpc": "vpc",
  "subnetwork": "subnet",
  "public-subnetwork": "public-subnet",
  "private-subnetwork": "private-subnet",
  sg: "security-group",
  "auto-scaling-group": "scaling-group",
  "autoscaling-group": "scaling-group",
  asg: "scaling-group",
  vmss: "scaling-group",
  "instance-group": "scaling-group",
  "managed-instance-group": "scaling-group",
  "k8s-cluster": "cluster",
  "kubernetes-cluster": "cluster",
  "aks-cluster": "cluster",
  "eks-cluster": "cluster",
  "gke-cluster": "cluster",
  "k8s-namespace": "namespace",
  ns: "namespace",
  nodepool: "node-pool",
  "on-premises": "onprem",
  "on-prem": "onprem",
  datacenter: "onprem",
  "data-center": "onprem",
  "corporate-network": "onprem",
  internet: "external",
  "third-party": "external",
  saas: "external",
};

function kindOf(value: string): BoundaryKind | undefined {
  const slug = slugify(value);
  if ((BOUNDARY_KINDS as readonly string[]).includes(slug)) return slug as BoundaryKind;
  return KIND_ALIASES[slug];
}

function normalizeKind(value: unknown, warnings: string[]): BoundaryKind {
  if (value === undefined || value === null || value === "") return "group";
  const kind = kindOf(String(value));
  if (!kind) {
    warnings.push(`Unknown boundary kind "${String(value)}"; drew it as a generic group`);
    return "group";
  }
  return kind;
}

const MEANING_ALIASES: Record<string, Meaning> = {
  sync: "request",
  synchronous: "request",
  http: "request",
  https: "request",
  call: "request",
  calls: "request",
  flow: "request",
  data: "request",
  traffic: "request",
  event: "async",
  events: "async",
  asynchronous: "async",
  queue: "async",
  message: "async",
  messaging: "async",
  stream: "async",
  pubsub: "async",
  publish: "async",
  replicate: "replication",
  replica: "replication",
  backup: "replication",
  sync_replication: "replication",
  "private-endpoint": "private-link",
  privatelink: "private-link",
  "vnet-peering": "peering",
  "vpc-peering": "peering",
  expressroute: "vpn",
  "express-route": "vpn",
  "direct-connect": "vpn",
  interconnect: "vpn",
  "site-to-site": "vpn",
  ipsec: "vpn",
  diagnostics: "monitoring",
  telemetry: "monitoring",
  logs: "monitoring",
  metrics: "monitoring",
  observability: "monitoring",
  control: "management",
  admin: "management",
  ssh: "management",
  rdp: "management",
  deploy: "management",
  deployment: "management",
  "forced-tunnel": "egress",
  "forced-tunneling": "egress",
  outbound: "egress",
};

function normalizeMeaning(value: unknown, warnings: string[]): Meaning {
  if (value === undefined || value === null || value === "") return "request";
  const slug = slugify(String(value));
  if ((MEANINGS as readonly string[]).includes(slug)) return slug as Meaning;
  const alias = MEANING_ALIASES[slug] ?? MEANING_ALIASES[slug.replace(/-/g, "_")];
  if (alias) return alias;
  warnings.push(`Unknown connection meaning "${String(value)}"; drew it as a request`);
  return "request";
}

const PLATFORM_ALIASES: Record<string, Platform> = {
  az: "azure",
  microsoft: "azure",
  "microsoft-azure": "azure",
  amazon: "aws",
  "amazon-web-services": "aws",
  google: "gcp",
  "google-cloud": "gcp",
  k8s: "kubernetes",
  generic: "neutral",
  none: "neutral",
  "multi-cloud": "neutral",
  hybrid: "neutral",
};

function normalizePlatform(value: unknown, warnings: string[]): Platform | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const slug = slugify(String(value));
  if ((PLATFORMS as readonly string[]).includes(slug)) return slug as Platform;
  const alias = PLATFORM_ALIASES[slug];
  if (alias) return alias;
  warnings.push(`Unknown platform "${String(value)}"; inferred it from the icons`);
  return undefined;
}

const VIEW_ALIASES: Record<string, ArchView> = {
  infrastructure: "deployment",
  infra: "deployment",
  topology: "network",
  networking: "network",
  app: "application",
  services: "application",
  container: "application",
  "c4-container": "application",
  data: "dataflow",
  pipeline: "dataflow",
  "data-flow": "dataflow",
  "system-context": "context",
  "c4-context": "context",
};

function normalizeView(value: unknown, warnings: string[]): ArchView | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const slug = slugify(String(value));
  if ((VIEWS as readonly string[]).includes(slug)) return slug as ArchView;
  const alias = VIEW_ALIASES[slug];
  if (alias) return alias;
  if (slug !== "group" && slug !== "architecture") warnings.push(`Unknown view "${String(value)}"; ignored it`);
  return undefined;
}

// ---------------------------------------------------------------- icons

const ICON_ALIASES: Record<string, string> = {
  person: "user",
  people: "users",
  customers: "users",
  clients: "users",
  browser: "desktop",
  "mobile-app": "mobile",
  postgres: "postgresql",
  "azure-postgresql": "postgresql",
  mongo: "mongodb",
  kubernetes: "k8s",
  "entra-id": "azure-active-directory",
  "microsoft-entra-id": "azure-active-directory",
  "azure-ad": "azure-active-directory",
  "azure-entra-id": "azure-active-directory",
  "application-insights": "azure-app-insights",
  "private-endpoint": "azure-private-link",
  "azure-private-endpoint": "azure-private-link",
  vnet: "azure-virtual-networks",
  "virtual-network": "azure-virtual-networks",
  nsg: "azure-network-security-groups",
  "network-security-group": "azure-network-security-groups",
  "sql-mi": "azure-sql-managed-instance",
  "azure-sql": "azure-sql-database",
  "cosmosdb": "azure-cosmos-db",
  "aks": "azure-kubernetes-service",
  "acr": "azure-container-registry",
  "apim": "azure-api-management",
  "openai": "azure-cognitive-services",
  "azure-openai": "azure-cognitive-services",
  "ai-search": "azure-search",
  "azure-ai-search": "azure-search",
  "container-apps": "azure-container-instances",
  "load-balancer": "load-balancer",
  alb: "aws-elastic-load-balancing",
  elb: "aws-elastic-load-balancing",
  "application-load-balancer": "aws-elastic-load-balancing",
  "nat-gateway": "aws-vpc",
  "internet-gateway": "aws-vpc",
  "s3-bucket": "aws-s3",
  "amazon-s3": "aws-s3",
  "cloud-watch": "aws-cloudwatch",
  pubsub: "gcp-pubsub",
  "pub-sub": "gcp-pubsub",
  gcs: "gcp-cloud-storage",
};

/**
 * Icon keys, ids or display names ("Application Gateway", "aws-lambda", "/icons/redis.svg")
 * resolve to a registry key, preferring the spec's platform when a name exists on several.
 */
function resolveIcon(value: unknown, componentName: string | undefined, ctx: Ctx): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  const slug = slugify(raw.replace(/^\/?icons\//, "").replace(/\.svg$/i, ""));
  const prefixes = platformPrefixes(ctx.platform);
  const candidates = [slug, ICON_ALIASES[slug], ...prefixes.map((p) => `${p}-${slug}`), ...prefixes.map((p) => ICON_ALIASES[`${p}-${slug}`])].filter((c): c is string => Boolean(c));
  const key = candidates.find((candidate) => iconRegistry[candidate]) ?? iconByLabel(raw, prefixes);
  if (key) return key;
  ctx.warnings.push(`Unknown icon "${raw}"${componentName ? ` for ${componentName}` : ""}; drew a generic box`);
  return undefined;
}

function platformPrefixes(platform: Platform | undefined): string[] {
  const all = ["azure", "aws", "gcp", "k8s"];
  const first = platform === "kubernetes" ? "k8s" : platform;
  return first && all.includes(first) ? [first, ...all.filter((p) => p !== first)] : all;
}

let labelIndex: Map<string, string[]> | null = null;
function iconByLabel(raw: string, prefixes: string[]): string | undefined {
  if (!labelIndex) {
    labelIndex = new Map();
    for (const [key, entry] of Object.entries(iconRegistry)) {
      const label = slugify(entry.label ?? "");
      if (!label) continue;
      labelIndex.set(label, [...(labelIndex.get(label) ?? []), key]);
    }
  }
  const matches = labelIndex.get(slugify(raw));
  if (!matches?.length) return undefined;
  for (const prefix of prefixes) {
    const match = matches.find((key) => key.startsWith(`${prefix}-`));
    if (match) return match;
  }
  return matches[0];
}

// ---------------------------------------------------------------- helpers

function checkFields(record: JsonRecord, allowed: readonly string[], kind: string, warnings: string[]): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;
    const guess = allowed.find((name) => editDistance(key.toLowerCase(), name.toLowerCase()) <= 2);
    const message = `Ignored unknown ${kind} field "${key}"${guess ? ` (did you mean "${guess}"?)` : ""}`;
    if (!warnings.includes(message)) warnings.push(message);
  }
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

function containsGroup(record: JsonRecord): boolean {
  const items = ["items", "components", "nodes", "resources"].map((k) => record[k]).find(Array.isArray) as unknown[] | undefined;
  return Boolean(items?.some((item) => isRecord(item) && (Array.isArray(item.items) || Array.isArray(item.children) || item.type === "group")));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueOf(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function arrayOf(record: JsonRecord, keys: string[]): unknown[] {
  const value = valueOf(record, keys);
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function text(value: unknown, limit: number, warnings: string[], kind: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const clean = (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  if (clean.length > limit) {
    warnings.push(`Trimmed long ${kind}`);
    return `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }
  return clean;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
