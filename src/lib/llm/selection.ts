import { LlmError } from "./errors";
import {
  REASONING_EFFORTS,
  type CatalogModel,
  type ModelSelection,
  type ProviderId,
  type ReasoningEffort,
} from "./types";

export const DEFAULT_SELECTION: ModelSelection = {
  provider: "copilot",
  model: "claude-opus-5.5",
  reasoningEffort: "medium",
};

/** Tried in order when the preferred default is missing from the account's catalog. */
export const FALLBACK_MODEL_PREFERENCE = [
  "claude-opus-5.5",
  "claude-opus-5",
  "claude-sonnet-5",
  "gpt-5.5",
  "gpt-5.4",
  "claude-opus-4.8",
  "claude-sonnet-4.5",
];

const PROVIDERS: readonly ProviderId[] = ["copilot", "azure"];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Parse `provider:model@effort` (provider and effort optional), e.g.
 * `copilot:claude-opus-5.5@medium`, `azure:gpt-4o`, `gpt-5.5@high`.
 */
export function parseSelectionString(value: string, fallbackProvider: ProviderId = "copilot"): ModelSelection | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let provider: ProviderId = fallbackProvider;
  let rest = trimmed;
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const maybeProvider = trimmed.slice(0, colon);
    if (!isProviderId(maybeProvider)) return null;
    provider = maybeProvider;
    rest = trimmed.slice(colon + 1);
  }

  let reasoningEffort: ReasoningEffort | undefined;
  const at = rest.lastIndexOf("@");
  if (at > 0) {
    const effort = rest.slice(at + 1);
    if (!isReasoningEffort(effort)) return null;
    reasoningEffort = effort;
    rest = rest.slice(0, at);
  }

  if (!/^[A-Za-z0-9._\-/]+$/.test(rest)) return null;
  return reasoningEffort ? { provider, model: rest, reasoningEffort } : { provider, model: rest };
}

export function formatSelection(selection: ModelSelection): string {
  const effort = selection.reasoningEffort ? `@${selection.reasoningEffort}` : "";
  return `${selection.provider}:${selection.model}${effort}`;
}

/** Validate an untrusted selection from a request body; null when absent or malformed. */
export function coerceSelection(value: unknown): ModelSelection | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isProviderId(v.provider)) return null;
  if (typeof v.model !== "string" || !/^[A-Za-z0-9._\-/]{1,100}$/.test(v.model)) return null;
  const selection: ModelSelection = { provider: v.provider, model: v.model };
  if (v.reasoningEffort !== undefined && v.reasoningEffort !== null) {
    if (!isReasoningEffort(v.reasoningEffort)) return null;
    selection.reasoningEffort = v.reasoningEffort;
  }
  return selection;
}

let warnedBadDefault = false;

/** The configured default (DIAGRAM_AGENT_DEFAULT_MODEL) or Claude Opus 5.5 @ medium. */
export function getDefaultSelection(): ModelSelection {
  const raw = process.env.DIAGRAM_AGENT_DEFAULT_MODEL;
  if (raw) {
    const parsed = parseSelectionString(raw);
    if (parsed) return parsed;
    if (!warnedBadDefault) {
      warnedBadDefault = true;
      console.warn(`DIAGRAM_AGENT_DEFAULT_MODEL="${raw}" is not valid (expected provider:model@effort); using default`);
    }
  }
  return { ...DEFAULT_SELECTION };
}

function normalizeEffort(model: CatalogModel, requested?: ReasoningEffort): ReasoningEffort | undefined {
  if (model.reasoningEfforts.length === 0) return undefined;
  if (requested && model.reasoningEfforts.includes(requested)) return requested;
  if (model.defaultReasoningEffort && model.reasoningEfforts.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return model.reasoningEfforts.includes("medium") ? "medium" : undefined;
}

/**
 * Check a selection against the catalog the caller is entitled to. Unknown
 * models are rejected (the Copilot runtime would otherwise silently fall back
 * to a different model); unsupported reasoning efforts are normalised.
 */
export function validateSelection(selection: ModelSelection, catalog: CatalogModel[]): ModelSelection {
  const model = catalog.find((m) => m.provider === selection.provider && m.id === selection.model);
  if (!model) {
    throw new LlmError(
      "model_unavailable",
      `Model "${selection.model}" is not available for this account. Pick another model.`,
    );
  }
  const reasoningEffort = normalizeEffort(model, selection.reasoningEffort);
  return reasoningEffort
    ? { provider: model.provider, model: model.id, reasoningEffort }
    : { provider: model.provider, model: model.id };
}

/** Best default for this catalog: the configured default, then the preference list, then anything. */
export function pickDefaultSelection(catalog: CatalogModel[], preferred: ModelSelection = getDefaultSelection()): ModelSelection | null {
  if (catalog.length === 0) return null;
  const candidates: ModelSelection[] = [
    preferred,
    ...FALLBACK_MODEL_PREFERENCE.map((model) => ({ provider: preferred.provider, model, reasoningEffort: preferred.reasoningEffort })),
  ];
  for (const candidate of candidates) {
    const found = catalog.find((m) => m.provider === candidate.provider && m.id === candidate.model);
    if (found) return validateSelection(candidate, catalog);
  }
  const first = catalog[0];
  return validateSelection({ provider: first.provider, model: first.id, reasoningEffort: preferred.reasoningEffort }, catalog);
}
