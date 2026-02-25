import { NextRequest } from "next/server";
import sharp from "sharp";

/**
 * Export a diagram as a draw.io/diagrams.net XML file (.drawio).
 * 
 * This format can be:
 * - Opened directly in draw.io (desktop or web)
 * - Imported into Microsoft Visio via draw.io's Visio export
 * - Opened in any tool that supports draw.io format
 * 
 * The diagram is embedded as a high-resolution PNG image that
 * can be further edited in draw.io or converted to native Visio shapes.
 */
export async function POST(request: NextRequest) {
  try {
    const { svg, title } = await request.json();

    if (!svg || typeof svg !== "string") {
      return new Response(JSON.stringify({ error: "SVG content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const diagramTitle = title || "Architecture Diagram";

    // Convert SVG to PNG for embedding
    let pngBase64: string;
    let imgW = 800;
    let imgH = 600;
    try {
      const pngBuffer = await sharp(Buffer.from(svg, "utf-8"), { density: 150 })
        .resize({ width: 3200, height: 2400, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      const metadata = await sharp(pngBuffer).metadata();
      imgW = metadata.width || 800;
      imgH = metadata.height || 600;
      pngBase64 = pngBuffer.toString("base64");
    } catch {
      // Fallback placeholder
      const buf = await sharp({
        create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      }).png().toBuffer();
      pngBase64 = buf.toString("base64");
    }

    // Build draw.io XML
    // draw.io uses mxGraph XML format — an image shape with the PNG embedded as data URI
    const drawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="DiagramAgent" modified="${new Date().toISOString()}" agent="DiagramAgent/0.1" version="24.0.0" type="device">
  <diagram id="diagram-1" name="${escapeXml(diagramTitle)}">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.max(imgW + 100, 1169)}" pageHeight="${Math.max(imgH + 100, 827)}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="" style="shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=data:image/png,${pngBase64};" vertex="1" parent="1">
          <mxGeometry x="50" y="50" width="${imgW}" height="${imgH}" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

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

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
