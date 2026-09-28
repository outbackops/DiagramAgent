import { describe, it, expect, vi } from "vitest";
import {
  PipelineAbortError,
  runDiagramPipeline,
  type PipelineEvent,
  type PipelineSteps,
  type ReviewAssessment,
} from "./refine-loop";
import type { QualityReport } from "@/lib/quality/diagram-quality";

const goodQuality: QualityReport = {
  score: 92,
  grade: "A",
  checks: [{ id: "connections", label: "Components are connected", severity: "critical", status: "pass", detail: "4 connections" }],
  metrics: { nodes: 5, containers: 1, connections: 4, maxDepth: 2, width: 800, height: 400, aspectRatio: 2, iconCoverage: 1, labelCoverage: 1, crossings: 0, orphans: 0, edgesThroughNodes: 0 },
};
const brokenQuality: QualityReport = {
  ...goodQuality,
  score: 60,
  grade: "D",
  checks: [{ id: "phantom_nodes", label: "No duplicate nodes", severity: "critical", status: "fail", detail: "Duplicated: Web" }],
};

const review = (score: number, extra: Partial<ReviewAssessment> = {}): ReviewAssessment => ({
  score,
  pass: score >= 7,
  layout_issues: score >= 7 ? [] : [`issue at ${score}`],
  specific_fixes: score >= 7 ? [] : [`fix at ${score}`],
  ...extra,
});

/** Steps whose generate() returns v1, v2, ... and whose assess() returns scores in order. */
function makeSteps(opts: {
  scores?: number[];
  renderErrors?: Record<string, string>;
  qualities?: Record<string, QualityReport>;
  withAssess?: boolean;
  plan?: PipelineSteps["plan"];
  assessError?: Error;
}) {
  let version = 0;
  const scores = [...(opts.scores ?? [])];
  const prompts: string[] = [];
  const steps: PipelineSteps = {
    plan: opts.plan ?? (async () => ({ components: [] })),
    generate: vi.fn(async (input) => {
      prompts.push(input.prompt);
      return `v${++version}`;
    }),
    render: vi.fn(async (code: string) => {
      const error = opts.renderErrors?.[code];
      if (error) throw new Error(error);
      return { svg: `<svg>${code}</svg>`, quality: opts.qualities?.[code] ?? goodQuality };
    }),
  };
  if (opts.withAssess !== false) {
    steps.assess = vi.fn(async () => {
      if (opts.assessError) throw opts.assessError;
      const score = scores.shift();
      if (score === undefined) throw new Error("unexpected review");
      return review(score);
    });
  }
  return { steps, prompts };
}

describe("runDiagramPipeline", () => {
  it("plans, generates, reviews once and stops when the review passes", async () => {
    const { steps, prompts } = makeSteps({ scores: [8] });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "three tier app", maxRefinements: 2, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ code: "v1", outcome: "verified", refinements: 0, reviews: 1, svg: "<svg>v1</svg>" });
    expect(prompts[0]).toContain("ARCHITECTURE PLAN:");
    expect(events.filter((e) => e.type === "phase").map((e) => (e as { phase: string }).phase)).toEqual([
      "planning",
      "generating",
      "rendering",
      "reviewing",
    ]);
  });

  it("edits skip planning and send the request as-is", async () => {
    const { steps, prompts } = makeSteps({ scores: [9] });
    await runDiagramPipeline(steps, { prompt: "add a cache", existingCode: "a -> b", maxRefinements: 1 });
    expect(prompts[0]).toBe("add a cache");
    expect(steps.generate).toHaveBeenCalledWith({ prompt: "add a cache", existingCode: "a -> b", history: [] }, undefined);
  });

  it("refines on a failing review and keeps the passing refinement", async () => {
    const { steps, prompts } = makeSteps({ scores: [5, 8] });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2 });
    expect(result).toMatchObject({ code: "v2", outcome: "verified", refinements: 1, reviews: 2 });
    expect(prompts[1]).toContain("issue at 5");
    expect(prompts[1]).toContain("fix at 5");
  });

  it("reviews the final refinement instead of discarding it", async () => {
    const { steps } = makeSteps({ scores: [5, 6] });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(steps.assess).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ code: "v2", outcome: "best_effort", reviews: 2, refinements: 1 });
    expect(result.assessment?.score).toBe(6);
  });

  it("keeps the best candidate when a refinement regresses", async () => {
    const { steps } = makeSteps({ scores: [6, 4] });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result.code).toBe("v1");
    expect(result.bestRound).toBe(0);
    expect(result.assessment?.score).toBe(6);
    expect(result.rounds.map((r) => r.reviewScore)).toEqual([6, 4]);
  });

  it("breaks review-score ties with deterministic quality", async () => {
    const better: QualityReport = { ...goodQuality, score: 97 };
    const { steps } = makeSteps({ scores: [6, 6], qualities: { v2: better } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result).toMatchObject({ code: "v2", bestRound: 1 });
  });

  it("stops after two non-improving rounds", async () => {
    const { steps } = makeSteps({ scores: [6, 5, 5] });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 5 });
    expect(result.refinements).toBe(2);
    expect(steps.assess).toHaveBeenCalledTimes(3);
  });

  it("asks the model to fix render errors, then continues", async () => {
    const { steps, prompts } = makeSteps({ scores: [8], renderErrors: { v1: "unexpected token at line 3" } });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1, onEvent: (e) => events.push(e) });
    expect(prompts[1]).toContain('rendering error: "unexpected token at line 3"');
    expect(result).toMatchObject({ code: "v2", outcome: "verified" });
    expect(events).toContainEqual({ type: "render_error", round: 0, message: "unexpected token at line 3" });
  });

  it("reports render_failed when nothing ever renders", async () => {
    const { steps } = makeSteps({ renderErrors: { v1: "bad", v2: "still bad" } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result).toMatchObject({ outcome: "render_failed", code: "v2", svg: null });
  });

  it("fixes critical structural failures before spending a review", async () => {
    const { steps, prompts } = makeSteps({ scores: [9], qualities: { v1: brokenQuality } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(steps.assess).toHaveBeenCalledTimes(1);
    expect(prompts[1]).toContain("Duplicated: Web");
    expect(result).toMatchObject({ code: "v2", outcome: "verified" });
  });

  it("without a reviewer, renders once and stops when structurally sound", async () => {
    const { steps } = makeSteps({ withAssess: false });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 3 });
    expect(steps.generate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: "unreviewed", code: "v1", quality: goodQuality });
  });

  it("without a reviewer, still repairs structural failures", async () => {
    const { steps } = makeSteps({ withAssess: false, qualities: { v1: brokenQuality } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(steps.generate).toHaveBeenCalledTimes(2);
    expect(result.code).toBe("v2");
  });

  it("treats review failures as non-fatal", async () => {
    const { steps } = makeSteps({ assessError: new Error("vision offline") });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ outcome: "unreviewed", code: "v1" });
    expect(events).toContainEqual({ type: "review_error", round: 0, message: "vision offline" });
  });

  it("continues without a plan when planning fails", async () => {
    const { steps, prompts } = makeSteps({
      scores: [8],
      plan: async () => {
        throw new Error("planner timeout");
      },
    });
    const events: PipelineEvent[] = [];
    await runDiagramPipeline(steps, { prompt: "raw request", maxRefinements: 0, onEvent: (e) => events.push(e) });
    expect(prompts[0]).toBe("raw request");
    expect(events).toContainEqual({ type: "plan", plan: null, error: "planner timeout" });
  });

  it("honours cancellation between steps", async () => {
    const controller = new AbortController();
    const { steps } = makeSteps({ scores: [5, 8] });
    steps.render = vi.fn(async (code: string) => {
      controller.abort();
      return { svg: `<svg>${code}</svg>`, quality: goodQuality };
    });
    await expect(runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2, signal: controller.signal })).rejects.toBeInstanceOf(
      PipelineAbortError,
    );
    expect(steps.assess).not.toHaveBeenCalled();
  });

  it("clamps the refinement budget", async () => {
    const { steps } = makeSteps({ scores: [1, 2, 3, 4, 5, 6, 6.5] });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 99 });
    expect(result.refinements).toBe(5);
  });
});
