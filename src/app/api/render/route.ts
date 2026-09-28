import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, readJsonBody } from "@/lib/api/http";
import { D2RenderError, renderD2 } from "@/lib/d2-render";
import { scoreDiagram } from "@/lib/quality/diagram-quality";

export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 200_000;

/** Render D2 to SVG and score it deterministically. */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  const code = body?.code;
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "No D2 code provided" }, { status: 400 });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return NextResponse.json({ error: "Diagram code is too large" }, { status: 413 });
  }

  try {
    const { svg, diagram } = await renderD2(code);
    let quality = null;
    try {
      quality = scoreDiagram(code, diagram);
    } catch (err) {
      console.error("Quality scoring failed:", err);
    }
    return NextResponse.json({ svg, quality });
  } catch (err) {
    if (!(err instanceof D2RenderError)) console.error("D2 render error:", err);
    const message = err instanceof D2RenderError ? err.message : "Failed to render diagram";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
