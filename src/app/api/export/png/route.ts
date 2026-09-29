import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { getRequestCredentials } from "@/lib/auth/session";
import { errorMessage } from "@/lib/error-message";
import { LlmError } from "@/lib/llm/errors";
import { renderModelSvg } from "@/lib/model/render-svg";
import { routeModelEdges } from "@/lib/model/route";
import { validateModel } from "@/lib/model/validate";
import { svgToPng } from "@/lib/svg-raster";

export const dynamic = "force-dynamic";

const MAX_SVG_LENGTH = 8_000_000;

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!getRequestCredentials(request)) {
    return jsonError(new LlmError("unauthenticated", "Sign in with GitHub to use DiagramAgent."));
  }

  let body: Record<string, unknown> | null;
  try {
    body = await readJsonBody(request, 10_000_000);
  } catch (err) {
    return jsonError(err, "PNG export error");
  }
  if (body?.model === undefined) {
    return NextResponse.json({ error: "A diagram is required" }, { status: 400 });
  }
  const result = validateModel(body.model);
  if (!result.ok) return NextResponse.json({ error: `Invalid diagram: ${result.error}` }, { status: 400 });
  const svg = renderModelSvg(routeModelEdges(result.model, { fallbackOnly: true }));
  if (svg.length > MAX_SVG_LENGTH) {
    return NextResponse.json({ error: "SVG is too large" }, { status: 413 });
  }

  try {
    const png = await svgToPng(svg, { density: 300, maxWidth: 8000, maxHeight: 8000 });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="diagram.png"',
      },
    });
  } catch (error) {
    console.error("PNG export error:", error);
    return NextResponse.json({ error: errorMessage(error) || "PNG export failed" }, { status: 500 });
  }
}
