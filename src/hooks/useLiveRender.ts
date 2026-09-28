"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { QualityReport } from "@/lib/quality/diagram-quality";

export interface LiveRenderState {
  svg: string;
  quality: QualityReport | null;
  error: string | null;
  loading: boolean;
  /** The code the current svg was rendered from. */
  renderedCode: string;
}

const EMPTY: LiveRenderState = { svg: "", quality: null, error: null, loading: false, renderedCode: "" };

/**
 * Debounced server render of whatever code is on screen. While a model is
 * streaming, partial code rarely compiles, so errors are suppressed and the
 * last good render stays visible.
 */
export function useLiveRender(code: string, streaming: boolean): LiveRenderState {
  const [state, setState] = useState<LiveRenderState>(EMPTY);
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
        setState({ svg: result.svg, quality: result.quality, error: null, loading: false, renderedCode: code });
      } catch (err) {
        if (controller.signal.aborted || id !== requestId.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => (streaming ? { ...s, loading: false } : { ...s, loading: false, error: message }));
      }
    }, streaming ? 900 : 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, streaming]);

  return state;
}
