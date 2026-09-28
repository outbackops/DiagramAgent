"use client";

import { useCallback, useEffect, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";

export type ThemePreference = "system" | "light" | "dark";

const isTheme = (v: unknown): v is ThemePreference => v === "system" || v === "light" || v === "dark";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Theme preference persisted in localStorage and applied as a `dark` class on <html>. */
export function useTheme() {
  const [preference, setPreference] = usePersistedState<ThemePreference>("diagramAgent.theme", "system", { validate: isTheme });
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // Media queries are an external source of truth; mirror it into state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const cycle = useCallback(() => {
    setPreference((p) => (p === "system" ? (systemPrefersDark() ? "light" : "dark") : p === "dark" ? "light" : "system"));
  }, [setPreference]);

  return { preference, resolved, setPreference, cycle };
}
