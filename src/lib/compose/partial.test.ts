import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeText } from "./index";
import { completePartialJson } from "./partial";

describe("completePartialJson", () => {
  it("returns null before an object starts", () => {
    expect(completePartialJson("")).toBeNull();
    expect(completePartialJson("```json\n")).toBeNull();
  });

  it("closes open containers and drops half-written values, keys and separators", () => {
    expect(JSON.parse(completePartialJson('{"title": "Orders", "columns": [{"title": "Cal')!)).toEqual({ title: "Orders", columns: [{}] });
    expect(JSON.parse(completePartialJson('{"title": "Orders", "subt')!)).toEqual({ title: "Orders" });
    expect(JSON.parse(completePartialJson('{"title": "Orders", "count": 12')!)).toEqual({ title: "Orders" });
    expect(JSON.parse(completePartialJson('{"a": [1, 2, ')!)).toEqual({ a: [1, 2] });
    expect(JSON.parse(completePartialJson('{"a": {"b": "c\\"d')!)).toEqual({ a: {} });
  });

  it("ignores prose and fences before the object and stops at its end", () => {
    expect(JSON.parse(completePartialJson('Here you go:\n```json\n{"title": "x"}\n```\nmore')!)).toEqual({ title: "x" });
  });

  it("lets a streaming spec compose at every prefix without throwing unexpectedly", () => {
    const text = readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", "compositions", "knowledge-assistant.json"), "utf8");
    let composed = 0;
    for (let end = 40; end <= text.length; end += 97) {
      const partial = completePartialJson(text.slice(0, end));
      if (!partial) continue;
      expect(() => JSON.parse(partial)).not.toThrow();
      try {
        composeText(partial);
        composed++;
      } catch (err) {
        expect((err as Error).name).toBe("SpecError");
      }
    }
    expect(composed).toBeGreaterThan(10);
  });
});
