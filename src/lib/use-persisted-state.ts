"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Persist a piece of React state to localStorage under `key`.
 *
 * - SSR-safe: returns the initial value on first render and only reads from
 *   localStorage in a post-mount effect, so server and client agree.
 * - Quiet on quota / parse / serialise errors (we never want a localStorage
 *   bug to crash the app).
 * - Hydration: when the post-mount read finds a value, it replaces state via
 *   the setter so consumers re-render with the persisted value.
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
  options?: {
    /** Optional schema-style validator. If it returns false, the stored value is discarded. */
    validate?: (value: unknown) => value is T;
  },
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initialValue);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (!options?.validate || options.validate(parsed)) {
          setValue(parsed as T);
        }
      }
    } catch {
      // Corrupt entry — drop it silently.
    } finally {
      hydratedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Write back whenever value changes — but only after we've hydrated, so we
  // don't overwrite a real persisted value with the initialValue on mount.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded / disabled storage — nothing useful we can do.
    }
  }, [key, value]);

  return [value, setValue];
}
