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
  // `known` stays false until the client has read the media query. Before that the inline
  // script in layout.tsx owns the class; syncing from default state would flash the wrong theme.
  const [system, setSystem] = useState({ dark: false, known: false });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // Media queries are an external source of truth; mirror it into state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSystem({ dark: mq.matches, known: true });
    const onChange = (e: MediaQueryListEvent) => setSystem({ dark: e.matches, known: true });
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = preference === "system" ? (system.dark ? "dark" : "light") : preference;

  useEffect(() => {
    if (!system.known) return;
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved, system.known]);

  const cycle = useCallback(() => {
    setPreference((p) => (p === "system" ? (systemPrefersDark() ? "light" : "dark") : p === "dark" ? "light" : "system"));
  }, [setPreference]);

  return { preference, resolved, setPreference, cycle };
}
