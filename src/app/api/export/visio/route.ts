import { NextRequest } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { getRequestCredentials } from "@/lib/auth/session";
import { errorMessage } from "@/lib/error-message";
import { d2ToVsdx } from "@/lib/d2-to-vsdx";
import { LlmError, isLlmError } from "@/lib/llm/errors";

/**
 * Export a diagram as a native Microsoft Visio (.vsdx) file.
 *
 * Generates a genuine Open XML Visio package with editable shapes,
 * connectors, and styled containers. Opens directly in Microsoft Visio.
 */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  if (!getRequestCredentials(request)) {
    return jsonError(new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent."));
  }
  try {
    const body = await readJsonBody(request, 1_000_000);
    const d2Code = body?.d2Code;
    const title = body?.title;

    if (!d2Code || typeof d2Code !== "string") {
      return new Response(JSON.stringify({ error: "D2 code is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const diagramTitle = typeof title === "string" && title ? title : "Architecture Diagram";

    const vsdxBuffer = await d2ToVsdx(d2Code);

    return new Response(new Uint8Array(vsdxBuffer), {
      headers: {
        "Content-Type": "application/vnd.ms-visio.drawing",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(diagramTitle)}.vsdx"`,
        "Content-Length": String(vsdxBuffer.length),
      },
    });
  } catch (error) {
    if (isLlmError(error)) return jsonError(error);
    console.error("Visio export error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage(error) || "Failed to export Visio file" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
