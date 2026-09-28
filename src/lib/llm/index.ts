import { azureProvider } from "./azure-provider";
import { copilotProvider } from "./copilot-provider";
import { LlmError, isLlmError, type LlmErrorCode } from "./errors";
import { getDefaultSelection, pickDefaultSelection, validateSelection } from "./selection";
import type { CatalogModel, LlmCredentials, LlmProvider, ModelSelection, ProviderId } from "./types";

const PROVIDERS: Record<ProviderId, LlmProvider> = {
  copilot: copilotProvider,
  azure: azureProvider,
};

export function getProvider(id: ProviderId): LlmProvider {
  return PROVIDERS[id];
}

export interface CatalogResult {
  models: CatalogModel[];
  defaultSelection: ModelSelection | null;
  errors: Partial<Record<ProviderId, { code: LlmErrorCode | "internal"; message: string }>>;
}

/** Every model the caller may use, across configured providers. Provider failures are reported, not thrown. */
export async function listCatalog(credentials: LlmCredentials): Promise<CatalogResult> {
  const errors: CatalogResult["errors"] = {};
  const results = await Promise.all(
    (Object.keys(PROVIDERS) as ProviderId[]).map(async (id) => {
      const provider = PROVIDERS[id];
      if (!provider.isConfigured()) return [];
      try {
        return await provider.listModels(credentials);
      } catch (err) {
        errors[id] = isLlmError(err)
          ? { code: err.code, message: err.message }
          : { code: "internal", message: "Could not load models" };
        return [];
      }
    }),
  );
  const models = results.flat();
  const preferred = getDefaultSelection();
  const defaultSelection =
    pickDefaultSelection(models.filter((m) => m.provider === preferred.provider), preferred) ??
    pickDefaultSelection(models, preferred);
  return { models, defaultSelection, errors };
}

/**
 * Turn an (optional) requested selection into one that is known to be valid
 * for this caller. With no request, the configured default is used, falling
 * back through the preference list.
 */
export async function resolveSelection(
  requested: ModelSelection | null | undefined,
  credentials: LlmCredentials,
): Promise<ModelSelection> {
  const wanted = requested ?? getDefaultSelection();
  const provider = getProvider(wanted.provider);
  if (!provider.isConfigured()) {
    throw new LlmError("not_configured", `The ${wanted.provider} provider is not configured on this server.`);
  }
  const catalog = await provider.listModels(credentials);
  if (requested) return validateSelection(requested, catalog);
  const fallback = pickDefaultSelection(catalog, wanted);
  if (!fallback) throw new LlmError("model_unavailable", "No models are available for this account.");
  return fallback;
}

/** Whether the resolved model accepts image input (needed for the vision reviewer). */
export async function selectionSupportsVision(selection: ModelSelection, credentials: LlmCredentials): Promise<boolean> {
  const catalog = await getProvider(selection.provider).listModels(credentials);
  return catalog.some((m) => m.provider === selection.provider && m.id === selection.model && m.vision);
}

export { LlmError, isLlmError } from "./errors";
export type * from "./types";
