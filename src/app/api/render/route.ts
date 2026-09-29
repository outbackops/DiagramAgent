import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { getRequestCredentials } from "@/lib/auth/session";
import { compileD2, D2BusyError, D2RenderError } from "@/lib/d2-render";
import { LlmError } from "@/lib/llm/errors";
import { modelFromCompiled } from "@/lib/model/from-d2";
import { modelToCompiled } from "@/lib/model/quality";
import { renderModelSvg } from "@/lib/model/render-svg";
import { routeModelEdges } from "@/lib/model/route";
import { modelToD2 } from "@/lib/model/to-d2";
import { validateModel } from "@/lib/model/validate";
import { scoreDiagram, type QualityReport } from "@/lib/quality/diagram-quality";

export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 200_000;
const MAX_BODY_BYTES = 4_000_000;

function score(code: string, diagram: Parameters<typeof scoreDiagram>[1]): QualityReport | null {
  try {
    return scoreDiagram(code, diagram);
  } catch (err) {
    console.error("Quality scoring failed:", err);
    return null;
  }
}

/**
 * Renders a diagram and scores it deterministically.
 * - `{ code }`: D2 is compiled (full automatic layout) and imported into a model.
 * - `{ model }`: an edited model is rendered as-is.
 * Either way the SVG comes from the model renderer, so the canvas, exports and
 * the vision reviewer all see the same picture.
 */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!getRequestCredentials(request)) {
    return jsonError(new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent."));
  }

  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request, MAX_BODY_BYTES);
  } catch (err) {
    return jsonError(err, "Render API error");
  }

  if (body?.model !== undefined) {
    const result = validateModel(body.model);
    if (!result.ok) return NextResponse.json({ error: `Invalid diagram: ${result.error}` }, { status: 400 });
    const model = routeModelEdges(result.model);
    return NextResponse.json({ svg: renderModelSvg(model), quality: score(modelToD2(model), modelToCompiled(model)) });
  }

  const code = body?.code;
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "No D2 code provided" }, { status: 400 });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: "Diagram code is too large" }, { status: 413 });
  }

  try {
    const { diagram } = await compileD2(code, { signal: request.signal });
    const { model, warnings } = modelFromCompiled(diagram, { code });
    return NextResponse.json({ svg: renderModelSvg(model), quality: score(code, diagram), model, warnings });
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
