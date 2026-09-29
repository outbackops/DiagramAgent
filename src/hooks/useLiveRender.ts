"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isD2SyntaxError } from "@/lib/client/api";
import { composeText } from "@/lib/compose";
import { completePartialJson, looksLikeSpec } from "@/lib/compose/partial";
import { scoreComposition } from "@/lib/compose/quality";
import type { DiagramModel } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";

interface RenderSnapshot {
  svg: string;
  quality: QualityReport | null;
  /** The rendered code as a diagram model, for the canvas. */
  model: DiagramModel | null;
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

const EMPTY: RenderSnapshot = { svg: "", quality: null, model: null, error: null, errorKind: null, loading: false, renderedCode: "" };

/**
 * Composition specs lay out in the browser. While one streams in, its
 * unfinished JSON is closed off so the diagram builds up as it arrives.
 */
function composeSnapshot(code: string, streaming: boolean): RenderSnapshot | null {
  const text = streaming ? completePartialJson(code) : code;
  if (!text) return null;
  try {
    const { model, warnings } = composeText(text);
    return { svg: "", quality: scoreComposition(model, { warnings }), model, error: null, errorKind: null, loading: false, renderedCode: code };
  } catch (err) {
    if (streaming) return null;
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err), errorKind: "syntax", renderedCode: code };
  }
}

/**
 * Live render of whatever code is on screen: D2 on the server (debounced),
 * composition specs in the browser. A spec streaming in is throttled rather
 * than debounced, so the diagram builds up while tokens arrive. While a model
 * is streaming, partial code rarely renders, so errors are suppressed and the
 * last good render stays.
 */
export function useLiveRender(code: string, streaming: boolean): LiveRenderState {
  const [state, setState] = useState<RenderSnapshot>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const latestSpec = useRef("");
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopThrottle = useCallback(() => {
    if (throttle.current) clearTimeout(throttle.current);
    throttle.current = null;
  }, []);
  useEffect(() => stopThrottle, [stopThrottle]);

  useEffect(() => {
    const id = ++requestId.current;
    if (!code.trim()) {
      stopThrottle();
      // Clearing the canvas is a direct consequence of the code prop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(EMPTY);
      return;
    }
    if (looksLikeSpec(code)) {
      latestSpec.current = code;
      if (streaming) {
        // One pending timer survives new chunks and composes the newest text when it fires.
        if (!throttle.current) {
          throttle.current = setTimeout(() => {
            throttle.current = null;
            const next = composeSnapshot(latestSpec.current, true);
            if (next) setState(next);
          }, 400);
        }
        return;
      }
      stopThrottle();
      const timer = setTimeout(() => {
        const next = composeSnapshot(code, false);
        if (next && id === requestId.current) setState(next);
      }, 120);
      return () => clearTimeout(timer);
    }
    stopThrottle();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const result = await api.render(code, controller.signal);
        if (id !== requestId.current) return;
        setState({ svg: result.svg, quality: result.quality, model: result.model ?? null, error: null, errorKind: null, loading: false, renderedCode: code });
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
  }, [code, streaming, attempt, stopThrottle]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
