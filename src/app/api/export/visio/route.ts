import { NextRequest } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { modelFromBody, sanitizeFilename } from "@/lib/api/model-input";
import { getRequestCredentials } from "@/lib/auth/session";
import { errorMessage } from "@/lib/error-message";
import { LlmError, isLlmError } from "@/lib/llm/errors";
import { warningsHeaderValue } from "@/lib/model/export-result";
import { modelToVsdxResult } from "@/lib/model/to-vsdx";

/**
 * Export a diagram as a native Microsoft Visio (.vsdx) file with editable
 * shapes and connectors at the positions shown on the canvas.
 */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  if (!getRequestCredentials(request)) {
    return jsonError(new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent."));
  }
  try {
    const body = await readJsonBody(request, 4_000_000);
    const input = await modelFromBody(body, request.signal);
    if ("response" in input) return input.response;
    const title = typeof body?.title === "string" && body.title ? body.title : "Architecture Diagram";
    const result = await modelToVsdxResult(input.model);
    const vsdx = result.content;
    return new Response(new Uint8Array(vsdx), {
      headers: {
        "Content-Type": "application/vnd.ms-visio.drawing",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.vsdx"`,
        "Content-Length": String(vsdx.length),
        "X-Export-Warnings": warningsHeaderValue(result.warnings),
      },
    });
  } catch (error) {
    if (isLlmError(error)) return jsonError(error);
    console.error("Visio export error:", error);
    return Response.json({ error: errorMessage(error) || "Failed to export Visio file" }, { status: 500 });
  }
}
