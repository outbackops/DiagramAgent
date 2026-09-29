import type { DiagramModel } from "@/lib/model/types";
import { layoutArchitecture, type ArchLayoutOptions, type ArchLayoutReport } from "./layout";
import { normalizeArchSpec, normalizeArchSpecText } from "./normalize";
import type { NormalizedArchSpec } from "./spec";

export interface ArchComposeResult {
  model: DiagramModel;
  spec: NormalizedArchSpec;
  /** Repairs the normaliser made (every one is reported). */
  warnings: string[];
  report: ArchLayoutReport;
}

/** Spec (parsed JSON) → normalised spec → laid-out model. Throws SpecError for irreparable input. */
export async function composeArchitecture(raw: unknown, options: ArchLayoutOptions = {}): Promise<ArchComposeResult> {
  const { spec, warnings } = normalizeArchSpec(raw);
  const { model, report } = await layoutArchitecture(spec, options);
  return { model, spec, warnings, report };
}

/** Spec text (model output, fences and comments allowed) → laid-out model. */
export async function composeArchitectureText(text: string, options: ArchLayoutOptions = {}): Promise<ArchComposeResult> {
  const { spec, warnings } = normalizeArchSpecText(text);
  const { model, report } = await layoutArchitecture(spec, options);
  return { model, spec, warnings, report };
}

export { layoutArchitecture } from "./layout";
export type { ArchLayoutOptions, ArchLayoutReport } from "./layout";
