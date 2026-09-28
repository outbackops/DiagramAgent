import { getProvider } from "@/lib/llm";
import { LlmError } from "@/lib/llm/errors";
import type { ChatTurn, LlmCredentials, LlmUsage, ModelSelection } from "@/lib/llm/types";
import {
  ASSESS_PASS_THRESHOLD,
  AssessmentSchema,
  ClarifyResponseSchema,
  PlanSchema,
  parseLlmJson,
  type Assessment,
} from "@/lib/llm-schemas";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { svgToPng } from "@/lib/svg-raster";
import { buildGenerationConversation, cleanD2Output } from "./d2-text";
import { ASSESSMENT_SYSTEM_PROMPT, CLARIFY_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT } from "./prompts";

/**
 * The four model-backed pipeline steps. API routes and the eval harness both
 * call these, so what the eval measures is exactly what the app runs.
 */

export interface StepContext {
  selection: ModelSelection;
  credentials: LlmCredentials;
  signal?: AbortSignal;
}

export interface ClarifyQuestionOut {
  id: string;
  question: string;
  rationale?: string | null;
  type: "single" | "multi";
  options: { label: string; value: string }[];
}

export interface ClarifyResult {
  questions: ClarifyQuestionOut[];
  analysis: unknown;
  skipClarification: boolean;
  usage?: LlmUsage;
}

export async function runClarify(prompt: string, ctx: StepContext): Promise<ClarifyResult> {
  const result = await getProvider(ctx.selection.provider).complete({
    selection: ctx.selection,
    credentials: ctx.credentials,
    signal: ctx.signal,
    system: CLARIFY_SYSTEM_PROMPT,
    prompt: `Generate clarifying questions for this diagram request: "${prompt}"`,
    maxOutputTokens: 4000,
    timeoutMs: 120_000,
  });
  const parsed = parseLlmJson(result.text, ClarifyResponseSchema);
  if (!parsed.ok) {
    console.error("Clarify output did not parse:", parsed.error);
    throw new LlmError("invalid_output", "Failed to generate questions — the model reply was not valid JSON.");
  }
  const questions = parsed.data.questions
    .filter((q) => q.options.length > 0)
    .map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));
  return {
    questions,
    analysis: parsed.data.analysis ?? null,
    skipClarification: parsed.data.skipClarification,
    usage: result.usage,
  };
}

export async function runPlan(
  prompt: string,
  analysis: unknown,
  ctx: StepContext,
): Promise<{ plan: Record<string, unknown>; usage?: LlmUsage }> {
  const request = `Create an architecture plan for this diagram request:\n\n"${prompt}"`;
  const result = await getProvider(ctx.selection.provider).complete({
    selection: ctx.selection,
    credentials: ctx.credentials,
    signal: ctx.signal,
    system: PLAN_SYSTEM_PROMPT,
    prompt: analysis ? `${request}\n\nExpert analysis context:\n${JSON.stringify(analysis, null, 2)}` : request,
    maxOutputTokens: 8000,
    temperature: 0.2,
    timeoutMs: 240_000,
  });
  const parsed = parseLlmJson(result.text, PlanSchema);
  if (!parsed.ok) {
    console.error("Plan output did not parse:", parsed.error);
    throw new LlmError("invalid_output", "Failed to generate architecture plan — the model reply was not valid JSON.");
  }
  return { plan: parsed.data, usage: result.usage };
}

export interface GenerateInput {
  prompt: string;
  existingCode?: string;
  history?: ChatTurn[];
}

export async function runGenerate(
  input: GenerateInput,
  ctx: StepContext,
  onDelta: (chunk: string) => void = () => {},
): Promise<{ code: string; raw: string; usage?: LlmUsage }> {
  const conversation = buildGenerationConversation(input);
  const result = await getProvider(ctx.selection.provider).stream(
    {
      selection: ctx.selection,
      credentials: ctx.credentials,
      signal: ctx.signal,
      system: buildSystemPrompt(),
      prompt: conversation.prompt,
      history: conversation.history,
      temperature: 0.3,
      timeoutMs: 270_000,
    },
    onDelta,
  );
  return { code: cleanD2Output(result.text), raw: result.text, usage: result.usage };
}

export type AssessmentResult = Assessment & { raw?: string; parse_error?: string };

export async function runAssess(
  input: { svg: string; prompt: string; d2Code?: string },
  ctx: StepContext,
): Promise<{ assessment: AssessmentResult; usage?: LlmUsage }> {
  let png: Buffer;
  try {
    png = await svgToPng(input.svg, { density: 150, maxWidth: 1600, maxHeight: 1200 });
  } catch (err) {
    throw new LlmError("invalid_output", `Failed to convert SVG to PNG: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = await getProvider(ctx.selection.provider).complete({
    selection: ctx.selection,
    credentials: ctx.credentials,
    signal: ctx.signal,
    system: ASSESSMENT_SYSTEM_PROMPT,
    prompt: `Original prompt: "${input.prompt}"\n\nCurrent D2 code:\n\`\`\`\n${input.d2Code ?? ""}\n\`\`\`\n\nAssess the rendered diagram image attached. Focus on structural accuracy and layout quality relative to the original request.`,
    images: [{ mimeType: "image/png", base64: png.toString("base64") }],
    maxOutputTokens: 4000,
    temperature: 0.2,
    timeoutMs: 180_000,
  });

  const parsed = parseLlmJson(result.text, AssessmentSchema);
  if (!parsed.ok) {
    console.error("Assessment output did not parse:", parsed.error);
    return {
      usage: result.usage,
      assessment: {
        score: 5,
        pass: 5 >= ASSESS_PASS_THRESHOLD,
        reasoning: "Could not parse assessment response",
        missing_components: [],
        layout_issues: ["Assessment JSON parsing failed"],
        specific_fixes: ["Re-generate the diagram"],
        raw: result.text,
        parse_error: parsed.error,
      },
    };
  }
  return { assessment: parsed.data, usage: result.usage };
}
