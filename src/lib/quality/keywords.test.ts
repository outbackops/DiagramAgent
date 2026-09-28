import { describe, expect, it } from "vitest";
import { calculateKeywordCoverage, matchesKeyword } from "./keywords";

describe("keyword coverage", () => {
  it("matches case-insensitive words and punctuation-normalized phrases", () => {
    expect(matchesKeyword("Azure SQL Always-On listener", "sql always on")).toBe(true);
    expect(matchesKeyword("CloudFront -> ALB", "cloudfront")).toBe(true);
  });

  it("supports alternatives for one expected concept", () => {
    expect(matchesKeyword("Amazon EventBridge bus", ["event bus", "eventbridge"])).toBe(true);
    expect(matchesKeyword("Amazon EventBridge bus", ["pubsub", "pub/sub"])).toBe(false);
  });

  it("returns coverage and missing expectations", () => {
    const coverage = calculateKeywordCoverage("API Gateway invokes Lambda then writes DynamoDB", [
      "api gateway",
      "lambda",
      ["queue", "sqs"],
      "dynamodb",
    ]);

    expect(coverage).toMatchObject({ total: 4, matched: 3, ratio: 0.75, missing: [["queue", "sqs"]] });
  });
});
