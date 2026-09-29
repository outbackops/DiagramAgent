"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { commit, createHistory, redo as redoHistory, undo as undoHistory, type History } from "@/lib/model/history";
import { mergeStable } from "@/lib/model/merge";
import { routeModelEdges } from "@/lib/model/route";
import { modelToD2 } from "@/lib/model/to-d2";
import type { DiagramModel } from "@/lib/model/types";
import { validateModel } from "@/lib/model/validate";

export const MODEL_STORAGE_KEY = "diagramAgent.model.v1";
const LEGACY_CODE_KEY = "diagramAgent.d2Code";
/** An AI edit that adds or regroups at least this many items suggests a Tidy up (R16). */
export const LARGE_EDIT = 5;

/** How a run's result lands on the canvas: a fresh layout, or merged into the current layout (R14, R22). */
export type RunLayout = "full" | "stable";

export interface AcceptResult {
  added: number;
  regrouped: number;
  warnings: string[];
}

export type DocumentStatus = "loading" | "migrating" | "ready";

function readStoredModel(): DiagramModel | null {
  try {
    const raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return null;
    const result = validateModel(JSON.parse(raw));
    return result.ok ? result.model : null;
  } catch {
    return null;
  }
}

function readLegacyCode(): string {
  try {
    const raw = window.localStorage.getItem(LEGACY_CODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : "";
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

async function importCode(code: string, signal?: AbortSignal): Promise<{ model: DiagramModel; warnings: string[] }> {
  const result = await api.render(code, signal);
  if (!result.model) throw new Error("The server didn't return a diagram model");
  return { model: result.model, warnings: result.warnings ?? [] };
}

/**
 * The diagram document: the model on the canvas, its undo history, and how
 * runs, imports and Tidy up change it. Persisted in the browser.
 */
export function useDiagramDocument() {
  const [history, setHistory] = useState<History<DiagramModel | null>>(() => createHistory(null));
  const [status, setStatus] = useState<DocumentStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  });
  const model = history.present;

  // Load the saved model; diagrams saved by the D2-based version are imported
  // once, and their D2 stays in storage so a failed import loses nothing (R19).
  useEffect(() => {
    const stored = readStoredModel();
    if (stored) {
      // Hydrating from browser storage after mount keeps server and client renders identical.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory(createHistory(stored));
      setStatus("ready");
      return;
    }
    const legacy = readLegacyCode();
    if (!legacy.trim()) {
      setStatus("ready");
      return;
    }
    setStatus("migrating");
    let cancelled = false;
    importCode(legacy)
      .then(({ model: imported }) => {
        if (!cancelled) setHistory(createHistory(imported));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(`Couldn't open your saved diagram: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    try {
      if (model) window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));
      else window.localStorage.removeItem(MODEL_STORAGE_KEY);
    } catch {
      // Storage full or disabled: the diagram still works for this session.
    }
  }, [model, status]);

  /** Applies a hand edit; lines that need it are re-routed. */
  const apply = useCallback((op: (current: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }) => {
    setHistory((h) => {
      if (!h.present) return h;
      const next = op(h.present);
      if (next === h.present) return h;
      return commit(h, routeModelEdges(next), options);
    });
  }, []);

  /** Puts a whole model on the canvas as one undoable step. */
  const replace = useCallback((next: DiagramModel | null) => {
    setHistory((h) => commit(h, next));
  }, []);

  /**
   * Lands a run's D2 on the canvas: a full layout for new diagrams and
   * reviewer fixes, or merged into the current layout for chat edits.
   */
  const acceptRunCode = useCallback(async (code: string, layout: RunLayout, signal?: AbortSignal): Promise<AcceptResult> => {
    const { model: imported, warnings } = await importCode(code, signal);
    const current = historyRef.current.present;
    if (layout === "stable" && current && current.nodes.length > 0) {
      const merged = mergeStable(current, imported);
      replace(routeModelEdges(merged.model));
      return { added: merged.added.length, regrouped: merged.regrouped.length, warnings };
    }
    replace({ ...imported, handArranged: false });
    return { added: imported.nodes.length, regrouped: 0, warnings };
  }, [replace]);

  /** Re-runs the full automatic layout on the current diagram (R15). */
  const tidyUp = useCallback(async () => {
    const current = historyRef.current.present;
    if (!current || current.nodes.length === 0) return;
    const { model: imported } = await importCode(modelToD2(current));
    replace({ ...imported, handArranged: false });
  }, [replace]);

  /** Opens D2 from elsewhere as the current diagram (undoable). */
  const importD2 = useCallback(
    async (code: string): Promise<string[]> => {
      const { model: imported, warnings } = await importCode(code);
      replace({ ...imported, handArranged: false });
      return warnings;
    },
    [replace],
  );

  const clear = useCallback(() => {
    setHistory(createHistory(null));
    setError(null);
  }, []);

  const undo = useCallback(() => setHistory((h) => undoHistory(h)), []);
  const redo = useCallback(() => setHistory((h) => redoHistory(h)), []);

  const d2 = useMemo(() => (model && model.nodes.length > 0 ? modelToD2(model) : ""), [model]);

  return {
    model,
    d2,
    status,
    error,
    dismissError: useCallback(() => setError(null), []),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    apply,
    replace,
    acceptRunCode,
    tidyUp,
    importD2,
    clear,
  };
}

export type DiagramDocument = ReturnType<typeof useDiagramDocument>;
