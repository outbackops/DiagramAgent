export interface ModelConfig {
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

export const AVAILABLE_MODELS: ModelConfig[] = [
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
    description: "Expert planner — architecture analysis & critique (requires deployment)",
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

export function getModelConfig(modelId: string): ModelConfig {
  return AVAILABLE_MODELS.find((m) => m.id === modelId) || AVAILABLE_MODELS[0];
}

// --- Role-based model resolution ---

export type ModelRole = 'generator' | 'clarifier' | 'planner' | 'judge';

const ROLE_DEFAULTS: Record<ModelRole, string> = {
  generator: 'gpt-5.2-chat',
  clarifier: 'gpt-5.2-chat',
  planner: 'gpt-5.2-chat',
  judge: 'gpt-4o',
};

const ROLE_ENV_KEYS: Record<ModelRole, string> = {
  generator: 'MODEL_GENERATOR',
  clarifier: 'MODEL_CLARIFIER',
  planner: 'MODEL_PLANNER',
  judge: 'MODEL_JUDGE',
};

/**
 * Per-role completion-token budgets. These were previously hardcoded inline
 * in each route (clarify=4000, plan=8000, assess=4000), making model-config
 * drift invisible. Centralised here so the budget travels with the role.
 *
 * Generator uses the model's own `maxTokens` because it streams long D2 code;
 * the other roles return small structured JSON and need much less.
 */
export const ROLE_TOKEN_LIMITS: Record<ModelRole, number> = {
  generator: 0, // sentinel — generator uses ModelConfig.maxTokens
  clarifier: 4000,
  planner: 8000,
  judge: 4000,
};

/**
 * Returns the completion-token budget for a role. For 'generator' this falls
 * back to the resolved model's own maxTokens (since generator streams long
 * D2 code).
 */
export function getRoleTokenLimit(role: ModelRole): number {
  if (role === 'generator') {
    return getModelByRole('generator').maxTokens;
  }
  return ROLE_TOKEN_LIMITS[role];
}

const warnedEnvKeys = new Set<string>();

export function getModelByRole(role: ModelRole): ModelConfig {
  const envKey = ROLE_ENV_KEYS[role];
  const envVal = process.env[envKey];
  if (envVal) {
    const found = AVAILABLE_MODELS.find((m) => m.id === envVal);
    if (found) return found;
    if (!warnedEnvKeys.has(envKey)) {
      warnedEnvKeys.add(envKey);
      console.warn(`${envKey}="${envVal}" is not a known model id; falling back to "${ROLE_DEFAULTS[role]}"`);
    }
  }
  return AVAILABLE_MODELS.find((m) => m.id === ROLE_DEFAULTS[role])!;
}

// Vision model used for diagram assessment (backwards compat). Lazily resolved
// to honour env overrides at request time, not module-load time.
export const VISION_MODEL_ID: string = ROLE_DEFAULTS.judge;
