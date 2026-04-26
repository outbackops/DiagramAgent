import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistedState } from "./use-persisted-state";

describe("usePersistedState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the initial value when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedState("k1", "default"));
    expect(result.current[0]).toBe("default");
  });

  it("hydrates from localStorage on mount when a value is present", async () => {
    window.localStorage.setItem("k2", JSON.stringify("stored"));
    const { result } = renderHook(() => usePersistedState("k2", "default"));
    // Hydration happens in a post-mount effect; renderHook flushes effects synchronously here.
    expect(result.current[0]).toBe("stored");
  });

  it("persists updates back to localStorage", () => {
    const { result } = renderHook(() => usePersistedState<number>("k3", 0));
    act(() => {
      result.current[1](42);
    });
    expect(window.localStorage.getItem("k3")).toBe("42");
  });

  it("does not overwrite a stored value with initialValue on mount", () => {
    window.localStorage.setItem("k4", JSON.stringify({ saved: true }));
    renderHook(() => usePersistedState("k4", { saved: false }));
    expect(JSON.parse(window.localStorage.getItem("k4")!)).toEqual({ saved: true });
  });

  it("ignores corrupt JSON and falls back to initialValue", () => {
    window.localStorage.setItem("k5", "not-json{{{");
    const { result } = renderHook(() => usePersistedState("k5", "fallback"));
    expect(result.current[0]).toBe("fallback");
  });

  it("respects a validate guard and discards mismatched stored values", () => {
    window.localStorage.setItem("k6", JSON.stringify({ legacy: true }));
    const { result } = renderHook(() =>
      usePersistedState<{ v: number }>("k6", { v: 0 }, {
        validate: (v): v is { v: number } =>
          typeof v === "object" && v !== null && typeof (v as { v?: unknown }).v === "number",
      }),
    );
    expect(result.current[0]).toEqual({ v: 0 });
  });

  it("supports functional updates", () => {
    const { result } = renderHook(() => usePersistedState<number>("k7", 1));
    act(() => {
      result.current[1]((n) => n + 10);
    });
    expect(result.current[0]).toBe(11);
    expect(window.localStorage.getItem("k7")).toBe("11");
  });
});
