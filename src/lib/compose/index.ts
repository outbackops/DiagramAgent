import type { DiagramModel } from "@/lib/model/types";
import { modelToSpec } from "./from-model";
import { layoutSpec, type LayoutOptions, type LayoutReport } from "./layout";
import { normalizeSpec, normalizeSpecText } from "./normalize";
import type { CompositionSpec, NormalizedSpec } from "./spec";

/**
 * Composition in one call: untrusted spec (text or parsed JSON) → normalised
 * spec → laid-out DiagramModel. Throws SpecError when the input is unusable.
 */

export interface ComposeResult {
  model: DiagramModel;
  spec: NormalizedSpec;
  /** Everything the normaliser repaired or dropped. */
  warnings: string[];
  report: LayoutReport;
}

export function composeSpec(raw: unknown, options?: LayoutOptions): ComposeResult {
  const { spec, warnings } = normalizeSpec(raw);
  const { model, report } = layoutSpec(spec, options);
  return { model, spec, warnings, report };
}

export function composeText(text: string, options?: LayoutOptions): ComposeResult {
  const { spec, warnings } = normalizeSpecText(text);
  const { model, report } = layoutSpec(spec, options);
  return { model, spec, warnings, report };
}

/** Page width of a composed model (its header band spans the page). */
export function pageWidthOf(model: DiagramModel | null | undefined): number | undefined {
  if (!model?.composed) return undefined;
  return model.nodes.find((n) => n.role === "header")?.box.w ?? Math.max(0, ...model.nodes.map((n) => n.box.x + n.box.w)) + 40;
}

/** Lays a diagram out again from the spec derived from it (Tidy up for composed diagrams). */
export function recompose(model: DiagramModel): ComposeResult {
  return composeSpec(modelToSpec(model), { preferWidth: pageWidthOf(model) });
}

/** The spec of a model as the text models and people edit: pretty-printed JSON. */
export function specText(spec: CompositionSpec): string {
  return JSON.stringify(spec, null, 2);
}

export function modelSpecText(model: DiagramModel): string {
  return specText(modelToSpec(model));
}

export { layoutSpec, modelToSpec };
export type { LayoutOptions, LayoutReport };
