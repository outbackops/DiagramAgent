import { NextRequest } from "next/server";
import { resolveIconsInD2Code } from "@/lib/icon-registry";
import { convertConnectionsToOrthogonal } from "@/lib/svg-orthogonal";
import { errorMessage as toErrorMessage } from "@/lib/error-message";

// Narrow structural typing for the parts of the D2 API we actually use,
// without trying to mirror the upstream type surface (which is large and
// not stable across versions).
type D2Like = {
  compile: (code: string, opts: { layout: string; sketch: boolean; pad: number }) => Promise<{
    diagram: unknown;
    renderOptions: Record<string, unknown>;
  }>;
  render: (diagram: unknown, opts: Record<string, unknown>) => Promise<string>;
};

let d2Instance: D2Like | null = null;
let d2InitPromise: Promise<D2Like> | null = null;

async function getD2(): Promise<D2Like> {
  if (d2Instance) return d2Instance;
  if (d2InitPromise) return d2InitPromise;

  d2InitPromise = (async () => {
    const { D2 } = await import("@terrastruct/d2");
    // The upstream constructor signature is broader than D2Like; we narrow
    // it via an unknown bounce so the assignment is explicit.
    const inst = new D2() as unknown as D2Like;
    d2Instance = inst;
    return inst;
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
    console.log("[Render API] D2 compiled");

    const svg = await d2.render(result.diagram, {
      ...result.renderOptions,
      themeID: 0,
      center: true,
      noXMLTag: true,
    });
    console.log("[Render API] D2 rendered, length:", svg.length);

    // Post-process: convert curved connectors to orthogonal (right-angled) lines
    const processedSvg = convertConnectionsToOrthogonal(svg, 8);
    console.log("[Render API] Orthogonal post-processing complete, length:", processedSvg.length);

    return new Response(JSON.stringify({ svg: processedSvg }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("D2 render error:", err);

    // Try to extract useful error message
    let errorText = toErrorMessage(err) || "Failed to render diagram";
    try {
      const parsed = JSON.parse(errorText);
      if (Array.isArray(parsed) && parsed[0]?.errmsg) {
        errorText = parsed.map((e: { errmsg?: string }) => e.errmsg ?? "").join("\n");
      }
    } catch {
      // keep original message
    }

    return new Response(
      JSON.stringify({ error: errorText }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }
}
