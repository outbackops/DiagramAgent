import { describe, it, expect } from "vitest";
import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("returns the message of an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a TypeError's message", () => {
    expect(errorMessage(new TypeError("nope"))).toBe("nope");
  });

  it("returns a string thrown directly", () => {
    expect(errorMessage("oops")).toBe("oops");
  });

  it("returns a plain object's .message field if it's a string", () => {
    expect(errorMessage({ message: "from object" })).toBe("from object");
  });

  it("falls back to JSON.stringify for plain objects without a message", () => {
    expect(errorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it("handles null and undefined as strings", () => {
    expect(errorMessage(null)).toBe("null");
    // undefined cannot be JSON-stringified — helper falls through to String().
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("survives circular objects via the String() fallback", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a; // circular
    const out = errorMessage(a);
    // JSON.stringify throws on circular → catch → String(a) → "[object Object]"
    expect(out).toBe("[object Object]");
  });

  it("returns numbers and booleans via JSON.stringify", () => {
    expect(errorMessage(123)).toBe("123");
    expect(errorMessage(true)).toBe("true");
  });
});
