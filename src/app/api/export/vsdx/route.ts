import { NextRequest } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { modelFromBody, sanitizeFilename } from "@/lib/api/model-input";
import { getRequestCredentials } from "@/lib/auth/session";
import { errorMessage } from "@/lib/error-message";
import { LlmError, isLlmError } from "@/lib/llm/errors";
import { modelToDrawio } from "@/lib/model/to-drawio";

/**
 * Export a diagram as a draw.io/diagrams.net file (.drawio) with native,
 * editable shapes at the positions shown on the canvas.
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
    const buffer = Buffer.from(await modelToDrawio(input.model, { title }), "utf-8");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(title)}.drawio"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    if (isLlmError(error)) return jsonError(error);
    console.error("Draw.io export error:", error);
    return Response.json({ error: errorMessage(error) || "Failed to export" }, { status: 500 });
  }
}
