import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLiveRender } from "./useLiveRender";
import { api } from "@/lib/client/api";

vi.mock("@/lib/client/api", () => ({
  api: { render: vi.fn() },
  isD2SyntaxError: () => false,
}));

/** Architecture layouts wait on a gate the test opens, and track how many run at once. */
const arch = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; quick: boolean; release: () => void }>,
  inFlight: 0,
  maxInFlight: 0,
}));
vi.mock("@/lib/arch", () => ({
  composeArchitectureText: async (text: string, options: { quick?: boolean } = {}) => {
    arch.inFlight++;
    arch.maxInFlight = Math.max(arch.maxInFlight, arch.inFlight);
    await new Promise<void>((release) => arch.calls.push({ text, quick: Boolean(options.quick), release }));
    arch.inFlight--;
    const items = (JSON.parse(text) as { items: Array<{ id: string; name: string }> }).items;
    const nodes = items.map((item, i) => ({ id: item.id, parent: null, label: item.name, shape: "rectangle", box: { x: i * 200, y: 0, w: 160, h: 80 }, style: {}, container: false, role: "service" }));
    return { model: { version: 1, kind: "architecture", nodes, edges: [] }, warnings: [], report: { warnings: [] } };
  },
}));
vi.mock("@/lib/arch/quality", () => ({ scoreArchitecture: () => ({ score: 95, grade: "A", checks: [], metrics: {} }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  arch.calls.length = 0;
  arch.inFlight = 0;
  arch.maxInFlight = 0;
});

/** Lets resolved promises (a finished layout and the next one it starts) run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const spec = (cards: number) => JSON.stringify({ title: "Stream", columns: [{ title: "Apps", items: Array.from({ length: cards }, (_, i) => ({ title: `Card ${i}` })) }] });
const cardCount = (model: { nodes: { role?: string }[] } | null) => model?.nodes.filter((n) => n.role === "card").length ?? 0;

describe("useLiveRender for composition specs", () => {
  it("builds the diagram up while a spec streams in, rather than waiting for the stream to stop", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ code, streaming }) => useLiveRender(code, streaming), { initialProps: { code: spec(1), streaming: true } });
    // A chunk every 100 ms would keep resetting a debounce; the throttle still renders.
    for (let i = 2; i <= 6; i++) {
      rerender({ code: spec(i), streaming: true });
      act(() => void vi.advanceTimersByTime(100));
    }
    expect(cardCount(result.current.model)).toBeGreaterThan(0);

    rerender({ code: spec(6), streaming: false });
    act(() => void vi.advanceTimersByTime(200));
    expect(cardCount(result.current.model)).toBe(6);
    expect(result.current.error).toBeNull();
    expect(api.render).not.toHaveBeenCalled();
  });

  it("closes unfinished JSON while streaming and reports a broken spec only once the stream ends", () => {
    vi.useFakeTimers();
    const partial = spec(3).slice(0, -30);
    const { result, rerender } = renderHook(({ code, streaming }) => useLiveRender(code, streaming), { initialProps: { code: partial, streaming: true } });
    act(() => void vi.advanceTimersByTime(450));
    expect(result.current.error).toBeNull();

    rerender({ code: '{"title": "Broken", "columns": [', streaming: false });
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current.errorKind).toBe("syntax");
  });
});

const archSpec = (count: number) => JSON.stringify({ title: "Stream", platform: "azure", items: Array.from({ length: count }, (_, i) => ({ id: `svc-${i}`, name: `Service ${i}` })), connections: [] });
const serviceCount = (model: { nodes: { role?: string }[] } | null) => model?.nodes.filter((n) => n.role === "service").length ?? 0;
const itemCount = (text: string) => (JSON.parse(text) as { items: unknown[] }).items.length;

describe("useLiveRender for Architecture specs", () => {
  it("lays out one spec at a time while streaming, quickly, and lays the last spec out last", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ code, streaming }) => useLiveRender(code, streaming, "architecture"), { initialProps: { code: archSpec(1), streaming: true } });
    act(() => void vi.advanceTimersByTime(450));
    expect(arch.calls).toHaveLength(1);
    expect(arch.calls[0].quick).toBe(true);
    // A burst of chunks while the first layout runs: only the newest is kept.
    for (let i = 2; i <= 5; i++) {
      rerender({ code: archSpec(i), streaming: true });
      act(() => void vi.advanceTimersByTime(450));
    }
    rerender({ code: archSpec(6), streaming: false });
    act(() => void vi.advanceTimersByTime(200));
    expect(arch.calls).toHaveLength(1);

    await act(async () => {
      arch.calls[0].release();
      await settle();
    });
    // The streamed progress landed, and the final spec runs next with the full layout.
    expect(serviceCount(result.current.model)).toBe(1);
    expect(arch.calls).toHaveLength(2);
    expect(itemCount(arch.calls[1].text)).toBe(6);
    expect(arch.calls[1].quick).toBe(false);

    await act(async () => {
      arch.calls[1].release();
      await settle();
    });
    expect(serviceCount(result.current.model)).toBe(6);
    expect(arch.maxInFlight).toBe(1);
    expect(api.render).not.toHaveBeenCalled();
  });

  it("drops a layout that finishes after a newer spec or a cleared canvas", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ code }) => useLiveRender(code, false, "architecture"), { initialProps: { code: archSpec(2) } });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ code: archSpec(3) });
    act(() => void vi.advanceTimersByTime(200));
    await act(async () => {
      arch.calls[0].release();
      await settle();
    });
    // The first result is stale: the canvas still waits for the newer spec.
    expect(result.current.model).toBeNull();
    await act(async () => {
      arch.calls[1].release();
      await settle();
    });
    expect(serviceCount(result.current.model)).toBe(3);

    rerender({ code: archSpec(4) });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ code: "" });
    await act(async () => {
      arch.calls[2].release();
      await settle();
    });
    expect(result.current.model).toBeNull();
  });
});