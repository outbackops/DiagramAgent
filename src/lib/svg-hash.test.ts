import { describe, it, expect } from "vitest";
import { hashSvg } from "./svg-hash";

describe("hashSvg", () => {
  it("returns the same hash for identical strings", () => {
    const a = '<svg width="100"><rect x="0"/></svg>';
    const b = '<svg width="100"><rect x="0"/></svg>';
    expect(hashSvg(a)).toBe(hashSvg(b));
  });

  it("returns different hashes for different strings", () => {
    const a = '<svg width="100"><rect x="0"/></svg>';
    const b = '<svg width="101"><rect x="0"/></svg>';
    expect(hashSvg(a)).not.toBe(hashSvg(b));
  });

  it("handles empty string", () => {
    expect(hashSvg("")).toBe("811c9dc5"); // FNV-1a 32 offset basis
  });

  it("returns a hex string", () => {
    const h = hashSvg("test");
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic across calls", () => {
    const s = "<svg>" + "a".repeat(10000) + "</svg>";
    expect(hashSvg(s)).toBe(hashSvg(s));
  });
});
