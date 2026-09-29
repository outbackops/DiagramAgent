import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useModelQuality } from "./useModelQuality";
import { api } from "@/lib/client/api";
import type { DiagramModel } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";

vi.mock("@/lib/client/api", () => ({
  api: { renderModel: vi.fn() },
}));

const quality: QualityReport = {
  score: 91,
  grade: "A",
  checks: [],
  metrics: { nodes: 1, containers: 0, connections: 0, maxDepth: 1, width: 100, height: 60, aspectRatio: 1.67, iconCoverage: 1, labelCoverage: 1, crossings: 0, orphans: 0, edgesThroughNodes: 0 },
};

function model(id: string): DiagramModel {
  return { version: 1, nodes: [{ id, parent: null, label: id, shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false }], edges: [] };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe("useModelQuality", () => {
  it("debounces renderModel and returns quality", async () => {
    vi.useRealTimers();
    vi.mocked(api.renderModel).mockResolvedValue({ svg: "<svg />", quality });
    const stableModel = model("A");
    const { result } = renderHook(() => useModelQuality(stableModel, true));
    expect(result.current.loading).toBe(true);
    expect(api.renderModel).not.toHaveBeenCalled();
    await waitFor(() => expect(api.renderModel).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.quality).toEqual(quality);
  });

  it("aborts stale requests and ignores old responses", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((value: { svg: string; quality: QualityReport }) => void) | undefined;
    vi.mocked(api.renderModel).mockImplementationOnce((_m, signal) => {
      firstSignal = signal;
      return new Promise((resolve) => { resolveFirst = resolve; });
    });
    vi.mocked(api.renderModel).mockResolvedValueOnce({ svg: "<svg />", quality: { ...quality, score: 80, grade: "B" } });
    const { result, rerender } = renderHook(({ current }) => useModelQuality(current, true), { initialProps: { current: model("A") } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    rerender({ current: model("B") });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { resolveFirst?.({ svg: "<svg />", quality }); });
    expect(result.current.quality?.score).toBe(80);
  });

  it("resets when model is null", () => {
    const { result } = renderHook(() => useModelQuality(null, true));
    expect(result.current).toEqual({ quality: null, loading: false, error: null });
  });
});
