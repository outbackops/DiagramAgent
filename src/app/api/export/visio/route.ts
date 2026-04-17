import { NextRequest } from "next/server";
import { d2ToVsdx } from "@/lib/d2-to-vsdx";

/**
 * Export a diagram as a native Microsoft Visio (.vsdx) file.
 *
 * Generates a genuine Open XML Visio package with editable shapes,
 * connectors, and styled containers. Opens directly in Microsoft Visio.
 */
export async function POST(request: NextRequest) {
  try {
    const { d2Code, title } = await request.json();

    if (!d2Code || typeof d2Code !== "string") {
      return new Response(JSON.stringify({ error: "D2 code is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const diagramTitle = title || "Architecture Diagram";

    const vsdxBuffer = await d2ToVsdx(d2Code);

    return new Response(new Uint8Array(vsdxBuffer), {
      headers: {
        "Content-Type": "application/vnd.ms-visio.drawing",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(diagramTitle)}.vsdx"`,
        "Content-Length": String(vsdxBuffer.length),
      },
    });
  } catch (error: any) {
    console.error("Visio export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to export Visio file" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
