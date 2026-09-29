import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLiveRender } from "./useLiveRender";
import { api } from "@/lib/client/api";

vi.mock("@/lib/client/api", () => ({
  api: { render: vi.fn() },
  isD2SyntaxError: () => false,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

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
