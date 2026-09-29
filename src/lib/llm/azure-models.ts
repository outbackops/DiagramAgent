/**
 * Static catalog for the optional Azure OpenAI / AI Foundry provider.
 * These are deployment names — they only work if deployed on your resource.
 */

export interface AzureModelConfig {
  id: string;
  label: string;
  description: string;
  apiVersion: string;
  useMaxCompletionTokens: boolean;
  maxTokens: number;
  supportsTemperature: boolean;
  supportsStreaming: boolean;
  supportsVision?: boolean;
}

export const AZURE_MODELS: AzureModelConfig[] = [
  {
    id: "gpt-5.2-chat",
    label: "GPT-5.2 Chat",
    description: "Thinking model — best architecture reasoning",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 32000,
    supportsTemperature: false,
    supportsStreaming: true,
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    description: "Advanced — good balance of speed and quality",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 16000,
    supportsTemperature: false,
    supportsStreaming: true,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    description: "Standard — fast and reliable, supports vision",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 4000,
    supportsTemperature: true,
    supportsStreaming: true,
    supportsVision: true,
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Fast — quick iterations",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 16000,
    supportsTemperature: false,
    supportsStreaming: true,
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Expert planner — architecture analysis & critique",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 32000,
    supportsTemperature: false,
    supportsStreaming: true,
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    description: "Reasoning model — deep thinking, slower",
    apiVersion: "2025-04-01-preview",
    useMaxCompletionTokens: true,
    maxTokens: 16000,
    supportsTemperature: false,
    supportsStreaming: true,
  },
];

export function getAzureModelConfig(modelId: string): AzureModelConfig | undefined {
  return AZURE_MODELS.find((m) => m.id === modelId);
}
