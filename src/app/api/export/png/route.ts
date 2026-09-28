import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, readJsonBody } from "@/lib/api/http";
import { errorMessage } from "@/lib/error-message";
import { svgToPng } from "@/lib/svg-raster";

export const dynamic = "force-dynamic";

const MAX_SVG_LENGTH = 8_000_000;

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  const body = await readJsonBody(request);
  const svg = body?.svg;
  if (typeof svg !== "string" || !svg) {
    return NextResponse.json({ error: "SVG content is required" }, { status: 400 });
  }
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
