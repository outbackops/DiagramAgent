import type { LlmCredentials, LlmUsage, ModelSelection } from "@/lib/llm/types";
import type { DiagramModel } from "@/lib/model/types";
import type { PipelineEvent, PipelineResult, PipelineSteps } from "@/lib/pipeline/refine-loop";
import type { QualityReport } from "@/lib/quality/diagram-quality";

/**
 * What the eval scripts share: loading the app's modules (after the caller has set up the
 * environment), and generating a diagram in a given format through exactly the pipeline the app
 * runs — plan (D2 only), generate, render, the generator's own review and refinement.
 */

export type Format = "d2" | "composition" | "architecture";
export const FORMATS: readonly Format[] = ["d2", "composition", "architecture"];

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  details: Array<{ step: string; usage: LlmUsage }>;
}

export const emptyUsage = (): UsageSummary => ({ calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, details: [] });

export function addUsage(summary: UsageSummary, step: string, usage?: LlmUsage) {
  if (!usage) return;
  summary.calls++;
  summary.inputTokens += usage.inputTokens ?? 0;
  summary.outputTokens += usage.outputTokens ?? 0;
  summary.durationMs += usage.durationMs ?? 0;
  summary.details.push({ step, usage });
}

export async function loadModules() {
  const [llm, selectionLib, server, loop, composePrompt, archPrompt, compose, composeQuality, arch, archNormalize, archQuality, d2, fromD2, renderSvg, diagramQuality, raster, keywords, evalAggregate, judge] =
    await Promise.all([
      import("@/lib/llm"),
      import("@/lib/llm/selection"),
      import("@/lib/pipeline/server"),
      import("@/lib/pipeline/refine-loop"),
      import("@/lib/compose/prompt"),
      import("@/lib/arch/prompt"),
      import("@/lib/compose"),
      import("@/lib/compose/quality"),
      import("@/lib/arch"),
      import("@/lib/arch/normalize"),
      import("@/lib/arch/quality"),
      import("@/lib/d2-render"),
      import("@/lib/model/from-d2"),
      import("@/lib/model/render-svg"),
      import("@/lib/quality/diagram-quality"),
      import("@/lib/svg-raster"),
      import("@/lib/quality/keywords"),
      import("@/lib/eval/aggregate"),
      import("@/lib/eval/judge"),
    ]);
  return { llm, selectionLib, server, loop, composePrompt, archPrompt, compose, composeQuality, arch, archNormalize, archQuality, d2, fromD2, renderSvg, diagramQuality, raster, keywords, evalAggregate, judge };
}

export type Modules = Awaited<ReturnType<typeof loadModules>>;

/** Resolves `provider:model@effort` against the catalog the machine's credentials can use. */
export async function resolveModel(m: Modules, value: string, flag: string, credentials: LlmCredentials): Promise<ModelSelection> {
  const parsed = m.selectionLib.parseSelectionString(value);
  if (!parsed) throw new Error(`Invalid ${flag} selection: ${value}`);
  return m.llm.resolveSelection(parsed, credentials);
}

/** The laid-out model of a finished diagram's code, as the app puts it on the canvas. */
export async function laidOut(m: Modules, format: Format, code: string): Promise<{ model: DiagramModel; warnings: string[] }> {
  if (format === "composition") return m.compose.composeText(code);
  if (format === "architecture") {
    const { model, warnings, report } = await m.arch.composeArchitectureText(code);
    return { model, warnings: [...warnings, ...report.warnings] };
  }
  const { diagram } = await m.d2.compileD2(code);
  return m.fromD2.modelFromCompiled(diagram, { code });
}

/** Renders a candidate in the pipeline: the SVG a reviewer sees and the deterministic quality report. */
export function renderer(m: Modules, format: Format): (code: string) => Promise<{ svg: string; quality: QualityReport }> {
  return async (code) => {
    if (format === "d2") {
      try {
        // Same picture as the app: compile for layout, then the model renderer.
        const { diagram } = await m.d2.compileD2(code);
        const { model } = m.fromD2.modelFromCompiled(diagram, { code });
        return { svg: m.renderSvg.renderModelSvg(model), quality: m.diagramQuality.scoreDiagram(code, diagram) };
      } catch (err) {
        // A full render queue isn't a D2 problem; don't spend a fix round on it.
        if (err instanceof m.d2.D2BusyError) throw new m.loop.RenderUnavailableError(err.message);
        throw err;
      }
    }
    const { model, warnings } = await laidOut(m, format, code);
    const quality = format === "architecture" ? m.archQuality.scoreArchitecture(model, { warnings }) : m.composeQuality.scoreComposition(model, { warnings });
    return { svg: m.renderSvg.renderModelSvg(model, { padding: 0 }), quality };
  };
}

export interface GenerateOptions {
  format: Format;
  prompt: string;
  selection: ModelSelection;
  /** The generator's own reviewer; null skips review. */
  reviewer: ModelSelection | null;
  refinements: number;
  credentials: LlmCredentials;
  signal: AbortSignal;
  usage: UsageSummary;
  onEvent?: (event: PipelineEvent) => void;
}

export async function generateDiagram(m: Modules, o: GenerateOptions): Promise<PipelineResult> {
  const { format, selection, reviewer, credentials, usage } = o;
  const steps: PipelineSteps = {
    language: format === "composition" ? m.composePrompt.COMPOSITION_LANGUAGE : format === "architecture" ? m.archPrompt.ARCHITECTURE_LANGUAGE : undefined,
    plan:
      format === "d2"
        ? async (prompt, analysis, signal) => {
            const result = await m.server.runPlan(prompt, analysis, { selection, credentials, signal });
            addUsage(usage, "plan", result.usage);
            return result.plan;
          }
        : undefined,
    generate: async (input, signal) => {
      const result = await m.server.runGenerate(input, { selection, credentials, signal }, undefined, { format });
      addUsage(usage, "generate", result.usage);
      return result.code;
    },
    render: renderer(m, format),
    assess: reviewer
      ? async (input, signal) => {
          const result = await m.server.runAssess({ svg: input.svg, prompt: input.prompt, d2Code: input.code, format }, { selection: reviewer, credentials, signal });
          addUsage(usage, "assess", result.usage);
          return result.assessment;
        }
      : undefined,
  };
  return m.loop.runDiagramPipeline(steps, { prompt: o.prompt, analysis: null, maxRefinements: o.refinements, signal: o.signal, onEvent: o.onEvent });
}

/** Model families, to warn when a judge isn't independent of the generator. */
export function modelFamily(selection: ModelSelection): string {
  const id = selection.model.toLowerCase();
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("gpt") || /^o\d/.test(id)) return "gpt";
  if (id.startsWith("gemini")) return "gemini";
  return id.split(/[-.]/)[0];
}

export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
