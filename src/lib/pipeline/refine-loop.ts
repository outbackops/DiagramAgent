import type { QualityReport } from "@/lib/quality/diagram-quality";
import { composeGenerationPrompt } from "./d2-text";

/**
 * Plan → generate → render → review → refine, with a best-candidate guard.
 *
 * Pure orchestration over injected steps so the browser (fetching the API
 * routes) and the eval harness (calling server functions directly) run the
 * exact same loop. Every refined candidate is rendered and reviewed before
 * the loop ends — the best one wins.
 */

export interface ReviewAssessment {
  score: number;
  pass: boolean;
  reasoning?: string;
  missing_components?: string[];
  layout_issues?: string[];
  specific_fixes?: string[];
}

export interface RenderOutcome {
  svg: string;
  quality: QualityReport | null;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PipelineSteps {
  /** Architecture plan for new diagrams. Failures are non-fatal. */
  plan?: (prompt: string, analysis: unknown, signal?: AbortSignal) => Promise<Record<string, unknown> | null>;
  /** Returns the complete, cleaned D2 code (implementations may stream as they go). */
  generate: (input: { prompt: string; existingCode: string; history: ConversationTurn[] }, signal?: AbortSignal) => Promise<string>;
  /** Throws with the D2 error message when the code does not compile. */
  render: (code: string, signal?: AbortSignal) => Promise<RenderOutcome>;
  /** Vision review. Omit to skip model review (deterministic checks still run). */
  assess?: (input: { svg: string; prompt: string; code: string }, signal?: AbortSignal) => Promise<ReviewAssessment>;
}

export type PipelinePhase = "planning" | "generating" | "rendering" | "reviewing" | "refining" | "fixing";

export type PipelineEvent =
  | { type: "phase"; phase: PipelinePhase; round: number }
  | { type: "plan"; plan: Record<string, unknown> | null; error?: string }
  | { type: "candidate"; round: number; code: string }
  | { type: "rendered"; round: number; svg: string; quality: QualityReport | null }
  | { type: "render_error"; round: number; message: string }
  | { type: "assessment"; round: number; assessment: ReviewAssessment }
  | { type: "review_error"; round: number; message: string };

export interface PipelineOptions {
  prompt: string;
  existingCode?: string;
  history?: ConversationTurn[];
  analysis?: unknown;
  /** Refinement rounds allowed after the first candidate (0–5). */
  maxRefinements: number;
  signal?: AbortSignal;
  onEvent?: (event: PipelineEvent) => void;
}

export type PipelineOutcome = "verified" | "best_effort" | "unreviewed" | "render_failed";

export interface RoundRecord {
  round: number;
  reviewScore?: number;
  qualityScore?: number;
  renderError?: string;
}

export interface PipelineResult {
  code: string;
  svg: string | null;
  quality: QualityReport | null;
  assessment: ReviewAssessment | null;
  outcome: PipelineOutcome;
  refinements: number;
  reviews: number;
  rounds: RoundRecord[];
  plan: Record<string, unknown> | null;
  /** Round whose candidate was kept (null when nothing rendered). */
  bestRound: number | null;
}

export class PipelineAbortError extends Error {
  constructor() {
    super("Generation was cancelled");
    this.name = "AbortError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new PipelineAbortError();
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || (err as { code?: string }).code === "aborted");
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join("\n");

function failedChecks(quality: QualityReport | null): string[] {
  if (!quality) return [];
  return quality.checks.filter((c) => c.status === "fail").map((c) => `${c.label} — ${c.detail}`);
}

function hasCriticalFailure(quality: QualityReport | null): boolean {
  return Boolean(quality?.checks.some((c) => c.severity === "critical" && c.status === "fail"));
}

export function renderFixPrompt(message: string): string {
  return `The D2 code has a rendering error: "${message}". Fix the D2 syntax while keeping the architecture intact. Output the COMPLETE corrected D2 code.`;
}

export function structuralFixPrompt(quality: QualityReport): string {
  return `A deterministic structural analysis of the rendered diagram found these problems (quality score ${quality.score}/100):

Issues:
${numbered(failedChecks(quality))}

Fix these issues in the D2 code. Every connection must use the fully qualified path of a declared node. Output the COMPLETE updated D2 code.`;
}

export function reviewFixPrompt(assessment: ReviewAssessment, quality: QualityReport | null): string {
  const issues = [
    ...(assessment.missing_components ?? []).map((c) => `Missing: ${c}`),
    ...(assessment.layout_issues ?? []),
    ...failedChecks(quality).map((c) => `Structural check: ${c}`),
  ];
  const fixes = assessment.specific_fixes ?? [];
  return `A vision-based assessment of the rendered diagram found these issues (score ${assessment.score}/10):

Issues:
${numbered(issues.length > 0 ? issues : ["Improve overall clarity and layout"])}

Suggested fixes:
${numbered(fixes.length > 0 ? fixes : ["Tighten grouping and alignment"])}

Fix these issues in the D2 code. Maintain the overall architecture but improve layout, grouping, connections, and completeness.

If the issues mention extreme aspect ratio, long horizontal strip, backward flow, detached labels, or long crossing telemetry/security lines, do a layout rewrite instead of local edits:
1. Reduce top-level horizontal siblings; keep global direction right, but add local direction: down inside operations, security, observability, management, CI/CD, and other sidecar containers.
2. Use compact two-row or two-column grouping for complex systems instead of one long chain.
3. Move external actors next to the boundary they connect to.
4. Move monitoring/security/identity/backup sidecars near the resources they serve.
5. Collapse repeated telemetry or logging edges into a small number of labelled aggregate edges when that preserves intent.

Output the COMPLETE updated D2 code.`;
}

interface Candidate {
  round: number;
  code: string;
  svg: string;
  quality: QualityReport | null;
  assessment: ReviewAssessment | null;
  score: number;
}

/** Comparable 0–10 score: the reviewer's score when available, else deterministic quality. Quality breaks review ties. */
function candidateScore(quality: QualityReport | null, assessment: ReviewAssessment | null): number {
  const penalty = hasCriticalFailure(quality) ? 3 : 0;
  if (assessment) return assessment.score - penalty + (quality ? quality.score / 1000 : 0);
  return (quality ? quality.score / 10 : 5) - penalty;
}

export async function runDiagramPipeline(steps: PipelineSteps, options: PipelineOptions): Promise<PipelineResult> {
  const { signal, onEvent } = options;
  const emit = (event: PipelineEvent) => onEvent?.(event);
  const existingCode = options.existingCode ?? "";
  const maxRefinements = Math.max(0, Math.min(5, Math.floor(options.maxRefinements)));

  let plan: Record<string, unknown> | null = null;
  if (!existingCode && steps.plan) {
    emit({ type: "phase", phase: "planning", round: 0 });
    try {
      plan = await steps.plan(options.prompt, options.analysis ?? null, signal);
      emit({ type: "plan", plan });
    } catch (err) {
      if (isAbort(err)) throw new PipelineAbortError();
      emit({ type: "plan", plan: null, error: errText(err) });
    }
    throwIfAborted(signal);
  }

  emit({ type: "phase", phase: "generating", round: 0 });
  let code = await steps.generate(
    {
      prompt: existingCode ? options.prompt : composeGenerationPrompt(options.prompt, plan),
      existingCode,
      history: options.history ?? [],
    },
    signal,
  );
  throwIfAborted(signal);
  emit({ type: "candidate", round: 0, code });

  const rounds: RoundRecord[] = [];
  let best: Candidate | null = null;
  let lastAssessment: ReviewAssessment | null = null;
  let refinements = 0;
  let reviews = 0;
  let reviewing = Boolean(steps.assess);
  let passed = false;
  let nonImproving = 0;

  for (let round = 0; ; round++) {
    emit({ type: "phase", phase: "rendering", round });
    let rendered: RenderOutcome;
    try {
      rendered = await steps.render(code, signal);
    } catch (err) {
      if (isAbort(err)) throw new PipelineAbortError();
      const message = errText(err);
      rounds.push({ round, renderError: message });
      emit({ type: "render_error", round, message });
      if (refinements >= maxRefinements) break;
      refinements++;
      emit({ type: "phase", phase: "fixing", round: round + 1 });
      code = await steps.generate({ prompt: renderFixPrompt(message), existingCode: code, history: [] }, signal);
      throwIfAborted(signal);
      emit({ type: "candidate", round: round + 1, code });
      continue;
    }
    throwIfAborted(signal);
    emit({ type: "rendered", round, svg: rendered.svg, quality: rendered.quality });

    const critical = hasCriticalFailure(rendered.quality);
    let assessment: ReviewAssessment | null = null;
    if (reviewing && steps.assess && !critical) {
      emit({ type: "phase", phase: "reviewing", round });
      try {
        assessment = await steps.assess({ svg: rendered.svg, prompt: options.prompt, code }, signal);
        reviews++;
        lastAssessment = assessment;
        emit({ type: "assessment", round, assessment });
      } catch (err) {
        if (isAbort(err)) throw new PipelineAbortError();
        reviewing = false;
        emit({ type: "review_error", round, message: errText(err) });
      }
      throwIfAborted(signal);
    }

    const score = candidateScore(rendered.quality, assessment);
    rounds.push({ round, reviewScore: assessment?.score, qualityScore: rendered.quality?.score });
    const candidate: Candidate = { round, code, svg: rendered.svg, quality: rendered.quality, assessment, score };
    if (!best || score > best.score) {
      best = candidate;
      nonImproving = 0;
    } else {
      nonImproving++;
    }

    passed = assessment ? assessment.pass && !critical : !critical;
    if (passed && (assessment || !reviewing)) break;
    if (refinements >= maxRefinements || nonImproving >= 2) break;
    // Without a review, only structural failures give us something to fix.
    if (!assessment && !critical) break;

    refinements++;
    emit({ type: "phase", phase: "refining", round: round + 1 });
    const prompt = assessment ? reviewFixPrompt(assessment, rendered.quality) : structuralFixPrompt(rendered.quality!);
    code = await steps.generate({ prompt, existingCode: code, history: [] }, signal);
    throwIfAborted(signal);
    emit({ type: "candidate", round: round + 1, code });
  }

  if (!best) {
    return { code, svg: null, quality: null, assessment: null, outcome: "render_failed", refinements, reviews, rounds, plan, bestRound: null };
  }

  const bestPassed = best.assessment ? best.assessment.pass && !hasCriticalFailure(best.quality) : false;
  const outcome: PipelineOutcome = bestPassed ? "verified" : reviews > 0 ? "best_effort" : "unreviewed";
  return {
    code: best.code,
    svg: best.svg,
    quality: best.quality,
    assessment: best.assessment ?? (reviews > 0 ? lastAssessment : null),
    outcome,
    refinements,
    reviews,
    rounds,
    plan,
    bestRound: best.round,
  };
}
