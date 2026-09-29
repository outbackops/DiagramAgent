/**
 * Shapes of JSON returned by the API routes, shared with the UI.
 * Type-only; nothing here runs on the client.
 */
import type { CatalogModel, ModelSelection, ProviderId } from "@/lib/llm/types";

export interface AuthStatusResponse {
  signedIn: boolean;
  login: string | null;
  source: "user" | "machine" | null;
  machine: { allowed: boolean; signedIn: boolean; login?: string; detail?: string; error?: string };
  deviceFlow: { enabled: boolean };
  providers: { copilot: boolean; azure: boolean };
  configError?: string;
}

export interface ModelsResponse {
  models: CatalogModel[];
  defaultSelection: ModelSelection | null;
  errors: Partial<Record<ProviderId, { code: string; message: string }>>;
}

export interface DeviceFlowStartResponse {
  flow: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowPollResponse =
  | { status: "pending"; interval?: number }
  | { status: "slow_down"; interval: number }
  | { status: "complete"; login: string }
  | { status: "expired" | "denied"; message: string };

export interface ApiErrorBody {
  error: string;
  code?: string;
}
