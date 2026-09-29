import { NextRequest, NextResponse } from "next/server";
import { resolveStepContext } from "@/lib/api/context";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { PlanBody, parseBody } from "@/lib/api/schemas";
import { runPlan } from "@/lib/pipeline/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  try {
    const body = parseBody(PlanBody, await readJsonBody(request, 1_000_000));
    const ctx = await resolveStepContext(request, body.model);
    const result = await runPlan(body.prompt, body.analysis ?? null, { ...ctx, signal: request.signal });
    return NextResponse.json({ plan: result.plan, model: ctx.selection, usage: result.usage });
  } catch (err) {
    return jsonError(err, "Plan API error");
  }
}
