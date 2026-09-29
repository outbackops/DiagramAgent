import { describe, it, expect, vi } from "vitest";
import {
  PipelineAbortError,
  RenderUnavailableError,
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
  scores?: Array<number | ReviewAssessment | Error>;
  renderErrors?: Record<string, string>;
  qualities?: Record<string, QualityReport>;
  withAssess?: boolean;
  plan?: PipelineSteps["plan"];
  assessError?: Error;
  /** Fail the Nth generate call (1-based) with this error. */
  generateErrors?: Record<number, Error>;
}) {
  let version = 0;
  let calls = 0;
  const scores = [...(opts.scores ?? [])];
  const prompts: string[] = [];
  const steps: PipelineSteps = {
    plan: opts.plan ?? (async () => ({ components: [] })),
    generate: vi.fn(async (input) => {
      prompts.push(input.prompt);
      const failure = opts.generateErrors?.[++calls];
      if (failure) throw failure;
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
      const next = scores.shift();
      if (next === undefined) throw new Error("unexpected review");
      if (next instanceof Error) throw next;
      return typeof next === "number" ? review(next) : next;
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

  it("keeps the best candidate when a refinement's model call fails", async () => {
    const { steps } = makeSteps({ scores: [5], generateErrors: { 2: new Error("rate limited") } });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ code: "v1", outcome: "best_effort", bestRound: 0 });
    expect(events).toContainEqual({ type: "refine_error", round: 1, message: "rate limited" });
  });

  it("prefers a reviewed round over one whose review failed", async () => {
    const better: QualityReport = { ...goodQuality, score: 99 };
    const { steps } = makeSteps({ scores: [6, new Error("vision offline")], qualities: { v2: better } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result).toMatchObject({ code: "v1", bestRound: 0 });
    expect(result.assessment?.score).toBe(6);
  });

  it("never keeps a critically broken candidate over a sound reviewed one", async () => {
    const { steps } = makeSteps({ scores: [3], qualities: { v2: brokenQuality } });
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result).toMatchObject({ code: "v1", bestRound: 0 });
    expect(result.assessment?.score).toBe(3);
  });

  it("returns only the kept round's own review", async () => {
    const { steps } = makeSteps({ scores: [review(4)], qualities: { v1: brokenQuality } });
    // v1 is critical (not reviewed) → structural fix → v2 reviewed 4 and kept.
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1 });
    expect(result).toMatchObject({ code: "v2", bestRound: 1 });
    expect(result.assessment?.score).toBe(4);
  });

  it("does not let an unparsable review steer refinement", async () => {
    const placeholder = { ...review(5), parse_error: "Unexpected token" } as ReviewAssessment;
    const { steps } = makeSteps({ scores: [placeholder] });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ code: "v1", outcome: "unreviewed", reviews: 0, assessment: null });
    expect(steps.generate).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "review_error")).toBe(true);
  });

  it("carries the best rendered code when cancelled mid-refinement", async () => {
    const controller = new AbortController();
    const { steps } = makeSteps({ scores: [5] });
    const generate = steps.generate;
    steps.generate = vi.fn(async (input, signal) => {
      if (input.existingCode) {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }
      return generate(input, signal);
    });
    const err = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1, signal: controller.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineAbortError);
    expect((err as PipelineAbortError).bestCode).toBe("v1");
  });

  it("keeps the rendered draft when cancelled while it is being reviewed", async () => {
    const controller = new AbortController();
    const { steps } = makeSteps({ scores: [5] });
    steps.assess = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const err = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1, signal: controller.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineAbortError);
    expect(err).toMatchObject({ bestCode: "v1", bestRound: 0 });
  });

  it("on cancel, prefers the best reviewed round over a newer draft still under review", async () => {
    const controller = new AbortController();
    const { steps } = makeSteps({ scores: [6] });
    const assess = steps.assess!;
    let calls = 0;
    steps.assess = vi.fn(async (input, signal) => {
      if (++calls === 2) {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }
      return assess(input, signal);
    });
    const err = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1, signal: controller.signal }).catch((e) => e);
    expect(err).toMatchObject({ bestCode: "v1", bestRound: 0 });
  });

  it("carries no code when cancelled before anything rendered", async () => {
    const controller = new AbortController();
    const { steps } = makeSteps({});
    steps.generate = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const err = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 1, signal: controller.signal }).catch((e) => e);
    expect(err).toMatchObject({ bestCode: null, bestRound: null });
  });

  it("doesn't spend a syntax-fix round when the renderer is unavailable", async () => {
    const { steps } = makeSteps({ scores: [] });
    steps.render = vi.fn(async () => {
      throw new RenderUnavailableError("Renderer is busy, try again shortly");
    });
    const err = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(RenderUnavailableError);
    expect(err.message).toBe("Renderer is busy, try again shortly");
    // The finished draft comes back with the error so it isn't lost.
    expect(err.candidate).toEqual({ code: "v1", round: 0 });
    expect(steps.generate).toHaveBeenCalledTimes(1);
  });

  it("keeps the best candidate when the renderer becomes unavailable mid-refinement", async () => {
    const { steps } = makeSteps({ scores: [5] });
    const render = steps.render;
    steps.render = vi.fn(async (code: string, signal?: AbortSignal) => {
      if (code === "v2") throw new RenderUnavailableError("Renderer is busy, try again shortly");
      return render(code, signal);
    });
    const events: PipelineEvent[] = [];
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 2, onEvent: (e) => events.push(e) });
    expect(result).toMatchObject({ code: "v1", bestRound: 0, outcome: "best_effort", refinements: 1 });
    expect(steps.generate).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({ type: "render_error", round: 1, message: "Renderer is busy, try again shortly" });
  });
  it("uses an injected language for initial, render, structural, and review prompts", async () => {
    const language = {
      initialPrompt: vi.fn(() => "CUSTOM INITIAL"),
      renderFixPrompt: vi.fn((message: string) => `CUSTOM RENDER ${message}`),
      structuralFixPrompt: vi.fn(() => "CUSTOM STRUCTURAL"),
      reviewFixPrompt: vi.fn(() => "CUSTOM REVIEW"),
    };

    const renderCase = makeSteps({ scores: [8], renderErrors: { v1: "bad spec" } });
    renderCase.steps.language = language;
    await runDiagramPipeline(renderCase.steps, { prompt: "p", analysis: { domain: "x" }, maxRefinements: 1 });
    expect(language.initialPrompt).toHaveBeenCalledWith("p", { components: [] }, { domain: "x" });
    expect(language.renderFixPrompt).toHaveBeenCalledWith("bad spec");
    expect(renderCase.prompts).toEqual(["CUSTOM INITIAL", "CUSTOM RENDER bad spec"]);

    const structuralCase = makeSteps({ withAssess: false, qualities: { v1: brokenQuality } });
    structuralCase.steps.language = language;
    await runDiagramPipeline(structuralCase.steps, { prompt: "p", maxRefinements: 1 });
    expect(language.structuralFixPrompt).toHaveBeenCalledWith(brokenQuality);
    expect(structuralCase.prompts[1]).toBe("CUSTOM STRUCTURAL");

    const reviewCase = makeSteps({ scores: [5, 8] });
    reviewCase.steps.language = language;
    await runDiagramPipeline(reviewCase.steps, { prompt: "p", maxRefinements: 1 });
    expect(language.reviewFixPrompt).toHaveBeenCalled();
    expect(reviewCase.prompts[1]).toBe("CUSTOM REVIEW");
  });

  it("finalizes every candidate before rendering, grounded in what the user said", async () => {
    const finalize = vi.fn((code: string) => `${code}+disclosed`);
    const language = { initialPrompt: () => "INITIAL", renderFixPrompt: () => "FIX", structuralFixPrompt: () => "FIX", reviewFixPrompt: () => "FIX", finalize };
    const { steps } = makeSteps({ scores: [5, 8] });
    steps.language = language;
    const result = await runDiagramPipeline(steps, {
      prompt: "add a cache",
      existingCode: "{ spec }",
      history: [{ role: "user", content: "a web app on P1v3" }, { role: "assistant", content: "done" }],
      maxRefinements: 1,
    });
    // The model's plan and the fix prompts never count as grounding; the edited code and earlier requests do.
    expect(finalize).toHaveBeenNthCalledWith(1, "v1", ["add a cache", "a web app on P1v3", "{ spec }"]);
    expect(finalize).toHaveBeenNthCalledWith(2, "v2", ["add a cache", "a web app on P1v3", "{ spec }"]);
    expect(steps.render).toHaveBeenCalledWith("v1+disclosed", undefined);
    expect(result.code).toBe("v2+disclosed");
  });

  it("keeps a candidate as generated when finalizing it throws", async () => {
    const language = { initialPrompt: () => "INITIAL", renderFixPrompt: () => "FIX", structuralFixPrompt: () => "FIX", reviewFixPrompt: () => "FIX", finalize: () => { throw new Error("boom"); } };
    const { steps } = makeSteps({ scores: [8] });
    steps.language = language;
    const result = await runDiagramPipeline(steps, { prompt: "p", maxRefinements: 0 });
    expect(result.code).toBe("v1");
  });

});
