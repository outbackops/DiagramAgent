import { getAuthHeaders, getAzureEndpoint } from "@/lib/azure-auth";
import { buildChatCompletionsUrl } from "@/lib/azure-openai";
import { AZURE_MODELS, getAzureModelConfig, type AzureModelConfig } from "./azure-models";
import { LlmError, isLlmError, llmErrorFromStatus } from "./errors";
import type { CatalogModel, LlmProvider, LlmRequest, LlmResult } from "./types";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" } };

function buildMessages(request: LlmRequest) {
  const messages: Array<{ role: string; content: string | ContentPart[] }> = [
    { role: "system", content: request.system },
  ];
  for (const turn of request.history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }
  if (request.images && request.images.length > 0) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: request.prompt },
        ...request.images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" as const },
        })),
      ],
    });
  } else {
    messages.push({ role: "user", content: request.prompt });
  }
  return messages;
}

function buildBody(config: AzureModelConfig, request: LlmRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.id,
    messages: buildMessages(request),
    stream,
  };
  const budget = Math.min(request.maxOutputTokens ?? config.maxTokens, config.maxTokens);
  if (config.useMaxCompletionTokens) body.max_completion_tokens = budget;
  else body.max_tokens = budget;
  if (config.supportsTemperature && request.temperature !== undefined) {
    body.temperature = request.temperature;
  }
  return body;
}

/**
 * Optional provider for Azure OpenAI / AI Foundry deployments. Auth is
 * Microsoft Entra ID via DefaultAzureCredential — no API keys.
 */
export class AzureProvider implements LlmProvider {
  readonly id = "azure" as const;

  isConfigured(): boolean {
    return getAzureEndpoint().length > 0;
  }

  async listModels(): Promise<CatalogModel[]> {
    if (!this.isConfigured()) return [];
    return AZURE_MODELS.map((m) => ({
      provider: "azure" as const,
      id: m.id,
      name: m.label,
      description: m.description,
      vision: Boolean(m.supportsVision),
      reasoningEfforts: [],
      maxOutputTokens: m.maxTokens,
    }));
  }

  complete(request: LlmRequest): Promise<LlmResult> {
    return this.call(request);
  }

  stream(request: LlmRequest, onDelta: (chunk: string) => void): Promise<LlmResult> {
    return this.call(request, onDelta);
  }

  private async call(request: LlmRequest, onDelta?: (chunk: string) => void): Promise<LlmResult> {
    if (!this.isConfigured()) {
      throw new LlmError("not_configured", "Azure OpenAI is not configured (set AZURE_AI_FOUNDRY_ENDPOINT).");
    }
    const config = getAzureModelConfig(request.selection.model);
    if (!config) {
      throw new LlmError("model_unavailable", `Unknown Azure model "${request.selection.model}"`);
    }

    const stream = Boolean(onDelta) && config.supportsStreaming;
    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(new LlmError("timeout", "Azure OpenAI request timed out")), timeoutMs);
    const onAbort = () => controller.abort(new LlmError("aborted", "Request was cancelled"));
    request.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(buildChatCompletionsUrl(config.id, config.apiVersion), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify(buildBody(config, request, stream)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("Azure OpenAI error:", response.status, detail.slice(0, 500));
        throw llmErrorFromStatus(response.status, `Azure OpenAI error ${response.status}`);
      }

      const text = stream ? await readSse(response, onDelta!) : await readJson(response);
      return { text, usage: { model: config.id, durationMs: Date.now() - started } };
    } catch (err) {
      if (isLlmError(err)) throw err;
      const reason = controller.signal.reason;
      if (isLlmError(reason)) throw reason;
      throw new LlmError("upstream", `Azure OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readJson(response: Response): Promise<string> {
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function readSse(response: Response, onDelta: (chunk: string) => void): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const chunk = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
        if (chunk) {
          text += chunk;
          onDelta(chunk);
        }
      } catch {
        // Ignore keep-alives and malformed frames.
      }
    }
  }
  return text;
}

export const azureProvider = new AzureProvider();
