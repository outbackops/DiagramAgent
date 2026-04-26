import { z } from "zod";

// ---- Constants ----

/**
 * Server-side pass threshold for diagram assessment.
 * Computed from `score >= ASSESS_PASS_THRESHOLD`; do NOT trust the model's
 * self-reported `pass` field.
 */
export const ASSESS_PASS_THRESHOLD = 7;

// ---- Clarify ----

const ClarifyOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const ClarifyQuestionSchema = z.object({
  id: z.string().optional(),
  question: z.string().min(1),
  rationale: z.string().optional().nullable(),
  type: z.enum(["single", "multi"]).catch("single"),
  options: z
    .array(
      z
        .object({
          label: z.string().optional(),
          value: z.string().optional(),
        })
        .transform((o) => ({
          label: String(o.label ?? o.value ?? ""),
          value: String(o.value ?? o.label ?? ""),
        }))
    )
    .default([]),
});

export const ClarifyResponseSchema = z.union([
  // New object format
  z.object({
    analysis: z.string().nullable().optional(),
    skipClarification: z.boolean().optional().default(false),
    questions: z.array(ClarifyQuestionSchema).default([]),
  }),
  // Legacy array format
  z.array(ClarifyQuestionSchema).transform((arr) => ({
    analysis: null,
    skipClarification: false,
    questions: arr,
  })),
]);

export type ClarifyResponse = z.infer<typeof ClarifyResponseSchema>;

// ---- Plan ----

// The plan is a free-form JSON object; we just require it to be a non-null object
// (not an array, not a primitive). Refinement will tighten this in Item 5.
export const PlanSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => v !== null && !Array.isArray(v), {
    message: "Plan must be a JSON object",
  });

export type Plan = z.infer<typeof PlanSchema>;

// ---- Assess ----

const AssessmentRawSchema = z.object({
  score: z.number().min(0).max(10),
  reasoning: z.string().optional().default(""),
  missing_components: z.array(z.string()).optional().default([]),
  layout_issues: z.array(z.string()).optional().default([]),
  specific_fixes: z.array(z.string()).optional().default([]),
  // The model may return `pass`; we ignore it and recompute server-side.
  pass: z.boolean().optional(),
  // Some models return `issues` instead of layout_issues — accept both.
  issues: z.array(z.string()).optional(),
});

export const AssessmentSchema = AssessmentRawSchema.transform((a) => ({
  score: a.score,
  /** Always recomputed server-side from `score >= ASSESS_PASS_THRESHOLD`. */
  pass: a.score >= ASSESS_PASS_THRESHOLD,
  reasoning: a.reasoning,
  missing_components: a.missing_components,
  layout_issues: a.layout_issues.length > 0 ? a.layout_issues : a.issues ?? [],
  specific_fixes: a.specific_fixes,
}));

export type Assessment = z.infer<typeof AssessmentSchema>;

// ---- Helpers ----

/**
 * Strip markdown code fences from a model's text response so the inner JSON
 * can be parsed. Handles both ```json and bare ``` fences.
 */
export function stripCodeFences(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

/**
 * Parse a model JSON response into a typed shape.
 * Returns `{ ok: true, data }` on success, `{ ok: false, error, raw }` on failure.
 * Does NOT throw — callers should branch on `result.ok`.
 */
export function parseLlmJson<T>(
  content: string,
  schema: z.ZodType<T>
): { ok: true; data: T } | { ok: false; error: string; raw: string } {
  const cleaned = stripCodeFences(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "JSON parse failed",
      raw: content,
    };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      raw: content,
    };
  }
  return { ok: true, data: result.data };
}
