import { NextRequest } from "next/server";
import { resolveIconsInD2Code } from "@/lib/icon-registry";

let d2Instance: any = null;
let d2InitPromise: Promise<any> | null = null;

async function getD2(): Promise<any> {
  if (d2Instance) return d2Instance;
  if (d2InitPromise) return d2InitPromise;

  d2InitPromise = (async () => {
    const { D2 } = await import("@terrastruct/d2");
    d2Instance = new D2();
    return d2Instance;
  })();

  return d2InitPromise;
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== "string" || !code.trim()) {
      return new Response(JSON.stringify({ error: "No D2 code provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const d2 = await getD2();
    const resolvedCode = resolveIconsInD2Code(code);

    const result = await d2.compile(resolvedCode, {
      layout: "elk",
      sketch: false,
      pad: 40,
    });

    const svg = await d2.render(result.diagram, {
      ...result.renderOptions,
      themeID: 0,
      center: true,
      noXMLTag: true,
    });

    return new Response(JSON.stringify({ svg }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("D2 render error:", err);

    // Try to extract useful error message
    let errorMessage = err?.message || "Failed to render diagram";
    try {
      const parsed = JSON.parse(errorMessage);
      if (Array.isArray(parsed) && parsed[0]?.errmsg) {
        errorMessage = parsed.map((e: any) => e.errmsg).join("\n");
      }
    } catch {
      // keep original message
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }
}
