import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export async function POST(request: NextRequest) {
  try {
    const { svg } = await request.json();

    if (!svg) {
      return new Response(JSON.stringify({ error: "SVG content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const svgBuffer = Buffer.from(svg);
    // Use higher density for better quality export
    const pngBuffer = await sharp(svgBuffer, { density: 300 })
      .png()
      .toBuffer();

    return new Response(pngBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="diagram.png"',
      },
    });
  } catch (error: any) {
    console.error("PNG export error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
