import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  clarify: vi.fn(),
  plan: vi.fn(),
  generate: vi.fn(),
  render: vi.fn(),
  assess: vi.fn(),
}));
vi.mock("@/lib/client/api", () => ({ api, isD2SyntaxError: () => false }));

import { useDiagramAgent, type AgentDocument } from "./useDiagramAgent";

const models = {
  selection: { provider: "copilot" as const, model: "claude-opus-5.5", reasoningEffort: "medium" as const },
  reviewer: { provider: "copilot" as const, model: "claude-opus-5.5", reasoningEffort: "medium" as const },
  reviewerSupportsVision: true,
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: false, refinements: 0 }));
  for (const fn of Object.values(api)) fn.mockReset();
  api.plan.mockResolvedValue({ plan: { components: [] } });
  api.generate.mockResolvedValue({ text: "a -> b" });
  api.render.mockResolvedValue({ svg: "<svg/>", quality: null });
});

async function sendWith(document: AgentDocument, text: string) {
  const { result } = renderHook(() => useDiagramAgent(models, document));
  await waitFor(() => expect(result.current.settings.clarify).toBe(false));
  await act(async () => {
    result.current.send(text);
  });
  await waitFor(() => expect(result.current.busy).toBe("idle"));
  return result;
}

describe("useDiagramAgent and the document", () => {
  it("edits the diagram on the canvas and hands the result back for a stable merge", async () => {
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => "a -> b", onKeep }, "add a cache");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "a -> b" });
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "stable", status: "done" });
  });

  it("starts a new diagram when the canvas was emptied, instead of editing the last run", async () => {
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => "", onKeep }, "draw a data pipeline");
    expect(api.plan).toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "" });
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "full", status: "done" });
  });

  it("re-lays out when applying the reviewer's fixes", async () => {
    const onKeep = vi.fn();
    const { result } = renderHook(() => useDiagramAgent(models, { currentCode: () => "a -> b", onKeep }));
    await waitFor(() => expect(result.current.settings.clarify).toBe(false));
    await act(async () => {
      result.current.applyReview({ score: 5, pass: false, layout_issues: ["too wide"], specific_fixes: ["stack vertically"] });
    });
    await waitFor(() => expect(result.current.busy).toBe("idle"));
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "full", status: "done" });
  });

  it("reports when the result can't be put on the canvas", async () => {
    const onKeep = vi.fn().mockRejectedValue(new Error("renderer offline"));
    const result = await sendWith({ currentCode: () => "a -> b", onKeep }, "add a cache");
    const notes = result.current.items.filter((i) => i.kind === "assistant");
    expect(notes.some((n) => n.kind === "assistant" && /renderer offline/.test(n.text))).toBe(true);
  });
});
