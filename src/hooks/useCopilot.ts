"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthStatusResponse, ModelsResponse } from "@/lib/api/types";
import { api } from "@/lib/client/api";
import { DEFAULT_SELECTION, coerceSelection, validateSelection } from "@/lib/llm/selection";
import type { CatalogModel, ModelSelection } from "@/lib/llm/types";
import { usePersistedState } from "@/lib/use-persisted-state";

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Sign-in state and the model catalog for the current identity. */
export function useCopilotSession() {
  const [auth, setAuth] = useState<AuthStatusResponse | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelsResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.authStatus();
      setAuth(status);
      setAuthError(null);
      if (status.signedIn || status.providers.azure) {
        try {
          setCatalog(await api.models());
          setCatalogError(null);
        } catch (err) {
          setCatalog(null);
          setCatalogError(errText(err));
        }
      } else {
        setCatalog(null);
        setCatalogError(null);
      }
    } catch (err) {
      setAuthError(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signOut();
    await refresh();
  }, [refresh]);

  return { auth, authError, catalog, catalogError, loading, refresh, signOut };
}

const isSelection = (v: unknown): v is ModelSelection => coerceSelection(v) !== null;
const isReviewer = (v: unknown): v is ModelSelection | "same" => v === "same" || isSelection(v);

function reconcile(selection: ModelSelection | null, models: CatalogModel[]): ModelSelection | null {
  if (!selection) return null;
  try {
    return validateSelection(selection, models);
  } catch {
    return null;
  }
}

export function findModel(models: CatalogModel[], selection: ModelSelection | null): CatalogModel | undefined {
  if (!selection) return undefined;
  return models.find((m) => m.provider === selection.provider && m.id === selection.model);
}

/**
 * The persisted model choice (and reviewer choice), reconciled against the
 * catalog the account is actually entitled to.
 */
export function useModelChoice(catalog: ModelsResponse | null) {
  const [stored, setStored] = usePersistedState<ModelSelection | null>("diagramAgent.model.v2", null, {
    validate: (v): v is ModelSelection | null => v === null || isSelection(v),
  });
  const [storedReviewer, setStoredReviewer] = usePersistedState<ModelSelection | "same">("diagramAgent.reviewer.v2", "same", {
    validate: isReviewer,
  });

  const models = useMemo(() => catalog?.models ?? [], [catalog]);

  const selection: ModelSelection = useMemo(() => {
    if (!catalog) return stored ?? DEFAULT_SELECTION;
    return reconcile(stored, models) ?? catalog.defaultSelection ?? stored ?? DEFAULT_SELECTION;
  }, [catalog, models, stored]);

  const reviewer: ModelSelection = useMemo(() => {
    if (storedReviewer === "same") return selection;
    return (catalog ? reconcile(storedReviewer, models) : storedReviewer) ?? selection;
  }, [catalog, models, selection, storedReviewer]);

  // A stored reviewer that the account can no longer use falls back to "same as main model".
  const reviewerChoice: ModelSelection | "same" =
    storedReviewer === "same" || (catalog && !reconcile(storedReviewer, models)) ? "same" : storedReviewer;

  const primaryModel = findModel(models, selection);
  const reviewerModel = findModel(models, reviewer);
  const reviewerSupportsVision = catalog ? Boolean(reviewerModel?.vision) : true;

  return {
    models,
    selection,
    setSelection: setStored,
    primaryModel,
    reviewer,
    reviewerChoice,
    setReviewerChoice: setStoredReviewer,
    reviewerModel,
    reviewerSupportsVision,
  };
}
