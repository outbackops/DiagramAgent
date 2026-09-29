import { describe, expect, it } from "vitest";
import { formatOfCode } from "./spec-format";

describe("formatOfCode", () => {
  it("tells Architecture specs, Poster specs and D2 apart", () => {
    expect(formatOfCode('{"title":"T","items":[{"id":"a","name":"A"}],"connections":[]}')).toBe("architecture");
    expect(formatOfCode('```json\n{"title":"T","platform":"azure","items":[{"name":"A"}]}\n```')).toBe("architecture");
    expect(formatOfCode('{"title":"T","columns":[{"title":"C","items":["A"]}]}')).toBe("composition");
    expect(formatOfCode("a -> b")).toBe("d2");
  });

  it("reads a spec that is still streaming in", () => {
    expect(formatOfCode('{"title":"T","items":[{"id":"a","name":"A"}],"connections":[{"from":"a"')).toBe("architecture");
    expect(formatOfCode('{"title":"T","columns":[{"title":"C","items":["A"')).toBe("composition");
  });
});
