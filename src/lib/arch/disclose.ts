import { parseSpecText } from "@/lib/compose/normalize";
import { normalizeArchSpec } from "./normalize";
import { undisclosedFacts } from "./quality";
import { ARCH_LIMITS, PROPOSED_PREFIX } from "./spec";

export { PROPOSED_PREFIX };

/**
 * The trust policy's backstop. A model sometimes gives a component an SKU, a count or an address
 * range the user never stated and doesn't list it as an assumption; this lists every such fact
 * under the model's own assumptions (in up to ARCH_LIMITS.disclosureLines lines starting with
 * PROPOSED_PREFIX), so the diagram never shows a proposal as a fact of the user's system.
 *
 * `grounding` is what the user said: the request (clarifying answers included), earlier requests
 * and the spec being edited, whose other facts may be hand edits. Disclosure lines are recomputed
 * on every candidate, and a fact an earlier line lists stays a proposal until a request states it,
 * so a chat edit can't launder it. A spec that doesn't parse comes back unchanged; rendering reports it.
 */
export function discloseProposedFacts(code: string, grounding: readonly string[]): string {
  let raw: unknown;
  let own: string[];
  let previous: string[];
  let facts: string[];
  try {
    raw = parseSpecText(code);
    const { spec } = normalizeArchSpec(raw);
    own = spec.assumptions.filter((a) => !a.startsWith(PROPOSED_PREFIX));
    previous = spec.assumptions.filter((a) => a.startsWith(PROPOSED_PREFIX));
    facts = undisclosedFacts({ ...spec, assumptions: own }, grounding.map(withoutProposals));
  } catch {
    return code;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return code;
  const lines = packLines(facts).slice(0, ARCH_LIMITS.disclosureLines);
  if (lines.length === previous.length && lines.every((line, i) => line === previous[i])) return code;
  // The normaliser reads "assumed" as an alias; the merged list replaces it.
  const next: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  delete next.assumed;
  next.assumptions = [...own, ...lines];
  return JSON.stringify(next, null, 2);
}

/** Facts in as few lines as fit the assumption length. */
function packLines(facts: readonly string[]): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  for (const fact of facts) {
    if (current.length > 0 && (PROPOSED_PREFIX + [...current, fact].join(", ")).length > ARCH_LIMITS.assumptionChars) {
      lines.push(PROPOSED_PREFIX + current.join(", "));
      current = [];
    }
    current.push(fact);
  }
  if (current.length > 0) lines.push(PROPOSED_PREFIX + current.join(", "));
  return lines;
}

/**
 * A source as grounding. The spec being edited carries the last run's disclosure lines: the facts
 * they list were proposals, so they ground nothing there (the user's own requests still can). Each
 * listed fact is removed only as a whole token, so a hand edit such as "13 instances" survives "3 instances".
 */
function withoutProposals(source: string): string {
  if (!source.includes(PROPOSED_PREFIX)) return source;
  const line = new RegExp(`${escapeRegExp(PROPOSED_PREFIX)}([^"\\n]*)`, "g");
  const listed = [...source.matchAll(line)].flatMap((m) => m[1].split(",").map((fact) => fact.trim()).filter(Boolean));
  let out = source.replace(line, "");
  for (const fact of listed) out = out.replace(new RegExp(`(?<![A-Za-z0-9.])${escapeRegExp(fact)}(?![A-Za-z0-9])`, "g"), " ");
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
