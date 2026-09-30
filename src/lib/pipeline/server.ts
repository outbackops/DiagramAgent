import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
import {
  ARCH_ASSESSMENT_ADDENDUM,
  archEditPrompt,
  buildArchitectSystemPrompt,
  cleanArchOutput,
} from "@/lib/arch/prompt";
import {
  buildComposerSystemPrompt,
  cleanSpecOutput,
  composeEditPrompt,
  COMPOSED_ASSESSMENT_ADDENDUM,
} from "@/lib/compose/prompt";
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

type DiagramFormat = "d2" | "composition" | "architecture";

function readVendoredIconKeys(): string[] | undefined {
  try {
    const manifestPath = path.join(process.cwd(), "public", "icons", "manifest.json");
    if (!existsSync(manifestPath)) return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const keys = Object.keys(manifest);
    return keys.length > 0 ? keys : undefined;
  } catch {
    return undefined;
  }
}

function buildCompositionConversation(input: GenerateInput): { prompt: string; history: ChatTurn[] } {
  const history = (input.history ?? []).filter((turn) => turn.content.trim().length > 0);
  if (!input.existingCode?.trim()) return { prompt: input.prompt, history };
  return {
    prompt: composeEditPrompt(input.prompt),
    history: [...history, { role: "assistant", content: input.existingCode }],
  };
}

function buildArchitectureConversation(input: GenerateInput): { prompt: string; history: ChatTurn[] } {
  const history = (input.history ?? []).filter((turn) => turn.content.trim().length > 0);
  if (!input.existingCode?.trim()) return { prompt: input.prompt, history };
  return {
    prompt: archEditPrompt(input.prompt),
    history: [...history, { role: "assistant", content: input.existingCode }],
  };
}

export async function runGenerate(
  input: GenerateInput,
  ctx: StepContext,
  onDelta: (chunk: string) => void = () => {},
  options: { format?: DiagramFormat } = {},
): Promise<{ code: string; raw: string; usage?: LlmUsage }> {
  const format = options.format ?? "d2";
  const conversation =
    format === "composition"
      ? buildCompositionConversation(input)
      : format === "architecture"
        ? buildArchitectureConversation(input)
        : buildGenerationConversation(input);
  const system =
    format === "composition"
      ? buildComposerSystemPrompt(readVendoredIconKeys())
      : format === "architecture"
        ? buildArchitectSystemPrompt(readVendoredIconKeys())
        : buildSystemPrompt();
  const result = await getProvider(ctx.selection.provider).stream(
    {
      selection: ctx.selection,
      credentials: ctx.credentials,
      signal: ctx.signal,
      system,
      prompt: conversation.prompt,
      history: conversation.history,
      temperature: 0.3,
      timeoutMs: 270_000,
    },
    onDelta,
  );
  const code = format === "composition" ? cleanSpecOutput(result.text) : format === "architecture" ? cleanArchOutput(result.text) : cleanD2Output(result.text);
  return { code, raw: result.text, usage: result.usage };
}

export type AssessmentResult = Assessment & { raw?: string; parse_error?: string };

export async function runAssess(
  input: { svg: string; prompt: string; d2Code?: string; format?: DiagramFormat },
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
    system: `${ASSESSMENT_SYSTEM_PROMPT}${
      input.format === "composition" ? COMPOSED_ASSESSMENT_ADDENDUM : input.format === "architecture" ? ARCH_ASSESSMENT_ADDENDUM : ""
    }`,
    prompt: `Original prompt: "${input.prompt}"

Current ${input.format === "composition" || input.format === "architecture" ? "diagram spec (JSON)" : "D2 code"}:
\`\`\`
${input.d2Code ?? ""}
\`\`\`

Assess the rendered diagram image attached. Focus on structural accuracy and layout quality relative to the original request.`,
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
