import { describe, it, expect } from "vitest";
import { resolveAnswerSpecs } from "./clarify-utils";
import type { ClarifyQuestion, ClarifyAnswers } from "@/components/ClarifyPanel";

function makeQ(overrides: Partial<ClarifyQuestion> & { id: string; question: string }): ClarifyQuestion {
  return {
    type: "single",
    options: [],
    ...overrides,
  };
}

describe("resolveAnswerSpecs", () => {
  it("single-select with predefined option returns label", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({
        id: "q1",
        question: "Region preference",
        options: [
          { label: "US East", value: "us-east" },
          { label: "EU West", value: "eu-west" },
        ],
      }),
    ];
    const answers: ClarifyAnswers = { q1: "us-east" };
    expect(resolveAnswerSpecs(questions, answers)).toEqual(["Region preference: US East"]);
  });

  it("single-select with 'other: ...' surfaces freetext", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({
        id: "q1",
        question: "Region preference",
        options: [{ label: "US East", value: "us-east" }],
      }),
    ];
    const answers: ClarifyAnswers = { q1: "other: Sydney, AU" };
    expect(resolveAnswerSpecs(questions, answers)).toEqual([
      "Region preference: Other — Sydney, AU",
    ]);
  });

  it("multi-select with predefined options returns labels", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({
        id: "q1",
        question: "Cloud providers",
        type: "multi",
        options: [
          { label: "AWS", value: "aws" },
          { label: "GCP", value: "gcp" },
          { label: "Azure", value: "azure" },
        ],
      }),
    ];
    const answers: ClarifyAnswers = { q1: ["aws", "gcp"] };
    expect(resolveAnswerSpecs(questions, answers)).toEqual(["Cloud providers: AWS, GCP"]);
  });

  it("multi-select including 'other: ...' surfaces all including freetext", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({
        id: "q1",
        question: "Cloud providers",
        type: "multi",
        options: [
          { label: "AWS", value: "aws" },
          { label: "GCP", value: "gcp" },
        ],
      }),
    ];
    const answers: ClarifyAnswers = { q1: ["aws", "gcp", "other: DigitalOcean"] };
    const result = resolveAnswerSpecs(questions, answers);
    expect(result).toEqual(["Cloud providers: AWS, GCP, Other — DigitalOcean"]);
  });

  it("empty/missing answers are skipped", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({ id: "q1", question: "Region", options: [{ label: "US", value: "us" }] }),
      makeQ({ id: "q2", question: "Size", options: [{ label: "Small", value: "sm" }] }),
    ];
    const answers: ClarifyAnswers = { q2: "sm" };
    expect(resolveAnswerSpecs(questions, answers)).toEqual(["Size: Small"]);
  });

  it("other with no text after colon returns just 'Other'", () => {
    const questions: ClarifyQuestion[] = [
      makeQ({ id: "q1", question: "Region", options: [] }),
    ];
    const answers: ClarifyAnswers = { q1: "other:  " };
    expect(resolveAnswerSpecs(questions, answers)).toEqual(["Region: Other"]);
  });
});
