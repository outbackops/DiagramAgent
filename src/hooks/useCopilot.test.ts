import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useModelChoice } from "./useCopilot";
import type { ModelsResponse } from "@/lib/api/types";

const catalog: ModelsResponse = {
  models: [
    { provider: "copilot", id: "claude-opus-5.5", name: "Claude Opus 5.5", vision: true, reasoningEfforts: ["low", "medium", "high"] },
    { provider: "copilot", id: "gpt-5.5", name: "GPT-5.5", vision: true, reasoningEfforts: ["low", "medium"] },
    { provider: "copilot", id: "text-model", name: "Text", vision: false, reasoningEfforts: [] },
  ],
  defaultSelection: { provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" },
  errors: {},
};

describe("useModelChoice", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses the catalog default (Claude Opus 5.5 @ medium) when nothing is stored", () => {
    const { result } = renderHook(() => useModelChoice(catalog));
    expect(result.current.selection).toEqual({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" });
    expect(result.current.reviewer).toEqual(result.current.selection);
    expect(result.current.reviewerChoice).toBe("same");
    expect(result.current.reviewerSupportsVision).toBe(true);
  });

  it("keeps a stored choice that the account can use, normalising its effort", () => {
    window.localStorage.setItem("diagramAgent.model.v2", JSON.stringify({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "max" }));
    const { result } = renderHook(() => useModelChoice(catalog));
    expect(result.current.selection).toEqual({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "medium" });
  });

  it("falls back to the default when the stored model is no longer available", () => {
    window.localStorage.setItem("diagramAgent.model.v2", JSON.stringify({ provider: "copilot", model: "retired-model" }));
    const { result } = renderHook(() => useModelChoice(catalog));
    expect(result.current.selection.model).toBe("claude-opus-5.5");
  });

  it("reports when the reviewer cannot see images", () => {
    const { result } = renderHook(() => useModelChoice(catalog));
    act(() => result.current.setReviewerChoice({ provider: "copilot", model: "text-model" }));
    expect(result.current.reviewer.model).toBe("text-model");
    expect(result.current.reviewerSupportsVision).toBe(false);
  });

  it("treats an unavailable stored reviewer as 'same as main model'", () => {
    window.localStorage.setItem("diagramAgent.reviewer.v2", JSON.stringify({ provider: "copilot", model: "gone" }));
    const { result } = renderHook(() => useModelChoice(catalog));
    expect(result.current.reviewerChoice).toBe("same");
    expect(result.current.reviewer).toEqual(result.current.selection);
  });

  it("uses the stored or built-in default while the catalog is loading", () => {
    const { result } = renderHook(() => useModelChoice(null));
    expect(result.current.selection).toEqual({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" });
    expect(result.current.reviewerSupportsVision).toBe(true);
  });
});
