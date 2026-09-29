import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError } from "@/lib/api/http";
import { startDeviceFlow } from "@/lib/auth/device-flow";
import { deviceFlowClientId } from "@/lib/auth/policy";
import { LlmError } from "@/lib/llm/errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  const clientId = deviceFlowClientId();
  if (!clientId) {
    return jsonError(new LlmError("not_configured", "In-app sign-in is not configured (set GITHUB_OAUTH_CLIENT_ID)."));
  }
  try {
    const start = await startDeviceFlow(clientId);
    return NextResponse.json(start, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err, "Device flow start failed");
  }
}
