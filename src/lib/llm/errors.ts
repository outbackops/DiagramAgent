export type LlmErrorCode =
  | "not_configured"
  | "unauthenticated"
  | "forbidden"
  | "model_unavailable"
  | "rate_limited"
  | "quota"
  | "timeout"
  | "aborted"
  | "bad_request"
  | "invalid_output"
  | "upstream";

const DEFAULT_STATUS: Record<LlmErrorCode, number> = {
  not_configured: 503,
  unauthenticated: 401,
  forbidden: 403,
  model_unavailable: 400,
  rate_limited: 429,
  quota: 429,
  timeout: 504,
  aborted: 499,
  bad_request: 400,
  invalid_output: 422,
  upstream: 502,
};

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number;

  constructor(code: LlmErrorCode, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status ?? DEFAULT_STATUS[code];
  }
}

export function isLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError;
}

/** Map an HTTP status from an upstream model API to our error vocabulary. */
export function llmErrorFromStatus(status: number, message: string): LlmError {
  if (status === 401) return new LlmError("unauthenticated", message, 401);
  if (status === 403) return new LlmError("forbidden", message, 403);
  if (status === 404) return new LlmError("model_unavailable", message, 404);
  if (status === 429) return new LlmError("rate_limited", message, 429);
  if (status === 408 || status === 504) return new LlmError("timeout", message, 504);
  if (status >= 400 && status < 500) return new LlmError("bad_request", message, status);
  return new LlmError("upstream", message, status >= 500 ? status : 502);
}

/**
 * JSON body for an API error response. Messages from LlmError are written by
 * us and safe to show; anything else is collapsed to a generic message so we
 * never echo stack traces or upstream payloads to the browser.
 */
export function errorResponseBody(err: unknown): { error: string; code: LlmErrorCode | "internal" } {
  if (isLlmError(err)) return { error: err.message, code: err.code };
  return { error: "Internal server error", code: "internal" };
}

export function errorStatus(err: unknown): number {
  return isLlmError(err) ? err.status : 500;
}
