import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api/http";
import type { AuthStatusResponse } from "@/lib/api/types";
import { deviceFlowEnabled, machineLoginAllowed } from "@/lib/auth/policy";
import { readSession } from "@/lib/auth/session";
import { azureProvider } from "@/lib/llm/azure-provider";
import { copilotProvider } from "@/lib/llm/copilot-provider";
import { isLlmError } from "@/lib/llm/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  let configError: string | undefined;
  let session: ReturnType<typeof readSession> = null;
  try {
    session = readSession(request);
  } catch (err) {
    configError = isLlmError(err) ? err.message : "Session configuration error";
  }

  const machine: AuthStatusResponse["machine"] = { allowed: machineLoginAllowed(), signedIn: false };
  if (machine.allowed && !session) {
    try {
      const status = await copilotProvider.getMachineAuthStatus();
      machine.signedIn = status.signedIn;
      machine.login = status.login;
      machine.detail = status.detail;
    } catch (err) {
      machine.error = isLlmError(err) ? err.message : "Could not reach the GitHub Copilot runtime";
    }
  }

  const body: AuthStatusResponse = {
    signedIn: Boolean(session) || machine.signedIn,
    login: session?.login ?? machine.login ?? null,
    source: session ? "user" : machine.signedIn ? "machine" : null,
    machine,
    deviceFlow: { enabled: deviceFlowEnabled() },
    providers: { copilot: true, azure: azureProvider.isConfigured() },
    ...(configError ? { configError } : {}),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
