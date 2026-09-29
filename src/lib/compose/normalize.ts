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
  group: "grid",
  grid: "grid",
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
  return { spec, warnings };
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

function removeTrailingCommas(text: string): string {
  let current = text;
  let next = current.replace(/,\s*([}\]])/g, "$1");
  while (next !== current) {
    current = next;
    next = current.replace(/,\s*([}\]])/g, "$1");
  }
  return current;
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
    last.items = merged;
    columns = kept;
  }
  return columns;
}

function normalizeColumns(columns: JsonRecord[], ids: Set<string>, warnings: string[]): NColumn[] {
  const out: NColumn[] = [];
  columns.forEach((column, index) => {
    const rawTitle = textField(column, ["title", "name", "label"], SPEC_LIMITS.titleChars, warnings, "column title") ?? `Column ${index + 1}`;
    // The engine numbers columns itself ("1 · Title"); drop numbering the author added.
    const title = rawTitle.replace(/^\s*(?:\d{1,2}|[ivx]{1,4})\s*[.):·\-–—]\s*/i, "").trim() || rawTitle;
    const fallback = index === 0 ? "column" : `column-${index + 1}`;
    let id = uniqueId(valueOf(column, ["id"]) ?? title, fallback, ids);
    if (id === HEADER_ID || id === FOOTER_ID) {
      warnings.push(`Renamed reserved column id ${id}`);
      id = uniqueId(`${id}-column`, "column", ids);
    }
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
  if (type === "grid") return normalizeGrid(record, context, ids, warnings);
  if (type === "banner") return normalizeBanner(record, ids, warnings);
  if (type === "flow") return normalizeFlow(record, context, ids, warnings);
  return normalizeCard(record, ids, warnings);
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
  const note = textField(raw, ["note"], SPEC_LIMITS.noteChars, warnings, "card note") ?? (notes.length ? notes.join(" · ") : undefined);
  if (note) card.note = note;
  const icon = normalizeIcon(valueOf(raw, ["icon"]), warnings);
  if (icon) card.icon = icon;
  return card;
}

function normalizeGrid(raw: JsonRecord, context: ItemContext, ids: Set<string>, warnings: string[]): NGrid | undefined {
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
  const used = new Set<string>();
  for (const flow of allFlows(columns)) {
    const requested = flow.label.trim().toUpperCase().slice(0, 2);
    if (requested && !used.has(requested)) {
      flow.label = requested;
      used.add(requested);
    } else {
      if (requested) warnings.push(`Duplicate flow label ${requested}; assigned next free label`);
      flow.label = nextFlowLabel(used);
      used.add(flow.label);
    }
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
    const fromText = textField(value, ["from", "source"], SPEC_LIMITS.labelChars, warnings, "connector endpoint");
    const toText = textField(value, ["to", "target"], SPEC_LIMITS.labelChars, warnings, "connector endpoint");
    if (!fromText || !toText) {
      warnings.push("Dropped connector with missing endpoint");
      continue;
    }
    const from = resolveRef(fromText, refs);
    const to = resolveRef(toText, refs);
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

type RefTarget = { id: string; localId: string; title: string; kind: "column" | "item" | "step" | "flow" };
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
      const itemTarget: RefTarget = { id: `${column.id}.${item.id}`, localId: item.id, title: item.type === "grid" ? item.id : item.title, kind: item.type === "flow" ? "flow" : "item" };
      add(itemTarget);
      if (item.type === "flow") {
        flows.push({ flow: item, target: itemTarget });
        for (const step of item.steps) add({ id: `${column.id}.${item.id}.${step.id}`, localId: step.id, title: step.title, kind: "step" });
      } else if (item.type === "grid") {
        for (const card of item.items) add({ id: `${column.id}.${item.id}.${card.id}`, localId: card.id, title: card.title, kind: "item" });
      }
    }
  }
  return { byModel, byLocal, byTitle, flows };
}

function resolveRef(ref: string, refs: RefIndex): RefTarget | undefined {
  if (refs.byModel.has(ref)) return refs.byModel.get(ref);
  const direct = unique(refs.byLocal.get(ref));
  if (direct) return direct;
  const dotted = ref.split(".");
  if (dotted.length === 2) {
    const [flowRef, stepRef] = dotted;
    const flow = refs.flows.find((entry) => equalsLoose(flowRef, entry.flow.id) || equalsLoose(flowRef, entry.flow.label));
    if (flow) {
      const step = flow.flow.steps.find((candidate) => equalsLoose(stepRef, candidate.id) || equalsLoose(slugify(stepRef), candidate.id));
      if (step) {
        const columnId = flow.target.id.split(".")[0];
        return refs.byModel.get(`${columnId}.${flow.flow.id}.${step.id}`);
      }
    }
  }
  const title = unique(refs.byTitle.get(ref.toLowerCase()));
  if (title) return title;
  return unique(refs.byLocal.get(slugify(ref)));
}

function normalizeBadge(raw: JsonRecord, warnings: string[]): NormalizedSpec["badge"] | undefined {
  const badge = valueOf(raw, ["badge"]);
  if (isRecord(badge)) {
    const title = textField(badge, ["title", "label", "name"], SPEC_LIMITS.chipChars, warnings, "badge title");
    if (!title) return undefined;
    const detail = textField(badge, ["detail", "text"], SPEC_LIMITS.chipChars, warnings, "badge detail");
    return detail ? { title, detail } : { title };
  }
  const title = cleanText(badge, SPEC_LIMITS.chipChars, warnings, "badge");
  return title ? { title } : undefined;
}

function normalizeFooter(raw: JsonRecord, warnings: string[]): SpecFooter | undefined {
  const footer = valueOf(raw, ["footer"]);
  if (isRecord(footer)) {
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
  if (arrayField(record, ["items", "cards"]).length) return "grid";
  return "card";
}

function normalizeColumnSize(value: unknown, items: NItem[]): ColumnSize {
  const raw = cleanText(value, 20, [], "size")?.toLowerCase();
  if (raw === "narrow" || raw === "small") return "narrow";
  if (raw === "normal" || raw === "medium") return "normal";
  if (raw === "wide" || raw === "large") return "wide";
  if (items.some((item) => item.type === "flow")) return "wide";
  if (items.some((item) => item.type === "grid")) return "normal";
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
      if (item.type === "grid") return item.items;
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
