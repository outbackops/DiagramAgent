import { NextResponse } from "next/server";
import { compileD2, D2BusyError, D2RenderError } from "@/lib/d2-render";
import { modelFromCompiled } from "@/lib/model/from-d2";
import { routeModelEdges } from "@/lib/model/route";
import type { DiagramModel } from "@/lib/model/types";
import { validateModel } from "@/lib/model/validate";

const MAX_CODE_LENGTH = 200_000;

/**
 * The diagram an export or render request is about: `{ model }` (what the
 * canvas shows, validated) or, for older callers, `{ d2Code }` (compiled and
 * imported with a fresh layout).
 */
export async function modelFromBody(
  body: Record<string, unknown> | null,
  signal?: AbortSignal,
): Promise<{ model: DiagramModel } | { response: Response }> {
  if (body?.model !== undefined) {
    const result = validateModel(body.model);
    if (!result.ok) return { response: NextResponse.json({ error: `Invalid diagram: ${result.error}` }, { status: 400 }) };
    return { model: routeModelEdges(result.model) };
  }
  const code = body?.d2Code;
  if (typeof code !== "string" || !code.trim()) {
    return { response: NextResponse.json({ error: "A diagram is required" }, { status: 400 }) };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return { response: NextResponse.json({ error: "Diagram code is too large" }, { status: 413 }) };
  }
  try {
    const { diagram } = await compileD2(code, { signal });
    return { model: modelFromCompiled(diagram, { code }).model };
  } catch (err) {
    if (err instanceof D2BusyError) return { response: NextResponse.json({ error: err.message }, { status: 503 }) };
    if (err instanceof D2RenderError) return { response: NextResponse.json({ error: err.message }, { status: 422 }) };
    throw err;
  }
}

export function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
