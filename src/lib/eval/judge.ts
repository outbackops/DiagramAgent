import { z } from "zod";
import { getProvider } from "@/lib/llm";
import type { LlmCredentials, LlmUsage, ModelSelection } from "@/lib/llm/types";
import { parseLlmJson } from "@/lib/llm-schemas";
import { svgToPng } from "@/lib/svg-raster";

/**
 * The independent judge for evals (plan U11, R23): a different model family from the generator,
 * shown only the request and the rendered image — never the source — so it is blind to which
 * engine drew the diagram. Its score is the headline metric; the generator's own reviewer is a
 * diagnostic.
 */

export const JUDGE_SYSTEM_PROMPT = `You are an independent principal architect judging a rendered architecture diagram against the request that produced it. You see only the request and the image, not how the diagram was made.

Judge fitness for purpose: could an architect present this diagram in a design review after at most minor touch-ups?

## Anchored scale (use the whole range)
- 9-10: complete, correct and clear. The boundaries that matter for the view (cloud, account or subscription, region, network, subnet, cluster) hold concrete, correctly named services; the main flow is labelled with protocol, port or purpose and is easy to follow; everything reads at normal zoom.
- 7-8: good. Everything requested is present and correct, and grouping and boundaries are right; small layout imperfections (whitespace, a few long or crossing connectors) don't hurt reading.
- 5-6: usable but needs work: a requested component, boundary or key flow is missing or wrong, or parts are hard to read (connectors through unrelated components, overlapping text, text too small).
- 3-4: significant problems: several requested elements missing, the wrong architecture, or largely unreadable.
- 0-2: does not represent the request.

## Rules
- Supporting components a competent architect would add (DNS, identity, key management, monitoring) are not errors.
- Facts the request did not give (address ranges, SKUs, instance counts, versions) are acceptable only when the diagram marks them as assumptions. List unmarked invented facts.
- Where the request names a provider, expect that provider's services, icons and boundary conventions.
- Judge correctness, completeness and readability; do not reward decoration.

Respond with JSON only:
{"score": <integer 0-10>, "reasoning": "2-4 sentences against the scale", "missing": ["requested element that is absent or wrong"], "invented_facts": ["fact presented as known that the request did not give"], "readability_issues": ["concrete defect naming the elements involved"]}`;

export const JudgmentSchema = z.object({
  score: z.number().min(0).max(10),
  reasoning: z.string().default(""),
  missing: z.array(z.string()).default([]),
  invented_facts: z.array(z.string()).default([]),
  readability_issues: z.array(z.string()).default([]),
});

export type Judgment = z.infer<typeof JudgmentSchema>;

export type JudgeOutcome = { status: "scored"; judgment: Judgment; usage?: LlmUsage } | { status: "unreviewed"; reason: string };

export interface JudgeContext {
  selection: ModelSelection;
  credentials: LlmCredentials;
  signal?: AbortSignal;
}

export function judgePrompt(request: string): string {
  return `Request: "${request}"\n\nJudge the attached diagram against this request.`;
}

/** Scores one rendered diagram; a timeout or an unreadable answer is "unreviewed", never a score. */
export async function runJudge(input: { svg: string; prompt: string }, ctx: JudgeContext, options: { timeoutMs?: number } = {}): Promise<JudgeOutcome> {
  try {
    const png = await svgToPng(input.svg, { density: 150, maxWidth: 1600, maxHeight: 1200 });
    const result = await getProvider(ctx.selection.provider).complete({
      selection: ctx.selection,
      credentials: ctx.credentials,
      signal: ctx.signal,
      system: JUDGE_SYSTEM_PROMPT,
      prompt: judgePrompt(input.prompt),
      images: [{ mimeType: "image/png", base64: png.toString("base64") }],
      maxOutputTokens: 2000,
      temperature: 0.1,
      timeoutMs: options.timeoutMs ?? 180_000,
    });
    const parsed = parseLlmJson(result.text, JudgmentSchema);
    if (!parsed.ok) return { status: "unreviewed", reason: `unreadable judgment: ${parsed.error}` };
    return { status: "scored", judgment: parsed.data, usage: result.usage };
  } catch (err) {
    // Stopping the run is not a judge failure.
    if (ctx.signal?.aborted) throw err;
    return { status: "unreviewed", reason: err instanceof Error ? err.message : String(err) };
  }
}
