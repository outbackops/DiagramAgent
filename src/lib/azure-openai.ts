import { getAzureEndpoint } from "@/lib/azure-auth";

/**
 * Build the chat completions URL for an Azure OpenAI / AI Foundry endpoint.
 * Handles three endpoint flavours:
 *   1. Classic Azure OpenAI (*.openai.azure.com) — per-deployment path
 *   2. AI Foundry (services.ai.azure.com) — /models/chat/completions
 *   3. Other — append /chat/completions
 */
export function buildChatCompletionsUrl(modelId: string, apiVersion: string): string {
  const endpoint = getAzureEndpoint();
  if (!endpoint) {
    throw new Error("Azure AI Foundry endpoint is not configured");
  }

  const baseEndpoint = endpoint.trim().replace(/\/+$/, "");

  if (baseEndpoint.includes(".openai.azure.com")) {
    const base = baseEndpoint.replace(/\/openai\/.*$/, "");
    return `${base}/openai/deployments/${modelId}/chat/completions?api-version=${apiVersion}`;
  }

  if (baseEndpoint.includes("services.ai.azure.com")) {
    const base = baseEndpoint.replace(/\/models\/?$/, "").replace(/\/api\/projects\/.*$/, "");
    return `${base}/models/chat/completions?api-version=${apiVersion}`;
  }

  return `${baseEndpoint}/chat/completions?api-version=${apiVersion}`;
}
