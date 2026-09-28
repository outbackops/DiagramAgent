"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isD2SyntaxError } from "@/lib/client/api";
import type { QualityReport } from "@/lib/quality/diagram-quality";

interface RenderSnapshot {
  svg: string;
  quality: QualityReport | null;
  error: string | null;
  /** "syntax": the D2 doesn't compile. "unavailable": the renderer couldn't be used (busy, offline, signed out). */
  errorKind: "syntax" | "unavailable" | null;
  loading: boolean;
  /** The code the current svg was rendered from. */
  renderedCode: string;
}

export interface LiveRenderState extends RenderSnapshot {
  /** Render the current code again (after an "unavailable" error). */
  retry: () => void;
}

const EMPTY: RenderSnapshot = { svg: "", quality: null, error: null, errorKind: null, loading: false, renderedCode: "" };

/**
 * Debounced server render of whatever code is on screen. While a model is
 * streaming, partial code rarely compiles, so errors are suppressed and the
 * last good render stays visible.
 */
export function useLiveRender(code: string, streaming: boolean): LiveRenderState {
  const [state, setState] = useState<RenderSnapshot>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    if (!code.trim()) {
      // Clearing the canvas is a direct consequence of the code prop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const result = await api.render(code, controller.signal);
        if (id !== requestId.current) return;
        setState({ svg: result.svg, quality: result.quality, error: null, errorKind: null, loading: false, renderedCode: code });
      } catch (err) {
        if (controller.signal.aborted || id !== requestId.current) return;
        const message = err instanceof Error ? err.message : String(err);
        const errorKind = isD2SyntaxError(err) ? "syntax" : "unavailable";
        setState((s) => (streaming ? { ...s, loading: false } : { ...s, loading: false, error: message, errorKind }));
      }
    }, streaming ? 900 : 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, streaming, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
