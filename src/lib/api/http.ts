import { NextResponse } from "next/server";
import { LlmError, errorResponseBody, errorStatus } from "@/lib/llm/errors";

/**
 * Cheap CSRF / drive-by protection for the API. Model calls spend the
 * user's Copilot quota, so a random web page must not be able to trigger
 * them through the browser:
 *  - POSTs must be JSON (cross-origin JSON requires a CORS preflight we never grant)
 *  - browsers that report a cross-site fetch are refused
 *  - an Origin header, when present, must match the request host
 */
export function guardApiRequest(request: Request): Response | null {
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Expected application/json", code: "bad_request" }, { status: 415 });
    }
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site requests are not allowed", code: "forbidden" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!host || originHost !== host) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed", code: "forbidden" }, { status: 403 });
    }
  }
  return null;
}

export function jsonError(err: unknown, logLabel?: string): Response {
  const status = errorStatus(err);
  if (status >= 500 && logLabel) console.error(`${logLabel}:`, err);
  return NextResponse.json(errorResponseBody(err), { status });
}

/** Parse a capped JSON body, returning null (instead of throwing) when it is malformed. */
export async function readJsonBody(request: Request, maxBytes = 1_000_000): Promise<Record<string, unknown> | null> {
  const length = request.headers.get("content-length");
  if (length) {
    const bytes = Number(length);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new LlmError("bad_request", "Request body is too large", 413);
    }
  }

  try {
    let text: string;
    if (request.body) {
      const reader = request.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new LlmError("bad_request", "Request body is too large", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await request.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new LlmError("bad_request", "Request body is too large", 413);
      }
    }
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    return null;
  }
}
