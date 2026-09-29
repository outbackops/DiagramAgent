import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ClarifyPanel, { type ClarifyQuestion } from "./ClarifyPanel";
import ModelPicker from "./ModelPicker";
import ReviewPanel from "./ReviewPanel";
import RunCard from "./RunCard";
import type { RunRecord } from "@/hooks/useDiagramAgent";
import type { CatalogModel } from "@/lib/llm/types";

afterEach(cleanup);

const QUESTIONS: ClarifyQuestion[] = [
  {
    id: "q1",
    question: "Which cloud?",
    type: "single",
    options: [
      { label: "Azure", value: "azure" },
      { label: "Other", value: "other" },
    ],
  },
  {
    id: "q2",
    question: "Which extras?",
    type: "multi",
    options: [
      { label: "CDN", value: "cdn" },
      { label: "WAF", value: "waf" },
    ],
  },
];

describe("ClarifyPanel", () => {
  it("enables Generate only after an answer and merges Other text", () => {
    const onSubmit = vi.fn();
    render(<ClarifyPanel questions={QUESTIONS} onSubmit={onSubmit} onSkip={() => {}} />);
    const generate = screen.getByRole("button", { name: /Generate diagram/ });
    expect(generate).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("Other answer for: Which cloud?"), { target: { value: "Hetzner" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "CDN" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "WAF" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CDN" }));

    expect(screen.getByText("2/2")).toBeTruthy();
    fireEvent.click(generate);
    expect(onSubmit).toHaveBeenCalledWith({ q1: "other: Hetzner", q2: ["waf"] });
  });

  it("clears the Other text when switching away from Other", () => {
    const onSubmit = vi.fn();
    render(<ClarifyPanel questions={QUESTIONS} onSubmit={onSubmit} onSkip={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.change(screen.getByLabelText("Other answer for: Which cloud?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("radio", { name: "Azure" }));
    expect(screen.queryByLabelText("Other answer for: Which cloud?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Generate diagram/ }));
    expect(onSubmit).toHaveBeenCalledWith({ q1: "azure" });
  });

  it("calls onSkip", () => {
    const onSkip = vi.fn();
    render(<ClarifyPanel questions={QUESTIONS} onSubmit={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip questions" }));
    expect(onSkip).toHaveBeenCalled();
  });
});

const MODELS: CatalogModel[] = [
  { provider: "copilot", id: "gpt-5.5", name: "GPT-5.5", vision: true, reasoningEfforts: ["low", "medium", "high"] },
  { provider: "copilot", id: "claude-opus-5.5", name: "Claude Opus 5.5", vision: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] },
  { provider: "copilot", id: "claude-haiku-4.5", name: "Claude Haiku 4.5", vision: true, reasoningEfforts: [] },
];
const DEFAULT = { provider: "copilot" as const, model: "claude-opus-5.5", reasoningEffort: "medium" as const };

describe("ModelPicker", () => {
  it("lists the default model first and changes reasoning effort", () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MODELS} selection={DEFAULT} defaultSelection={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Claude Opus 5\.5/ }));
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("Claude Opus 5.5");
    expect(options[0].textContent).toContain("Default");

    fireEvent.click(screen.getByRole("radio", { name: "high" }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, reasoningEffort: "high" });
  });

  it("keeps a compatible effort when switching models and drops it when unsupported", () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MODELS} selection={DEFAULT} defaultSelection={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Claude Opus 5\.5/ }));
    fireEvent.click(screen.getByRole("option", { name: /GPT-5\.5/ }));
    expect(onChange).toHaveBeenLastCalledWith({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "medium" });
    fireEvent.click(screen.getByRole("option", { name: /Claude Haiku 4\.5/ }));
    expect(onChange).toHaveBeenLastCalledWith({ provider: "copilot", model: "claude-haiku-4.5" });
  });

  it("filters by search", () => {
    render(<ModelPicker models={MODELS} selection={DEFAULT} defaultSelection={DEFAULT} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Claude Opus 5\.5/ }));
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "haiku" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Claude Haiku 4.5")]);
  });
});

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    id: "r1",
    mode: "create",
    prompt: "p",
    status: "done",
    steps: [{ key: "k", phase: "generating", round: 0, status: "done", startedAt: 0, endedAt: 12_000 }],
    startedAt: 0,
    endedAt: 65_000,
    model: DEFAULT,
    reviews: [],
    notes: [],
    ...overrides,
  };
}

describe("ReviewPanel", () => {
  const assessment = { score: 6, pass: false, reasoning: "Readable but cluttered.", layout_issues: ["Edge crosses the Data zone"], specific_fixes: ["Move Redis next to the API"] };

  it("offers to apply the reviewer's fixes", () => {
    const onApply = vi.fn();
    render(<ReviewPanel run={run({ reviews: [{ round: 0, assessment }], reviewer: DEFAULT })} models={MODELS} reviewEnabled canApply onApply={onApply} />);
    expect(screen.getByText("Readable but cluttered.")).toBeTruthy();
    expect(screen.getByText("Edge crosses the Data zone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply suggested fixes" }));
    expect(onApply).toHaveBeenCalledWith(assessment);
  });

  it("shows the review of the kept round, not the latest one", () => {
    const later = { ...assessment, score: 5, reasoning: "Refinement made it worse." };
    render(
      <ReviewPanel
        run={run({ bestRound: 0, reviews: [{ round: 0, assessment }, { round: 1, assessment: later }] })}
        models={MODELS}
        reviewEnabled
      />,
    );
    expect(screen.getByText("Readable but cluttered.")).toBeTruthy();
    expect(screen.queryByText("Refinement made it worse.")).toBeNull();
    expect(screen.getByText(/first draft review/)).toBeTruthy();
    expect(screen.getByText("kept")).toBeTruthy();
  });

  it("disables the action while a run is in progress", () => {
    render(<ReviewPanel run={run({ reviews: [{ round: 0, assessment }] })} models={MODELS} reviewEnabled canApply={false} onApply={() => {}} />);
    expect(screen.getByRole("button", { name: "Apply suggested fixes" })).toHaveProperty("disabled", true);
  });

  it("doesn't show another round's findings when the kept version wasn't reviewed", () => {
    render(<ReviewPanel run={run({ bestRound: 1, reviews: [{ round: 0, assessment }] })} models={MODELS} reviewEnabled canApply onApply={() => {}} />);
    expect(screen.getByText(/wasn't reviewed/)).toBeTruthy();
    expect(screen.queryByText("Readable but cluttered.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply suggested fixes" })).toBeNull();
  });

  it("shows the latest review while a run is still going", () => {
    const later = { ...assessment, reasoning: "Second look." };
    render(<ReviewPanel run={run({ status: "running", bestRound: 0, reviews: [{ round: 0, assessment }, { round: 1, assessment: later }] })} models={MODELS} reviewEnabled />);
    expect(screen.getByText("Second look.")).toBeTruthy();
  });

  it("follows the version left on the canvas after a cancel", () => {
    const later = { ...assessment, score: 4, reasoning: "Round 1 regressed." };
    render(<ReviewPanel run={run({ status: "cancelled", bestRound: 0, reviews: [{ round: 0, assessment }, { round: 1, assessment: later }] })} models={MODELS} reviewEnabled />);
    expect(screen.getByText("Readable but cluttered.")).toBeTruthy();
    expect(screen.queryByText("Round 1 regressed.")).toBeNull();
  });

  it("explains when review is off", () => {
    render(<ReviewPanel run={null} models={MODELS} reviewEnabled={false} />);
    expect(screen.getByText(/turned off/)).toBeTruthy();
  });
});

describe("RunCard", () => {
  it("summarises a verified run", () => {
    render(<RunCard run={run({ outcome: "verified", reviewScore: 8, qualityScore: 92, qualityGrade: "A", refinements: 1 })} models={MODELS} />);
    expect(screen.getByText("Diagram ready")).toBeTruthy();
    expect(screen.getByText("Passed review")).toBeTruthy();
    expect(screen.getByText("Review 8/10")).toBeTruthy();
    expect(screen.getByText("Quality 92 · A")).toBeTruthy();
    expect(screen.getByText("1m 05s")).toBeTruthy();
    expect(screen.getByText("Claude Opus 5.5 · medium")).toBeTruthy();
  });

  it("offers a retry on failure", () => {
    const onRetry = vi.fn();
    const failed = run({ status: "failed", error: "Rate limited" });
    render(<RunCard run={failed} models={MODELS} onRetry={onRetry} />);
    expect(screen.getByText("Rate limited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });

  it("shows live steps and a stop button while running", () => {
    const onStop = vi.fn();
    render(
      <RunCard
        run={run({ status: "running", endedAt: undefined, steps: [{ key: "a", phase: "reviewing", round: 0, status: "active", startedAt: Date.now() }] })}
        models={MODELS}
        onStop={onStop}
      />,
    );
    expect(screen.getByText("Generating diagram")).toBeTruthy();
    expect(screen.getByText("Reviewing layout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });
});
