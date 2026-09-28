import { NextRequest, NextResponse } from "next/server";
import { resolveStepContext } from "@/lib/api/context";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { ClarifyBody, parseBody } from "@/lib/api/schemas";
import { runClarify } from "@/lib/pipeline/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  try {
    const body = parseBody(ClarifyBody, await readJsonBody(request));
    const ctx = await resolveStepContext(request, body.model);
    const result = await runClarify(body.prompt, { ...ctx, signal: request.signal });
    return NextResponse.json({
      questions: result.questions,
      analysis: result.analysis,
      skipClarification: result.skipClarification,
      model: ctx.selection,
      usage: result.usage,
    });
  } catch (err) {
    return jsonError(err, "Clarify API error");
  }
}
