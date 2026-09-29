import { iconRegistry } from "@/lib/icon-registry";
import { TONES, type Tone } from "@/lib/model/types";
import {
  FOOTER_ID,
  HEADER_ID,
  SPEC_LIMITS,
  SpecError,
  type ColumnSize,
  type ConnectorKind,
  type NCard,
  type NColumn,
  type NConnector,
  type NFlow,
  type NGrid,
  type NItem,
  type NormalizedSpec,
  type NStep,
  type NZone,
  type SpecFooter,
} from "./spec";

export interface NormalizeResult {
  spec: NormalizedSpec;
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;
type ItemContext = { columnId: string; flowIndex: number };

const toneAliases: Record<string, Tone> = {
  grey: "gray",
  yellow: "orange",
  amber: "orange",
  cyan: "teal",
  violet: "purple",
};
const flowTones: Tone[] = ["blue", "purple", "green", "orange", "teal"];
const itemTypeAliases: Record<string, NItem["type"]> = {
  lane: "flow",
  flow: "flow",
  process: "flow",
  pipeline: "flow",
  service: "card",
  box: "card",
  node: "card",
  component: "card",
  card: "card",
  grid: "grid",
  zone: "zone",
  group: "zone",
  boundary: "zone",
  network: "zone",
  vnet: "zone",
  vpc: "zone",
  subnet: "zone",
  cluster: "zone",
  namespace: "zone",
  account: "zone",
  region: "zone",
  banner: "banner",
  strip: "banner",
  note: "banner",
};

export function parseSpecText(text: string): unknown {
  const cleaned = removeTrailingCommas(stripLineComments(extractFence(text.replace(/^\uFEFF/, ""))));
  const candidates = jsonObjectCandidates(cleaned);
  let lastMessage = "no JSON object found";
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }
  if (candidates.length === 0 && cleaned.includes("{")) throw new SpecError("The spec JSON is never closed; the output looks cut off. Output the complete spec object.");
  if (candidates.length === 0 && /^\s*\[/.test(cleaned)) throw new SpecError("The spec must be a JSON object, but got an array.");
  throw new SpecError(`The spec is not valid JSON: ${lastMessage}`);
}

export function normalizeSpecText(text: string): NormalizeResult {
  return normalizeSpec(parseSpecText(text));
}

export function iconUrl(key: string | undefined): string | undefined {
  return key && iconRegistry[key] ? `/icons/${key}.svg` : undefined;
}

export function normalizeSpec(raw: unknown): NormalizeResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) throw new SpecError("The spec must be a JSON object");

  checkFields(raw, FIELDS.root, "spec", warnings);
  const rawTitle = textField(raw, ["title"], SPEC_LIMITS.titleChars, warnings, "title");
  const rawColumns = columnInputs(raw, warnings);
  const hasItems = rawColumns.some((column) => arrayField(column, ["items", "cards"]).length > 0);
  if (!rawTitle && !hasItems) throw new SpecError("The spec needs a title or at least one item");

  const ids = new Set<string>();
  const columns = normalizeColumns(rawColumns, ids, warnings);
  if (columns.length === 0 && !rawTitle) throw new SpecError("The spec needs a title or at least one item");

  const title = rawTitle ?? "Architecture overview";
  if (!rawTitle) warnings.push("Missing title; using Architecture overview");

  const spec: NormalizedSpec = {
    title,
    columns,
    connectors: [],
  };
  const subtitle = textField(raw, ["subtitle", "sub", "trigger"], SPEC_LIMITS.subtitleChars, warnings, "subtitle");
  if (subtitle) spec.subtitle = subtitle;
  const badge = normalizeBadge(raw, warnings);
  if (badge) spec.badge = badge;
  const footer = normalizeFooter(raw, warnings);
  if (footer) spec.footer = footer;

  normalizeUsedBy(spec, warnings);
  spec.connectors = normalizeConnectors(raw, spec, warnings);
  letterInReadingOrder(spec);
  return { spec, warnings: [...new Set(warnings)] };
}

/**
 * Flow letters follow reading order (columns left to right, top to bottom),
 * whatever the author wrote. References are resolved by now, so only the
 * letters and the used-by chips that name them change.
 */
function letterInReadingOrder(spec: NormalizedSpec): void {
  const flows = allFlows(spec.columns);
  const next = new Map<string, string>();
  flows.forEach((flow, i) => next.set(flow.label, flowLetter(i)));
  if (flows.every((flow) => next.get(flow.label) === flow.label)) return;
  for (const flow of flows) flow.label = next.get(flow.label)!;
  const order = flows.map((flow) => flow.label);
  for (const card of allCards(spec.columns)) {
    card.usedBy = card.usedBy.map((letter) => next.get(letter) ?? letter).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
}

function flowLetter(index: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < letters.length ? letters[index] : `${letters[Math.floor(index / letters.length) - 1]}${letters[index % letters.length]}`;
}

function extractFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  return fence?.[1] ?? text;
}

function stripLineComments(text: string): string {
  let out = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Drops commas that sit right before a closing bracket (outside strings), in
 * one pass: runs like ",,,]" and ", ]" inside string values are handled correctly.
 */
function removeTrailingCommas(text: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  // Positions in `out` of commas seen since the last token that wasn't a comma or whitespace.
  let pending: number[] = [];
  for (const ch of text) {
    if (inString) {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === "}" || ch === "]") {
      for (const i of pending) out[i] = "";
      pending = [];
    } else if (ch === ",") {
      pending.push(out.length);
    } else if (!/\s/.test(ch)) {
      pending = [];
      if (ch === '"') inString = true;
    }
    out.push(ch);
  }
  return out.join("");
}

function jsonObjectCandidates(text: string): string[] {
  const candidates: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) candidates.push(text.slice(start, i + 1));
    }
  }
  return candidates;
}

function columnInputs(raw: JsonRecord, warnings: string[]): JsonRecord[] {
  let columns = asRecords(valueOf(raw, ["columns", "sections", "zones"]));
  if (columns.length === 0) {
    const items = arrayField(raw, ["items", "cards"]);
    if (items.length) {
      warnings.push("Wrapped top-level items in an Architecture column");
      columns = [{ title: "Architecture", items }];
    }
  }
  if (columns.length > SPEC_LIMITS.columns) {
    warnings.push(`Merged extra columns beyond ${SPEC_LIMITS.columns}`);
    const kept = columns.slice(0, SPEC_LIMITS.columns);
    const last = kept[kept.length - 1];
    const merged = [...arrayField(last, ["items", "cards"])];
    for (const extra of columns.slice(SPEC_LIMITS.columns)) merged.push(...arrayField(extra, ["items", "cards"]));
    // A copy, so the caller's spec is never changed (the same spec must always give the same diagram).
    columns = [...kept.slice(0, -1), { ...last, items: merged }];
  }
  return columns;
}

function normalizeColumns(columns: JsonRecord[], ids: Set<string>, warnings: string[]): NColumn[] {
  const out: NColumn[] = [];
  columns.forEach((column, index) => {
    const rawTitle = textField(column, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "column title") ?? `Column ${index + 1}`;
    // The engine numbers columns itself ("1 · Title"); drop numbering the author added
    // ("1. Title", "II) Title", "3 - Title"), but not a word such as "X-Ray".
    const title = rawTitle.replace(/^\s*(?:\d{1,2}|[ivx]{1,4})\s*(?:[.):·–—]|-(?=\s))\s*/i, "").trim() || rawTitle;
    const fallback = index === 0 ? "column" : `column-${index + 1}`;
    let id = uniqueId(valueOf(column, ["id"]) ?? title, fallback, ids);
    if (id === HEADER_ID || id === FOOTER_ID) {
      warnings.push(`Renamed reserved column id ${id}`);
      id = uniqueId(`${id}-column`, "column", ids);
    }
    checkFields(column, FIELDS.column, "column", warnings);
    const rawItems = arrayField(column, ["items", "cards"]);
    const items: NItem[] = [];
    let flowIndex = flowCount(out);
    for (const rawItem of rawItems) {
      if (items.length >= SPEC_LIMITS.itemsPerColumn) {
        warnings.push(`Dropped items beyond ${SPEC_LIMITS.itemsPerColumn} in column ${title}`);
        break;
      }
      const item = normalizeItem(rawItem, { columnId: id, flowIndex }, ids, warnings);
      if (item) {
        items.push(item);
        if (item.type === "flow") flowIndex++;
      }
    }
    if (items.length === 0) {
      warnings.push(`Dropped empty column ${title}`);
      return;
    }
    out.push({ id, title, size: normalizeColumnSize(valueOf(column, ["size", "width"]), items), items });
  });
  assignFlowLabels(out, warnings);
  return out;
}

function normalizeItem(raw: unknown, context: ItemContext, ids: Set<string>, warnings: string[]): NItem | undefined {
  const record = isRecord(raw) ? raw : { title: raw };
  const type = itemType(record);
  checkFields(record, FIELDS[type], type, warnings);
  if (type === "grid") return normalizeGrid(record, ids, warnings);
  if (type === "zone") return normalizeZone(record, ids, warnings);
  if (type === "banner") return normalizeBanner(record, ids, warnings);
  if (type === "flow") return normalizeFlow(record, context, ids, warnings);
  return normalizeCard(record, ids, warnings);
}

/** Every field the normaliser reads, per kind of object, aliases included. */
const FIELDS = {
  root: ["version", "$schema", "title", "subtitle", "sub", "trigger", "badge", "columns", "sections", "zones", "connectors", "edges", "links", "connections", "footer", "items", "cards"],
  column: ["id", "title", "name", "label", "size", "width", "items", "cards"],
  card: ["type", "id", "title", "name", "label", "lines", "description", "details", "body", "tone", "color", "colour", "usedBy", "used_by", "notes", "note", "icon"],
  grid: ["type", "id", "title", "name", "label", "columns", "items", "cards"],
  banner: ["type", "id", "title", "name", "label", "text", "subtitle", "sub", "description", "details", "body", "tone", "color", "colour"],
  zone: ["type", "id", "title", "name", "label", "subtitle", "sub", "text", "description", "tag", "tone", "color", "colour", "columns", "items", "cards", "notes"],
  flow: ["type", "id", "label", "title", "name", "subtitle", "sub", "trigger", "tag", "tone", "color", "colour", "steps", "notes", "chips"],
  step: ["id", "title", "name", "label", "lines", "description", "details", "body", "tone", "color", "colour", "icon"],
  connector: ["from", "source", "to", "target", "kind", "type", "label", "title", "tone", "color", "colour"],
  footer: ["title", "text", "subtitle", "body", "status", "tag", "statusDetail", "badgeDetail", "detail"],
  badge: ["title", "label", "name", "detail", "text"],
  chips: ["label", "title", "items"],
} as const;

/**
 * Unknown fields are ignored, but say so: a typo such as "conectors" would
 * otherwise silently lose everything under it. One warning per kind and field.
 */
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
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

function normalizeCard(raw: JsonRecord, ids: Set<string>, warnings: string[], defaultTone: Tone = "blue"): NCard {
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "card title") ?? "Untitled";
  if (!textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, [], "card title")) warnings.push("Card without title renamed Untitled");
  const card: NCard = {
    type: "card",
    id: uniqueId(valueOf(raw, ["id"]) ?? title, "item", ids),
    title,
    lines: textArray(raw, ["lines", "description", "details", "body"], SPEC_LIMITS.lineChars, SPEC_LIMITS.linesPerCard, warnings, "card lines"),
    tone: normalizeTone(valueOf(raw, ["tone", "color", "colour"]), defaultTone, warnings, "card"),
    usedBy: textArray(raw, ["usedBy", "used_by"], SPEC_LIMITS.chipChars, SPEC_LIMITS.chips, warnings, "usedBy"),
  };
  const notes = textArray(raw, ["notes"], SPEC_LIMITS.noteChars, SPEC_LIMITS.notesPerFlow, warnings, "card notes");
  // Several notes become one footnote, still within the note limit.
  const note = textField(raw, ["note"], SPEC_LIMITS.noteChars, warnings, "card note") ?? (notes.length ? cleanText(notes.join(" · "), SPEC_LIMITS.noteChars, warnings, "card notes") : undefined);
  if (note) card.note = note;
  const icon = normalizeIcon(valueOf(raw, ["icon"]), warnings);
  if (icon) card.icon = icon;
  return card;
}

function normalizeGrid(raw: JsonRecord, ids: Set<string>, warnings: string[]): NGrid | undefined {
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "grid title") ?? "grid";
  const items = arrayField(raw, ["items", "cards"]).slice(0, SPEC_LIMITS.gridItems);
  if (arrayField(raw, ["items", "cards"]).length > SPEC_LIMITS.gridItems) warnings.push(`Dropped grid cards beyond ${SPEC_LIMITS.gridItems}`);
  const cards = items.map((item) => normalizeCard(isRecord(item) ? item : { title: item }, ids, warnings));
  if (cards.length === 0) {
    warnings.push(`Dropped empty grid ${title}`);
    return undefined;
  }
  return {
    type: "grid",
    id: uniqueId(valueOf(raw, ["id"]) ?? title, "item", ids),
    columns: clampNumber(numberValue(valueOf(raw, ["columns"])), 2, SPEC_LIMITS.gridColumns, 2, warnings, "grid columns"),
    items: cards,
  };
}

function normalizeZone(raw: JsonRecord, ids: Set<string>, warnings: string[]): NItem {
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "zone title") ?? "Boundary";
  const rawItems = arrayField(raw, ["items", "cards"]);
  if (rawItems.length === 0) {
    // A boundary with nothing inside it is just context: say it as a banner.
    warnings.push(`Converted empty zone ${title} to a banner`);
    return normalizeBanner({ ...raw, text: valueOf(raw, ["text", "subtitle", "sub", "description"]) }, ids, warnings);
  }
  if (rawItems.length > SPEC_LIMITS.zoneItems) warnings.push(`Dropped zone cards beyond ${SPEC_LIMITS.zoneItems} in ${title}`);
  const id = uniqueId(valueOf(raw, ["id"]) ?? title, "item", ids);
  const zone: NZone = {
    type: "zone",
    id,
    title,
    tone: normalizeTone(valueOf(raw, ["tone", "color", "colour"]), "gray", warnings, "zone"),
    columns: clampNumber(numberValue(valueOf(raw, ["columns"])), 1, SPEC_LIMITS.gridColumns, 2, warnings, "zone columns"),
    items: rawItems.slice(0, SPEC_LIMITS.zoneItems).map((item) => normalizeCard(isRecord(item) ? item : { title: item }, ids, warnings)),
    notes: textArray(raw, ["notes"], SPEC_LIMITS.noteChars, SPEC_LIMITS.notesPerFlow, warnings, "zone notes"),
  };
  const subtitle = textField(raw, ["subtitle", "sub", "text", "description"], SPEC_LIMITS.subtitleChars, warnings, "zone subtitle");
  if (subtitle) zone.subtitle = subtitle;
  const tag = textField(raw, ["tag"], SPEC_LIMITS.chipChars, warnings, "zone tag");
  if (tag) zone.tag = tag;
  return zone;
}

function normalizeBanner(raw: JsonRecord, ids: Set<string>, warnings: string[]): NItem {
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "banner title") ?? "Untitled";
  const banner = {
    type: "banner" as const,
    id: uniqueId(valueOf(raw, ["id"]) ?? title, "item", ids),
    title,
    tone: normalizeTone(valueOf(raw, ["tone", "color", "colour"]), "blue", warnings, "banner"),
  };
  const text = textField(raw, ["text", "subtitle", "sub", "description", "details", "body"], SPEC_LIMITS.subtitleChars, warnings, "banner text");
  return text ? { ...banner, text } : banner;
}

function normalizeFlow(raw: JsonRecord, context: ItemContext, ids: Set<string>, warnings: string[]): NItem {
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "flow title") ?? "Untitled";
  const tone = normalizeTone(valueOf(raw, ["tone", "color", "colour"]), flowTones[context.flowIndex % flowTones.length], warnings, "flow");
  const rawSteps = arrayField(raw, ["steps"]).slice(0, SPEC_LIMITS.steps);
  if (arrayField(raw, ["steps"]).length > SPEC_LIMITS.steps) warnings.push(`Dropped steps beyond ${SPEC_LIMITS.steps} in flow ${title}`);
  if (rawSteps.length === 0) {
    warnings.push(`Converted flow ${title} without steps to a card`);
    return normalizeCard({ ...raw, type: "card", title }, ids, warnings, tone);
  }
  const flow: NFlow = {
    type: "flow",
    id: uniqueId(valueOf(raw, ["id"]) ?? title, "item", ids),
    label: "",
    title,
    tone,
    steps: rawSteps.map((step) => normalizeStep(isRecord(step) ? step : { title: step }, tone, ids, warnings)),
    notes: textArray(raw, ["notes"], SPEC_LIMITS.noteChars, SPEC_LIMITS.notesPerFlow, warnings, "flow notes"),
  };
  const label = flowLabel(valueOf(raw, ["label"]), warnings);
  if (label) flow.label = label;
  const subtitle = textField(raw, ["subtitle", "sub", "trigger"], SPEC_LIMITS.subtitleChars, warnings, "flow subtitle");
  if (subtitle) flow.subtitle = subtitle;
  const tag = textField(raw, ["tag"], SPEC_LIMITS.chipChars, warnings, "flow tag");
  if (tag) flow.tag = tag;
  const chips = normalizeChips(raw, warnings);
  if (chips) flow.chips = chips;
  return flow;
}

function normalizeStep(raw: JsonRecord, tone: Tone, ids: Set<string>, warnings: string[]): NStep {
  checkFields(raw, FIELDS.step, "step", warnings);
  const title = textField(raw, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "step title") ?? "Untitled";
  const step: NStep = {
    id: uniqueId(valueOf(raw, ["id"]) ?? title, "step", ids),
    title,
    lines: textArray(raw, ["lines", "description", "details", "body"], SPEC_LIMITS.lineChars, SPEC_LIMITS.linesPerStep, warnings, "step lines"),
    tone: normalizeTone(valueOf(raw, ["tone", "color", "colour"]), tone, warnings, "step"),
  };
  const icon = normalizeIcon(valueOf(raw, ["icon"]), warnings);
  if (icon) step.icon = icon;
  return step;
}

function assignFlowLabels(columns: NColumn[], warnings: string[]): void {
  // Letters the author wrote are claimed first, so an unlabelled flow never takes
  // one that a later flow (and the chips or references naming it) asked for.
  const used = new Set<string>();
  const unlabelled: NFlow[] = [];
  for (const flow of allFlows(columns)) {
    const requested = flow.label.trim().toUpperCase().slice(0, 2);
    if (requested && !used.has(requested)) {
      flow.label = requested;
      used.add(requested);
      continue;
    }
    if (requested) warnings.push(`Duplicate flow label ${requested}; assigned next free label`);
    unlabelled.push(flow);
  }
  for (const flow of unlabelled) {
    flow.label = nextFlowLabel(used);
    used.add(flow.label);
  }
}

function normalizeUsedBy(spec: NormalizedSpec, warnings: string[]): void {
  const flows = allFlows(spec.columns);
  for (const card of allCards(spec.columns)) {
    const resolved = new Set<string>();
    for (const ref of card.usedBy) {
      const flow = flows.find((candidate) => equalsLoose(ref, candidate.label) || equalsLoose(slugify(ref), candidate.id) || equalsLoose(ref, candidate.title));
      if (flow) resolved.add(flow.label);
      else warnings.push(`Dropped unknown usedBy reference ${ref}`);
    }
    card.usedBy = flows.map((flow) => flow.label).filter((letter) => resolved.has(letter));
  }
}

function normalizeConnectors(raw: JsonRecord, spec: NormalizedSpec, warnings: string[]): NConnector[] {
  const refs = buildRefs(spec);
  const rawConnectors = arrayField(raw, ["connectors", "edges", "links", "connections"]);
  const connectors: NConnector[] = [];
  const seen = new Set<string>();
  for (const value of rawConnectors.slice(0, SPEC_LIMITS.connectors)) {
    if (!isRecord(value)) continue;
    checkFields(value, FIELDS.connector, "connector", warnings);
    const fromText = textField(value, ["from", "source"], SPEC_LIMITS.labelChars, warnings, "connector endpoint");
    const toText = textField(value, ["to", "target"], SPEC_LIMITS.labelChars, warnings, "connector endpoint");
    if (!fromText || !toText) {
      warnings.push("Dropped connector with missing endpoint");
      continue;
    }
    const from = resolveRef(fromText, refs, warnings);
    const to = resolveRef(toText, refs, warnings);
    if (!from) {
      warnings.push(`Dropped connector with unresolved endpoint ${fromText}`);
      continue;
    }
    if (!to) {
      warnings.push(`Dropped connector with unresolved endpoint ${toText}`);
      continue;
    }
    if (from.kind === "column" || to.kind === "column") {
      warnings.push("Dropped connector that targets a column");
      continue;
    }
    if (from.kind === "grid" || to.kind === "grid") {
      warnings.push(`Dropped connector to grid ${from.kind === "grid" ? fromText : toText}; connect to one of its cards`);
      continue;
    }
    if (from.id === to.id) {
      warnings.push(`Dropped self-loop connector ${fromText}`);
      continue;
    }
    const kind = connectorKind(valueOf(value, ["kind", "type"]));
    const key = `${from.id}\u0000${to.id}\u0000${kind}`;
    if (seen.has(key)) {
      warnings.push("Dropped duplicate connector");
      continue;
    }
    seen.add(key);
    const connector: NConnector = { from: from.id, to: to.id, kind };
    const label = textField(value, ["label", "title"], SPEC_LIMITS.labelChars, warnings, "connector label");
    if (label) connector.label = label;
    const tone = normalizeOptionalTone(valueOf(value, ["tone", "color", "colour"]), warnings, "connector");
    if (tone) connector.tone = tone;
    connectors.push(connector);
  }
  if (rawConnectors.length > SPEC_LIMITS.connectors) warnings.push(`Dropped connectors beyond ${SPEC_LIMITS.connectors}`);
  return connectors;
}

type RefTarget = { id: string; localId: string; title: string; kind: "column" | "item" | "grid" | "step" | "flow" };
type RefIndex = {
  byModel: Map<string, RefTarget>;
  byLocal: Map<string, RefTarget[]>;
  byTitle: Map<string, RefTarget[]>;
  flows: Array<{ flow: NFlow; target: RefTarget }>;
};

function buildRefs(spec: NormalizedSpec): RefIndex {
  const byModel = new Map<string, RefTarget>();
  const byLocal = new Map<string, RefTarget[]>();
  const byTitle = new Map<string, RefTarget[]>();
  const flows: RefIndex["flows"] = [];
  const add = (target: RefTarget) => {
    byModel.set(target.id, target);
    pushMap(byLocal, target.localId, target);
    pushMap(byTitle, target.title.toLowerCase(), target);
    pushMap(byLocal, slugify(target.localId), target);
  };
  for (const column of spec.columns) {
    add({ id: column.id, localId: column.id, title: column.title, kind: "column" });
    for (const item of column.items) {
      const itemTarget: RefTarget = { id: `${column.id}.${item.id}`, localId: item.id, title: item.type === "grid" ? item.id : item.title, kind: item.type === "flow" ? "flow" : item.type === "grid" ? "grid" : "item" };
      add(itemTarget);
      if (item.type === "flow") {
        flows.push({ flow: item, target: itemTarget });
        for (const step of item.steps) add({ id: `${column.id}.${item.id}.${step.id}`, localId: step.id, title: step.title, kind: "step" });
      } else if (item.type === "grid" || item.type === "zone") {
        for (const card of item.items) add({ id: `${column.id}.${item.id}.${card.id}`, localId: card.id, title: card.title, kind: "item" });
      }
    }
  }
  return { byModel, byLocal, byTitle, flows };
}

function resolveRef(ref: string, refs: RefIndex, warnings: string[]): RefTarget | undefined {
  if (refs.byModel.has(ref)) return refs.byModel.get(ref);
  const direct = unique(refs.byLocal.get(ref));
  if (direct) return direct;
  const dotted = ref.split(".");
  if (dotted.length === 2) {
    const [flowRef, stepRef] = dotted;
    // Ids are deduplicated across the whole spec ("gateway" → "gateway-2"), but a `flow.step`
    // reference is scoped to its flow, so the id the author wrote (or the title) still finds it.
    const original = (id: string) => id.replace(/-\d+$/, "");
    const matches = (value: string, id: string, title: string) =>
      equalsLoose(value, id) || equalsLoose(slugify(value), id) || equalsLoose(slugify(value), original(id)) || equalsLoose(slugify(value), slugify(title));
    const flow =
      refs.flows.find((entry) => equalsLoose(flowRef, entry.flow.id) || equalsLoose(flowRef, entry.flow.label)) ??
      refs.flows.find((entry) => matches(flowRef, entry.flow.id, entry.flow.title));
    if (flow) {
      const step = flow.flow.steps.find((candidate) => equalsLoose(stepRef, candidate.id) || equalsLoose(slugify(stepRef), candidate.id)) ?? flow.flow.steps.find((candidate) => matches(stepRef, candidate.id, candidate.title));
      if (step) {
        const columnId = flow.target.id.split(".")[0];
        return refs.byModel.get(`${columnId}.${flow.flow.id}.${step.id}`);
      }
    }
  }
  // A bare flow letter ("A") names that flow, as the author lettered it; checked before titles,
  // so a step titled "a" doesn't capture it. Lower-case letters only fall back after titles.
  const exactLetter = refs.flows.find((entry) => entry.flow.label && entry.flow.label === ref.trim());
  if (exactLetter) return exactLetter.target;
  const title = unique(refs.byTitle.get(ref.toLowerCase()));
  if (title) return title;
  const letter = refs.flows.find((entry) => entry.flow.label && equalsLoose(ref.trim(), entry.flow.label));
  if (letter) return letter.target;
  const bySlug = unique(refs.byLocal.get(slugify(ref)));
  const sameTitle = refs.byTitle.get(ref.toLowerCase()) ?? [];
  if (bySlug && sameTitle.length > 1) {
    const message = `Ambiguous reference "${ref}" matches ${sameTitle.length} items; used ${bySlug.id} (use an id or flow.step)`;
    if (!warnings.includes(message)) warnings.push(message);
  }
  return bySlug;
}

function normalizeBadge(raw: JsonRecord, warnings: string[]): NormalizedSpec["badge"] | undefined {
  const badge = valueOf(raw, ["badge"]);
  if (isRecord(badge)) {
    checkFields(badge, FIELDS.badge, "badge", warnings);
    const title = textField(badge, ["title", "label", "name"], SPEC_LIMITS.labelChars, warnings, "badge title");
    if (!title) return undefined;
    const detail = textField(badge, ["detail", "text"], SPEC_LIMITS.labelChars, warnings, "badge detail");
    return detail ? { title, detail } : { title };
  }
  const title = cleanText(badge, SPEC_LIMITS.labelChars, warnings, "badge");
  return title ? { title } : undefined;
}

function normalizeFooter(raw: JsonRecord, warnings: string[]): SpecFooter | undefined {
  const footer = valueOf(raw, ["footer"]);
  if (isRecord(footer)) {
    checkFields(footer, FIELDS.footer, "footer", warnings);
    const text = textField(footer, ["text", "subtitle", "body"], SPEC_LIMITS.subtitleChars, warnings, "footer text") ?? "";
    const title = textField(footer, ["title"], SPEC_LIMITS.titleChars, warnings, "footer title") ?? "Outcome";
    const result: SpecFooter = { title, text };
    const status = textField(footer, ["status", "tag"], SPEC_LIMITS.chipChars, warnings, "footer status");
    const statusDetail = textField(footer, ["statusDetail", "badgeDetail", "detail"], SPEC_LIMITS.labelChars, warnings, "footer status detail");
    if (status) result.status = status;
    if (statusDetail) result.statusDetail = statusDetail;
    return result;
  }
  const text = cleanText(footer, SPEC_LIMITS.subtitleChars, warnings, "footer");
  return text ? { title: "Outcome", text } : undefined;
}

function normalizeChips(raw: JsonRecord, warnings: string[]): NFlow["chips"] | undefined {
  const chips = valueOf(raw, ["chips"]);
  if (isRecord(chips)) {
    checkFields(chips, FIELDS.chips, "chips", warnings);
    const items = textArray(chips, ["items"], SPEC_LIMITS.chipChars, SPEC_LIMITS.chips, warnings, "chips");
    if (!items.length) return undefined;
    const label = textField(chips, ["label", "title"], SPEC_LIMITS.chipChars, warnings, "chips label");
    return label ? { label, items } : { items };
  }
  const items = toTextArray(chips, SPEC_LIMITS.chipChars, SPEC_LIMITS.chips, warnings, "chips");
  return items.length ? { items } : undefined;
}

function itemType(record: JsonRecord): NItem["type"] {
  const raw = cleanText(valueOf(record, ["type"]), 30, [], "type")?.toLowerCase();
  if (raw && itemTypeAliases[raw]) return itemTypeAliases[raw];
  if (arrayField(record, ["steps"]).length) return "flow";
  // Cards under a title form a boundary; untitled, just a grid.
  if (arrayField(record, ["items", "cards"]).length) return valueOf(record, ["title", "name", "label"]) !== undefined ? "zone" : "grid";
  return "card";
}

function normalizeColumnSize(value: unknown, items: NItem[]): ColumnSize {
  const raw = cleanText(value, 20, [], "size")?.toLowerCase();
  if (raw === "narrow" || raw === "small") return "narrow";
  if (raw === "normal" || raw === "medium") return "normal";
  if (raw === "wide" || raw === "large") return "wide";
  if (items.some((item) => item.type === "flow")) return "wide";
  if (items.some((item) => item.type === "grid" || item.type === "zone")) return "normal";
  return "narrow";
}

function normalizeTone(value: unknown, fallback: Tone, warnings: string[], label: string): Tone {
  return normalizeOptionalTone(value, warnings, label) ?? fallback;
}

function normalizeOptionalTone(value: unknown, warnings: string[], label: string): Tone | undefined {
  const raw = cleanText(value, 20, [], "tone")?.toLowerCase();
  if (!raw) return undefined;
  const tone = toneAliases[raw] ?? raw;
  if (isTone(tone)) return tone;
  warnings.push(`Unknown ${label} tone ${raw}; using default`);
  return undefined;
}

function connectorKind(value: unknown): ConnectorKind {
  const raw = cleanText(value, 20, [], "connector kind")?.toLowerCase();
  if (raw === "async" || raw === "dependency" || raw === "dashed" || raw === "calls" || raw === "call") return "call";
  return "flow";
}

function flowLabel(value: unknown, warnings: string[]): string | undefined {
  const raw = cleanText(value, SPEC_LIMITS.chipChars, [], "flow label")?.toUpperCase();
  if (!raw) return undefined;
  if (raw.length > 2) warnings.push("Trimmed long flow label");
  return raw.slice(0, 2);
}

function normalizeIcon(value: unknown, warnings: string[]): string | undefined {
  const raw = cleanText(value, SPEC_LIMITS.chipChars, [], "icon");
  if (!raw) return undefined;
  const slug = slugify(raw.replace(/^\/?icons\//, "").replace(/\.svg$/i, ""));
  const candidates = [slug, `azure-${slug}`, `aws-${slug}`, `gcp-${slug}`];
  const key = candidates.find((candidate) => iconRegistry[candidate]);
  if (!key) {
    warnings.push(`Dropped unknown icon ${raw}`);
    return undefined;
  }
  return key;
}

function valueOf(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function textField(record: JsonRecord, keys: string[], limit: number, warnings: string[], kind: string): string | undefined {
  return cleanText(valueOf(record, keys), limit, warnings, kind);
}

function textArray(record: JsonRecord, keys: string[], limit: number, max: number, warnings: string[], kind: string): string[] {
  return toTextArray(valueOf(record, keys), limit, max, warnings, kind);
}

function toTextArray(value: unknown, limit: number, max: number, warnings: string[], kind: string): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const item of values) {
    if (out.length >= max) {
      warnings.push(`Dropped ${kind} beyond ${max}`);
      break;
    }
    const text = cleanText(item, limit, warnings, kind);
    if (text) out.push(text);
  }
  return out;
}

function cleanText(value: unknown, limit: number, warnings: string[], kind: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = (typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "").replace(/\s+/g, " ").trim();
  if (!text) {
    warnings.push(`Dropped empty ${kind}`);
    return undefined;
  }
  if (text.length > limit) {
    warnings.push(`Trimmed long ${kind}`);
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }
  return text;
}

function arrayField(record: JsonRecord, keys: string[]): unknown[] {
  const value = valueOf(record, keys);
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function asRecords(value: unknown): JsonRecord[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.filter(isRecord);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number, warnings: string[], kind: string): number {
  if (value === undefined) return fallback;
  const clamped = Math.max(min, Math.min(max, Math.round(value)));
  if (clamped !== value) warnings.push(`Clamped ${kind}`);
  return clamped;
}

function slugify(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_.\/]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SPEC_LIMITS.idChars)
    .replace(/^-|-$/g, "");
}

function uniqueId(value: unknown, fallback: string, ids: Set<string>): string {
  const base = slugify(value) || fallback;
  let candidate = base.slice(0, SPEC_LIMITS.idChars);
  let index = 2;
  while (ids.has(candidate)) {
    const suffix = `-${index++}`;
    candidate = `${base.slice(0, SPEC_LIMITS.idChars - suffix.length)}${suffix}`;
  }
  ids.add(candidate);
  return candidate;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value);
}

function flowCount(columns: NColumn[]): number {
  return allFlows(columns).length;
}

function allFlows(columns: NColumn[]): NFlow[] {
  return columns.flatMap((column) => column.items.filter((item): item is NFlow => item.type === "flow"));
}

function allCards(columns: NColumn[]): NCard[] {
  return columns.flatMap((column) =>
    column.items.flatMap((item) => {
      if (item.type === "card") return [item];
      if (item.type === "grid" || item.type === "zone") return item.items;
      return [];
    }),
  );
}

function nextFlowLabel(used: Set<string>): string {
  for (let i = 0; ; i++) {
    const label = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26) + 1) : "");
    if (!used.has(label)) return label.slice(0, 2);
  }
}

function equalsLoose(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const current = map.get(key);
  if (!current) map.set(key, [value]);
  else if (!current.includes(value)) current.push(value);
}

function unique<T>(values: T[] | undefined): T | undefined {
  return values && values.length === 1 ? values[0] : undefined;
}
