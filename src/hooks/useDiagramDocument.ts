"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { composeText, modelSpecText, pageWidthOf, recompose } from "@/lib/compose";
import { looksLikeSpec } from "@/lib/compose/partial";
import { commit, createHistory, redo as redoHistory, undo as undoHistory, type History } from "@/lib/model/history";
import { carryContainers, mergeStable } from "@/lib/model/merge";
import { routeModelEdges } from "@/lib/model/route";
import { modelToD2 } from "@/lib/model/to-d2";
import type { DiagramModel } from "@/lib/model/types";
import { validateModel } from "@/lib/model/validate";

export const MODEL_STORAGE_KEY = "diagramAgent.model.v1";
/** Where a saved model that no longer validates is kept, instead of being deleted. */
export const MODEL_BACKUP_KEY = "diagramAgent.model.v1.unreadable";
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

/** After a chat edit merged into the layout, many new or regrouped items deserve a fresh layout (R16). */
export function suggestsTidyUp(result: AcceptResult, layout: RunLayout): boolean {
  return layout === "stable" && result.added + result.regrouped >= LARGE_EDIT;
}

export { looksLikeSpec };

type StoredModel = { kind: "none" } | { kind: "ok"; model: DiagramModel } | { kind: "unreadable"; raw: string };

function readStoredModel(): StoredModel {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MODEL_STORAGE_KEY);
    if (!raw) return { kind: "none" };
    const result = validateModel(JSON.parse(raw));
    return result.ok ? { kind: "ok", model: result.model } : { kind: "unreadable", raw };
  } catch {
    return raw ? { kind: "unreadable", raw } : { kind: "none" };
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
  // Bumped by every change to the document (edits, undo, runs, imports, New), so an
  // async result can tell whether the diagram it started from is still the current one.
  const generation = useRef(0);
  // The saved diagram is only deleted after an explicit New, never because loading failed.
  const clearedRef = useRef(false);
  const model = history.present;

  // Load the saved model; diagrams saved by the D2-based version are imported
  // once, and their D2 stays in storage so a failed import loses nothing (R19).
  useEffect(() => {
    const stored = readStoredModel();
    if (stored.kind === "ok") {
      // Hydrating from browser storage after mount keeps server and client renders identical.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory(createHistory(stored.model));
      setStatus("ready");
      return;
    }
    if (stored.kind === "unreadable") {
      // Never silently lose a diagram (or replace it with older D2): keep a copy and say so.
      try {
        window.localStorage.setItem(MODEL_BACKUP_KEY, stored.raw);
      } catch {
        // Storage full: the original entry is still there until the next save.
      }
      setError("Your saved diagram couldn't be opened. A copy was kept in this browser's storage.");
      setStatus("ready");
      return;
    }
    const legacy = readLegacyCode();
    if (!legacy.trim()) {
      setStatus("ready");
      return;
    }
    // The last run's code can be a composition spec (a reload mid-run): compose it rather than import D2.
    if (looksLikeSpec(legacy)) {
      try {
        setHistory(createHistory(composeText(legacy).model));
      } catch {
        // An unfinished spec: start empty rather than show an error for a draft.
      }
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
      if (model) {
        window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model));
        clearedRef.current = false;
      } else if (clearedRef.current) {
        window.localStorage.removeItem(MODEL_STORAGE_KEY);
      }
    } catch {
      // Storage full or disabled: the diagram still works for this session.
    }
  }, [model, status]);

  /** Applies a hand edit; lines that need it are re-routed. */
  const apply = useCallback((op: (current: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }) => {
    generation.current++;
    setHistory((h) => {
      if (!h.present) return h;
      const next = op(h.present);
      if (next === h.present) return h;
      return commit(h, routeModelEdges(next), options);
    });
  }, []);

  /**
   * Puts a whole model on the canvas as one undoable step. The first diagram
   * starts a fresh history: undoing back to "no diagram" would leave nothing to
   * redo from.
   */
  const replace = useCallback((next: DiagramModel | null) => {
    generation.current++;
    setHistory((h) => (h.present === null ? createHistory(next) : commit(h, next)));
  }, []);

  /**
   * Lands a run's D2 on the canvas: a full layout for new diagrams and
   * reviewer fixes, or merged into the current layout for chat edits.
   */
  const acceptRunCode = useCallback(async (code: string, layout: RunLayout, signal?: AbortSignal): Promise<AcceptResult> => {
    const started = generation.current;
    const current = historyRef.current.present;
    const { model: imported, warnings } = await importCode(code, signal);
    // Async results only land if the diagram hasn't changed (edit, undo, New…) meanwhile.
    if (generation.current !== started) return { added: 0, regrouped: 0, warnings: [] };
    if (layout === "stable" && current && current.nodes.length > 0) {
      const merged = mergeStable(current, imported);
      replace(routeModelEdges(merged.model));
      return { added: merged.added.length, regrouped: merged.regrouped.length, warnings };
    }
    replace({ ...imported, handArranged: false });
    return { added: imported.nodes.length, regrouped: 0, warnings };
  }, [replace]);

  /** Re-lays out the current diagram (R15): composed diagrams are recomposed from their spec, graphs re-run D2's layout. */
  const tidyUp = useCallback(async () => {
    const started = generation.current;
    const current = historyRef.current.present;
    if (!current || current.nodes.length === 0) return;
    if (current.composed) {
      replace({ ...recompose(current).model, handArranged: false });
      return;
    }
    const { model: imported } = await importCode(modelToD2(current));
    if (generation.current !== started) throw new Error("The diagram changed while it was being tidied. Try again.");
    // D2 has no empty groups; keep the ones you made.
    replace({ ...carryContainers(current, imported), handArranged: false });
  }, [replace]);

  /**
   * Lands a run's composition spec on the canvas. The layout is deterministic,
   * so an edit keeps everything it didn't touch in place; the page width is
   * kept too, so the page doesn't reflow.
   */
  const acceptRunSpec = useCallback(
    (spec: string): AcceptResult => {
      const current = historyRef.current.present;
      const { model: composed, warnings } = composeText(spec, { preferWidth: pageWidthOf(current) });
      replace({ ...composed, handArranged: false });
      return { added: 0, regrouped: 0, warnings };
    },
    [replace],
  );

  /** Opens D2 or a composition spec (JSON) from elsewhere as the current diagram (undoable). */
  const importD2 = useCallback(
    async (code: string, signal?: AbortSignal): Promise<string[]> => {
      const started = generation.current;
      if (looksLikeSpec(code)) {
        const { model: composed, warnings } = composeText(code);
        replace(composed);
        return warnings;
      }
      const { model: imported, warnings } = await importCode(code, signal);
      if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
      if (generation.current !== started) throw new Error("The diagram changed while importing. Try again.");
      replace({ ...imported, handArranged: false });
      return warnings;
    },
    [replace],
  );

  const clear = useCallback(() => {
    generation.current++;
    clearedRef.current = true;
    setHistory(createHistory(null));
    setError(null);
  }, []);

  const undo = useCallback(() => {
    generation.current++;
    setHistory((h) => undoHistory(h));
  }, []);
  const redo = useCallback(() => {
    generation.current++;
    setHistory((h) => redoHistory(h));
  }, []);

  const d2 = useMemo(() => (model && model.nodes.length > 0 ? modelToD2(model) : ""), [model]);
  /** The composition spec of a composed diagram (what AI edits start from); "" otherwise. */
  const specText = useMemo(() => (model?.composed && model.nodes.length > 0 ? modelSpecText(model) : ""), [model]);

  return {
    model,
    d2,
    specText,
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
    acceptRunSpec,
    tidyUp,
    importD2,
    clear,
  };
}

export type DiagramDocument = ReturnType<typeof useDiagramDocument>;
