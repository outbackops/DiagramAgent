import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { pollDeviceFlow } from "@/lib/auth/device-flow";
import { deviceFlowClientId } from "@/lib/auth/policy";
import { sessionCookie } from "@/lib/auth/session";
import { copilotProvider } from "@/lib/llm/copilot-provider";
import { LlmError, isLlmError } from "@/lib/llm/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  const clientId = deviceFlowClientId();
  if (!clientId) {
    return jsonError(new LlmError("not_configured", "In-app sign-in is not configured (set GITHUB_OAUTH_CLIENT_ID)."));
  }
  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request, 1_000_000);
  } catch (err) {
    return jsonError(err, "Device flow poll failed");
  }
  const flow = body?.flow;
  if (typeof flow !== "string" || flow.length > 4096) {
    return jsonError(new LlmError("bad_request", "Missing sign-in request handle"));
  }

  try {
    const result = await pollDeviceFlow(clientId, flow);
    if (result.status !== "complete") {
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    // Confirm the account actually has Copilot before creating a session.
    try {
      const models = await copilotProvider.listModels({ kind: "github-token", token: result.token, login: result.login });
      if (models.length === 0) throw new LlmError("forbidden", "No Copilot models are enabled for this account.");
    } catch (err) {
      const message = isLlmError(err) ? err.message : "Could not verify GitHub Copilot access";
      return NextResponse.json(
        { status: "denied", message: `Signed in as ${result.login}, but Copilot is unavailable: ${message}` },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json(
      { status: "complete", login: result.login },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.headers.append("Set-Cookie", sessionCookie(request, { token: result.token, login: result.login }));
    return response;
  } catch (err) {
    return jsonError(err, "Device flow poll failed");
  }
}
