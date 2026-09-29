import { LlmError } from "@/lib/llm/errors";
import type { LlmCredentials } from "@/lib/llm/types";
import { machineLoginAllowedFor } from "./policy";
import { seal, unseal } from "./seal";

export const SESSION_COOKIE = "da_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  token: string;
  login: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function readSession(request: Request): SessionPayload | null {
  const payload = unseal<SessionPayload>(readCookie(request, SESSION_COOKIE), "session");
  if (!payload || typeof payload.token !== "string" || typeof payload.login !== "string") return null;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  return payload;
}

/**
 * Credentials for an API request: the in-app GitHub sign-in wins; otherwise
 * the server machine's own GitHub login, when policy allows it.
 */
export function getRequestCredentials(request: Request): LlmCredentials | null {
  const session = readSession(request);
  if (session) return { kind: "github-token", token: session.token, login: session.login };
  return machineLoginAllowedFor(request) ? { kind: "machine" } : null;
}

export function requireCredentials(request: Request): LlmCredentials {
  const credentials = getRequestCredentials(request);
  if (!credentials) {
    throw new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent.");
  }
  return credentials;
}

function isSecure(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookie(request: Request, payload: Omit<SessionPayload, "exp">): string {
  const value = seal({ ...payload, exp: Date.now() + SESSION_TTL_SECONDS * 1000 } satisfies SessionPayload, "session");
  const secure = isSecure(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = isSecure(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
