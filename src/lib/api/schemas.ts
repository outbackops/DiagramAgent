import { z } from "zod";
import { LlmError } from "@/lib/llm/errors";
import { coerceSelection } from "@/lib/llm/selection";
import type { ModelSelection } from "@/lib/llm/types";

/** Request-body schemas for the model-backed routes. Limits keep payloads (and model spend) bounded. */

const required = (field: string) => ({ error: `${field} is required` });

const prompt = (max: number) =>
  z
    .string(required("Prompt"))
    .trim()
    .min(1, "Prompt is required")
    .max(max, `Prompt is too long (${max.toLocaleString("en-US")} characters max)`);

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});

/** Anything JSON-ish, capped by serialized size. */
const boundedJson = z.unknown().refine((v) => v === undefined || JSON.stringify(v).length <= 100_000, "Payload too large");

export const ClarifyBody = z.object({
  prompt: prompt(20_000),
  model: z.unknown().optional(),
});

export const PlanBody = z.object({
  prompt: prompt(60_000),
  analysis: boundedJson.optional(),
  model: z.unknown().optional(),
});

export const GenerateBody = z.object({
  prompt: prompt(80_000),
  existingCode: z.string().max(200_000, "Diagram code is too large").optional().default(""),
  history: z.array(turn).max(40).optional().default([]),
  model: z.unknown().optional(),
});

export const AssessBody = z.object({
  svg: z.string(required("SVG")).min(1, "SVG is required").max(8_000_000, "SVG is too large"),
  prompt: prompt(80_000),
  d2Code: z.string().max(200_000).optional().default(""),
  model: z.unknown().optional(),
});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new LlmError("bad_request", result.error.issues[0]?.message ?? "Invalid request");
  }
  return result.data;
}

/** `model` is optional; when present it must be a well-formed selection. */
export function parseSelectionField(value: unknown): ModelSelection | null {
  if (value === undefined || value === null) return null;
  const selection = coerceSelection(value);
  if (!selection) throw new LlmError("bad_request", "Invalid model selection");
  return selection;
}
