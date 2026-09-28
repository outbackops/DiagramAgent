import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { getRequestCredentials } from "@/lib/auth/session";
import { D2BusyError, D2RenderError, renderD2 } from "@/lib/d2-render";
import { LlmError } from "@/lib/llm/errors";
import { scoreDiagram } from "@/lib/quality/diagram-quality";

export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 200_000;

/** Render D2 to SVG and score it deterministically. */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!getRequestCredentials(request)) {
    return jsonError(new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent."));
  }

  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request, 1_000_000);
  } catch (err) {
    return jsonError(err, "Render API error");
  }
  const code = body?.code;
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "No D2 code provided" }, { status: 400 });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: "Diagram code is too large" }, { status: 413 });
  }

  try {
    const { svg, diagram } = await renderD2(code, { signal: request.signal });
    let quality = null;
    try {
      quality = scoreDiagram(code, diagram);
    } catch (err) {
      console.error("Quality scoring failed:", err);
    }
    return NextResponse.json({ svg, quality });
  } catch (err) {
    if (err instanceof D2BusyError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof Error && err.name === "AbortError") return NextResponse.json({ error: "Request was cancelled" }, { status: 499 });
    // 422 means "the D2 is wrong" to clients (they offer an AI fix); anything else is ours.
    if (!(err instanceof D2RenderError)) {
      console.error("D2 render error:", err);
      return NextResponse.json({ error: "Failed to render diagram" }, { status: 500 });
    }
    return NextResponse.json({ error: err.message }, { status: 422 });
  }
}
