import { describe, it, expect } from "vitest";
import {
  ClarifyResponseSchema,
  PlanSchema,
  AssessmentSchema,
  parseLlmJson,
  stripCodeFences,
  ASSESS_PASS_THRESHOLD,
} from "./llm-schemas";

describe("stripCodeFences", () => {
  it("strips ```json fences", () => {
    expect(stripCodeFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("strips ``` fences", () => {
    expect(stripCodeFences("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("leaves bare JSON alone", () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe("ClarifyResponseSchema", () => {
  it("accepts new object format", () => {
    const r = parseLlmJson(
      JSON.stringify({
        analysis: "high level",
        skipClarification: false,
        questions: [
          { id: "q1", question: "Region?", type: "single", options: [{ label: "US", value: "us" }] },
        ],
      }),
      ClarifyResponseSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.questions).toHaveLength(1);
      expect(r.data.questions[0].type).toBe("single");
    }
  });

  it("accepts legacy array format and normalises", () => {
    const r = parseLlmJson(
      JSON.stringify([{ question: "Q?", type: "multi", options: [{ label: "A", value: "a" }] }]),
      ClarifyResponseSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.analysis).toBeNull();
      expect(r.data.skipClarification).toBe(false);
      expect(r.data.questions[0].type).toBe("multi");
    }
  });

  it("coerces unknown question type to 'single'", () => {
    const r = parseLlmJson(
      JSON.stringify({
        questions: [{ question: "Q?", type: "freetext", options: [] }],
      }),
      ClarifyResponseSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.questions[0].type).toBe("single");
  });

  it("rejects malformed JSON", () => {
    const r = parseLlmJson("not json", ClarifyResponseSchema);
    expect(r.ok).toBe(false);
  });

  it("rejects missing question text", () => {
    const r = parseLlmJson(
      JSON.stringify({ questions: [{ type: "single", options: [] }] }),
      ClarifyResponseSchema
    );
    expect(r.ok).toBe(false);
  });

  it("strips fences before parsing", () => {
    const r = parseLlmJson(
      "```json\n{\"questions\":[]}\n```",
      ClarifyResponseSchema
    );
    expect(r.ok).toBe(true);
  });
});

describe("PlanSchema", () => {
  it("accepts arbitrary plan objects", () => {
    const r = parseLlmJson(
      JSON.stringify({ hierarchy: { vpc: { subnets: ["a", "b"] } } }),
      PlanSchema
    );
    expect(r.ok).toBe(true);
  });

  it("rejects arrays at the top level", () => {
    const r = parseLlmJson(JSON.stringify([1, 2, 3]), PlanSchema);
    expect(r.ok).toBe(false);
  });

  it("rejects primitives", () => {
    const r = parseLlmJson("42", PlanSchema);
    expect(r.ok).toBe(false);
  });
});

describe("AssessmentSchema (server-side pass rule)", () => {
  it("recomputes pass = score >= 7 (overrides model's pass)", () => {
    const r = parseLlmJson(
      JSON.stringify({ score: 6, pass: true, reasoning: "model lied" }),
      AssessmentSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pass).toBe(false); // 6 < 7
  });

  it("score=7 → pass true; score=6 → pass false (boundary)", () => {
    const a = parseLlmJson(JSON.stringify({ score: 7 }), AssessmentSchema);
    const b = parseLlmJson(JSON.stringify({ score: 6 }), AssessmentSchema);
    if (a.ok) expect(a.data.pass).toBe(true);
    if (b.ok) expect(b.data.pass).toBe(false);
    expect(ASSESS_PASS_THRESHOLD).toBe(7);
  });

  it("falls back to issues[] when layout_issues missing", () => {
    const r = parseLlmJson(
      JSON.stringify({ score: 5, issues: ["a", "b"] }),
      AssessmentSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.layout_issues).toEqual(["a", "b"]);
  });

  it("rejects score out of range", () => {
    const r = parseLlmJson(JSON.stringify({ score: 11 }), AssessmentSchema);
    expect(r.ok).toBe(false);
  });

  it("rejects missing score", () => {
    const r = parseLlmJson(JSON.stringify({ reasoning: "x" }), AssessmentSchema);
    expect(r.ok).toBe(false);
  });

  it("strips ```json fences", () => {
    const r = parseLlmJson(
      "```json\n{\"score\":8}\n```",
      AssessmentSchema
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pass).toBe(true);
  });
});

describe("parseLlmJson", () => {
  it("returns error envelope on bad JSON", () => {
    const r = parseLlmJson("definitely not json", PlanSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeTruthy();
      expect(r.raw).toBe("definitely not json");
    }
  });
});
