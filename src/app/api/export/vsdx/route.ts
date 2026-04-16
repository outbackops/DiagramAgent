import { NextRequest } from "next/server";
import { d2ToDrawio } from "@/lib/d2-to-drawio";

/**
 * Export a diagram as a draw.io/diagrams.net XML file (.drawio).
 *
 * Creates native editable mxGraph shapes from D2 source code — NOT an
 * embedded image. The resulting file opens in draw.io with fully
 * selectable, movable, and connectable shapes that can be further
 * exported to Visio (.vsdx) from draw.io's File → Export menu.
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

    // Convert D2 code to native draw.io XML with editable shapes
    const drawioXml = d2ToDrawio(d2Code, diagramTitle);

    const buffer = Buffer.from(drawioXml, "utf-8");

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(diagramTitle)}.drawio"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error: any) {
    console.error("Draw.io export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to export" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
