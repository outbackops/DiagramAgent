import { NextRequest, NextResponse } from "next/server";
import { resolveStepContext } from "@/lib/api/context";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { AssessBody, parseBody } from "@/lib/api/schemas";
import { selectionSupportsVision } from "@/lib/llm";
import { LlmError } from "@/lib/llm/errors";
import { runAssess } from "@/lib/pipeline/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vision review of a rendered diagram. `model` is the reviewer model and must accept images. */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  try {
    const body = parseBody(AssessBody, await readJsonBody(request, 10_000_000));
    const ctx = await resolveStepContext(request, body.model);
    if (!(await selectionSupportsVision(ctx.selection, ctx.credentials))) {
      throw new LlmError("bad_request", `${ctx.selection.model} cannot review images. Choose a vision-capable reviewer model.`);
    }
    const result = await runAssess(
      { svg: body.svg, prompt: body.prompt, d2Code: body.d2Code, format: body.format },
      { ...ctx, signal: request.signal },
    );
    return NextResponse.json({ assessment: result.assessment, model: ctx.selection, usage: result.usage });
  } catch (err) {
    return jsonError(err, "Assess API error");
  }
}
