import { describe, expect, it } from "vitest";
import { ELLIPSIS, fitLine, measureText, wrapText } from "./text";
import type { TextStyle } from "./theme";

const body: TextStyle = { size: 13, weight: 400 };

describe("text fitting", () => {
  it("wraps on words and splits only words wider than a line", () => {
    const wrapped = wrapText("Ingest events from devices", 120, body);
    expect(wrapped).toMatchObject({ truncated: false, broken: false });
    expect(wrapped.lines.join(" ")).toBe("Ingest events from devices");
    expect(wrapped.lines.every((line) => measureText(line, body) <= 120)).toBe(true);

    const url = wrapText("https://example.com/a/very/long/path/without/any/spaces", 120, body);
    expect(url.broken).toBe(true);
    expect(url.lines.join("")).toBe("https://example.com/a/very/long/path/without/any/spaces");
    expect(url.lines.every((line) => measureText(line, body) <= 120)).toBe(true);
  });

  it("ellipsises beyond maxLines and on a single line", () => {
    const wrapped = wrapText("one two three four five six seven eight nine ten", 60, body, 2);
    expect(wrapped.lines).toHaveLength(2);
    expect(wrapped.truncated).toBe(true);
    expect(wrapped.lines[1].endsWith(ELLIPSIS)).toBe(true);

    const line = fitLine("A title that is far too long for its box", 80, body);
    expect(line.truncated).toBe(true);
    expect(line.text.endsWith(ELLIPSIS)).toBe(true);
    expect(measureText(line.text, body)).toBeLessThanOrEqual(80);
    expect(fitLine("Short", 80, body)).toEqual({ text: "Short", truncated: false });
  });

  it("stays linear on very long input", () => {
    const word = "x".repeat(20_000);
    const prose = Array.from({ length: 4_000 }, (_, i) => `word${i}`).join(" ");
    const started = performance.now();
    const line = fitLine(word, 200, body);
    const clipped = wrapText(prose, 200, body, 3);
    const split = wrapText(word, 200, body);
    const elapsed = performance.now() - started;

    expect(line.truncated).toBe(true);
    expect(clipped).toMatchObject({ truncated: true });
    expect(clipped.lines).toHaveLength(3);
    expect(split.broken).toBe(true);
    expect(split.lines.join("")).toBe(word);
    // Quadratic prefix measuring took seconds at this size; linear takes a few ms.
    expect(elapsed).toBeLessThan(1_500);
  });
});
