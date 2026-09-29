"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { composeArchitectureText } from "@/lib/arch";
import { scoreArchitecture } from "@/lib/arch/quality";
import { api, isD2SyntaxError } from "@/lib/client/api";
import { composeText } from "@/lib/compose";
import { completePartialJson, looksLikeSpec } from "@/lib/compose/partial";
import { scoreComposition } from "@/lib/compose/quality";
import type { DiagramModel } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import { formatOfCode, type DiagramFormat } from "@/lib/spec-format";

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

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
    return { ...EMPTY, error: errorText(err), errorKind: "syntax", renderedCode: code };
  }
}

/** Architecture specs lay out in the browser too; while streaming, one fast layout candidate is enough. */
async function architectureSnapshot(code: string, streaming: boolean): Promise<RenderSnapshot | null> {
  const text = streaming ? completePartialJson(code) : code;
  if (!text) return null;
  try {
    const { model, warnings, report } = await composeArchitectureText(text, streaming ? { quick: true } : {});
    return { svg: "", quality: scoreArchitecture(model, { warnings: [...warnings, ...report.warnings] }), model, error: null, errorKind: null, loading: false, renderedCode: code };
  } catch (err) {
    if (streaming) return null;
    return { ...EMPTY, error: errorText(err), errorKind: "syntax", renderedCode: code };
  }
}

interface ArchJob {
  code: string;
  streaming: boolean;
  /** The render request it belongs to. */
  id: number;
  /** Bumped when the canvas is cleared or the code stops being an Architecture spec. */
  epoch: number;
}

interface ArchSlot {
  running: boolean;
  /** The newest job queued while one runs; it replaces any job still waiting. */
  next: ArchJob | null;
}

/** Runs Architecture layouts one at a time, handing each result to `land`. */
async function drainArchitectureJobs(slot: ArchSlot, first: ArchJob, land: (job: ArchJob, snapshot: RenderSnapshot) => void): Promise<void> {
  slot.running = true;
  let job: ArchJob | null = first;
  try {
    while (job) {
      const snapshot = await architectureSnapshot(job.code, job.streaming);
      if (snapshot) land(job, snapshot);
      job = slot.next;
      slot.next = null;
    }
  } finally {
    slot.running = false;
  }
}

/**
 * Live render of whatever code is on screen: D2 on the server (debounced),
 * Poster and Architecture specs in the browser. A spec streaming in is
 * throttled rather than debounced, so the diagram builds up while tokens
 * arrive. While a model is streaming, partial code rarely renders, so errors
 * are suppressed and the last good render stays.
 *
 * Architecture layouts are asynchronous and run one at a time: while one runs,
 * only the newest pending spec is kept, and it runs next. A result lands only if
 * nothing newer has replaced its code (streaming progress always lands, in order).
 */
export function useLiveRender(code: string, streaming: boolean, formatHint?: DiagramFormat): LiveRenderState {
  const [state, setState] = useState<RenderSnapshot>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const latestSpec = useRef("");
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const archEpoch = useRef(0);
  const archSlot = useRef<ArchSlot>({ running: false, next: null });
  const stopThrottle = useCallback(() => {
    if (throttle.current) clearTimeout(throttle.current);
    throttle.current = null;
  }, []);
  useEffect(() => stopThrottle, [stopThrottle]);

  const layoutArchitecture = useCallback((job: ArchJob) => {
    const slot = archSlot.current;
    if (slot.running) {
      slot.next = job;
      return;
    }
    void drainArchitectureJobs(slot, job, (done, snapshot) => {
      // Streamed progress lands in order; a final layout only if no newer code replaced it.
      if (done.epoch === archEpoch.current && (done.streaming || done.id === requestId.current)) setState(snapshot);
    });
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    if (!code.trim()) {
      stopThrottle();
      archEpoch.current++;
      // Clearing the canvas is a direct consequence of the code prop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(EMPTY);
      return;
    }
    if (looksLikeSpec(code)) {
      const architecture = formatHint === "architecture" || (formatHint !== "composition" && formatOfCode(code) === "architecture");
      if (!architecture) archEpoch.current++;
      latestSpec.current = code;
      const render = (text: string, isStreaming: boolean) => {
        if (architecture) {
          layoutArchitecture({ code: text, streaming: isStreaming, id: requestId.current, epoch: archEpoch.current });
          return;
        }
        const next = composeSnapshot(text, isStreaming);
        if (next && (isStreaming || id === requestId.current)) setState(next);
      };
      if (streaming) {
        // One pending timer survives new chunks and renders the newest text when it fires.
        if (!throttle.current) {
          throttle.current = setTimeout(() => {
            throttle.current = null;
            render(latestSpec.current, true);
          }, 400);
        }
        return;
      }
      stopThrottle();
      const timer = setTimeout(() => render(code, false), 120);
      return () => clearTimeout(timer);
    }
    stopThrottle();
    archEpoch.current++;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const result = await api.render(code, controller.signal);
        if (id !== requestId.current) return;
        setState({ svg: result.svg, quality: result.quality, model: result.model ?? null, error: null, errorKind: null, loading: false, renderedCode: code });
      } catch (err) {
        if (controller.signal.aborted || id !== requestId.current) return;
        const message = errorText(err);
        const errorKind = isD2SyntaxError(err) ? "syntax" : "unavailable";
        setState((s) => (streaming ? { ...s, loading: false } : { ...s, loading: false, error: message, errorKind }));
      }
    }, streaming ? 900 : 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code, streaming, formatHint, attempt, stopThrottle, layoutArchitecture]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}