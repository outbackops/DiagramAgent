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

import { formatForStyle, migrateSettings, useDiagramAgent, type AgentDocument } from "./useDiagramAgent";

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
  await waitFor(() => expect(result.current.busy).toBe("idle"), { timeout: 20_000 });
  return result;
}

describe("useDiagramAgent and the document", () => {
  it("edits the diagram on the canvas and hands the result back for a stable merge", async () => {
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => "a -> b", onKeep }, "add a cache");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "a -> b", format: "d2" });
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "stable", status: "done", format: "d2" });
  });

  it("starts a new graph diagram when the canvas was emptied, instead of editing the last run", async () => {
    window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: false, refinements: 0, style: "graph" }));
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => "", onKeep }, "draw a data pipeline");
    expect(api.plan).toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "", format: "d2" });
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "full", status: "done", format: "d2" });
  });

  it("draws Poster diagrams in the browser: no D2 planner, the spec renders without the server", async () => {
    window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: false, refinements: 0, style: "poster" }));
    const spec = { title: "Pipeline", columns: [{ title: "Sources", items: [{ title: "Sensors" }, { title: "Gateway" }] }, { title: "Cloud", items: [{ title: "Ingest" }, { title: "Store" }] }] };
    api.generate.mockResolvedValue({ text: `Here you go:\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`` });
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => "", onKeep }, "draw a data pipeline");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.render).not.toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "", format: "composition" });
    expect(onKeep).toHaveBeenCalledWith(expect.stringContaining('"title": "Pipeline"'), { layout: "full", status: "done", format: "composition" });
  });

  it("edits a composed diagram in its spec", async () => {
    api.generate.mockResolvedValue({ text: JSON.stringify({ title: "Edited", columns: [{ title: "Only", items: [{ title: "Card" }] }] }) });
    const onKeep = vi.fn();
    await sendWith({ currentCode: () => '{"title":"Old","columns":[]}', currentFormat: () => "composition", onKeep }, "rename it");
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: '{"title":"Old","columns":[]}', format: "composition" });
    expect(onKeep).toHaveBeenCalledWith(expect.stringContaining('"Edited"'), { layout: "stable", status: "done", format: "composition" });
  });

  it("re-lays out when applying the reviewer's fixes", async () => {
    const onKeep = vi.fn();
    const { result } = renderHook(() => useDiagramAgent(models, { currentCode: () => "a -> b", onKeep }));
    await waitFor(() => expect(result.current.settings.clarify).toBe(false));
    await act(async () => {
      result.current.applyReview({ score: 5, pass: false, layout_issues: ["too wide"], specific_fixes: ["stack vertically"] });
    });
    await waitFor(() => expect(result.current.busy).toBe("idle"), { timeout: 20_000 });
    expect(onKeep).toHaveBeenCalledWith("a -> b", { layout: "full", status: "done", format: "d2" });
  });

  it("reports when the result can't be put on the canvas", async () => {
    const onKeep = vi.fn().mockRejectedValue(new Error("renderer offline"));
    const result = await sendWith({ currentCode: () => "a -> b", onKeep }, "add a cache");
    const notes = result.current.items.filter((i) => i.kind === "assistant");
    expect(notes.some((n) => n.kind === "assistant" && /renderer offline/.test(n.text))).toBe(true);
  });
});

const archSpec = {
  title: "Hub and spoke",
  platform: "azure",
  items: [
    { id: "onprem", name: "Corporate network", icon: "users" },
    { type: "group", kind: "vnet", id: "hub", name: "Hub VNet", facts: "10.0.0.0/22", items: [{ id: "fw", name: "Azure Firewall" }] },
  ],
  connections: [{ from: "onprem", to: "fw", meaning: "vpn", label: "ExpressRoute" }],
};

describe("styles and routing", () => {
  it("routes Auto by the request: infrastructure to Architecture, overviews to Poster; a chosen style wins", () => {
    expect(formatForStyle("auto", "hub-and-spoke network with ExpressRoute")).toEqual({ format: "architecture", routed: "heuristic" });
    expect(formatForStyle(undefined, "a one-page overview of how our onboarding journey works")).toEqual({ format: "composition", routed: "heuristic" });
    expect(formatForStyle("auto", "anything at all", { style: "poster" })).toEqual({ format: "composition", routed: "clarify" });
    expect(formatForStyle("architecture", "a one-page overview of how our onboarding journey works")).toEqual({ format: "architecture" });
    expect(formatForStyle("poster", "hub-and-spoke network")).toEqual({ format: "composition" });
    expect(formatForStyle("graph", "hub-and-spoke network")).toEqual({ format: "d2" });
  });

  it("migrates settings saved with the old composed style to Auto and keeps everything else", async () => {
    expect(migrateSettings({ clarify: false, review: true, refinements: 2, style: "composed" })).toEqual({ clarify: false, review: true, refinements: 2, style: "auto" });
    expect(migrateSettings({ clarify: true, review: true, refinements: 1, style: "graph" })).toEqual({ clarify: true, review: true, refinements: 1, style: "graph" });
    window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: true, refinements: 2, style: "composed" }));
    const { result } = renderHook(() => useDiagramAgent(models));
    await waitFor(() => expect(result.current.settings).toEqual({ clarify: false, review: true, refinements: 2, style: "auto" }));
  });

  it("draws an infrastructure request as Architecture under Auto, in the browser, and records the choice", async () => {
    api.generate.mockResolvedValue({ text: JSON.stringify(archSpec) });
    const onKeep = vi.fn();
    const result = await sendWith({ currentCode: () => "", onKeep }, "hub-and-spoke network with ExpressRoute to the office");
    expect(api.plan).not.toHaveBeenCalled();
    expect(api.render).not.toHaveBeenCalled();
    expect(api.generate.mock.calls[0][0]).toMatchObject({ existingCode: "", format: "architecture" });
    expect(onKeep).toHaveBeenCalledWith(expect.stringContaining('"Hub and spoke"'), { layout: "full", status: "done", format: "architecture" });
    expect(result.current.latestRun).toMatchObject({ format: "architecture", routed: "heuristic", status: "done" });
    expect(result.current.latestRun?.qualityScore).toEqual(expect.any(Number));
  });

  it("uses the chosen style over routing", async () => {
    window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: false, refinements: 0, style: "architecture" }));
    api.generate.mockResolvedValue({ text: JSON.stringify(archSpec) });
    const result = await sendWith({ currentCode: () => "", onKeep: vi.fn() }, "a one-page overview of how our onboarding journey works");
    expect(api.generate.mock.calls[0][0]).toMatchObject({ format: "architecture" });
    expect(result.current.latestRun?.routed).toBeUndefined();
  });

  it("spends a fix round on an irreparable spec and never puts it on the canvas", async () => {
    window.localStorage.setItem("diagramAgent.settings.v2", JSON.stringify({ clarify: false, review: false, refinements: 1, style: "architecture" }));
    api.generate.mockResolvedValueOnce({ text: JSON.stringify({ title: "Empty", items: [] }) }).mockResolvedValueOnce({ text: JSON.stringify(archSpec) });
    const onKeep = vi.fn();
    const result = await sendWith({ currentCode: () => "", onKeep }, "draw our network");
    expect(api.generate).toHaveBeenCalledTimes(2);
    expect(api.generate.mock.calls[1][0].prompt).toContain("no components");
    expect(result.current.latestRun?.steps.some((s) => s.phase === "rendering" && s.status === "failed")).toBe(true);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledWith(expect.stringContaining('"Hub and spoke"'), expect.objectContaining({ format: "architecture" }));
  });

  it("redraws a run's request in the other style with Redo as", async () => {
    api.generate.mockResolvedValue({ text: JSON.stringify(archSpec) });
    const onKeep = vi.fn();
    const result = await sendWith({ currentCode: () => "", onKeep }, "hub-and-spoke network with ExpressRoute");
    const run = result.current.latestRun!;
    api.generate.mockResolvedValue({ text: JSON.stringify({ title: "Overview", columns: [{ title: "Hub", items: [{ title: "Firewall" }] }] }) });
    await act(async () => {
      result.current.redoAs(run, "composition");
    });
    await waitFor(() => expect(result.current.busy).toBe("idle"), { timeout: 20_000 });
    expect(api.generate.mock.calls[1][0]).toMatchObject({ existingCode: "", format: "composition", prompt: expect.stringContaining("hub-and-spoke") });
    expect(result.current.items.some((i) => i.kind === "user" && i.text === "Redo as Poster")).toBe(true);
    expect(result.current.latestRun).toMatchObject({ format: "composition", status: "done" });
  });
});