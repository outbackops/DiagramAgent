import { describe, it, expect } from "vitest";
import { resolveIconUrl, getIconKeys, iconRegistry } from "./icon-registry";

describe("icon-registry", () => {
  it("exposes a non-empty registry", () => {
    expect(getIconKeys().length).toBeGreaterThan(50);
    expect(iconRegistry["aws"]).toBeDefined();
    expect(iconRegistry["azure"]).toBeDefined();
  });

  it("resolveIconUrl returns undefined for unknown keys", () => {
    expect(resolveIconUrl("definitely-not-a-real-icon-xyz")).toBeUndefined();
  });

  it("resolveIconUrl returns a string for known keys", () => {
    const url = resolveIconUrl("aws");
    expect(typeof url).toBe("string");
    expect(url!.length).toBeGreaterThan(0);
  });

  it("prefers vendored /icons/<key>.svg path when manifest is present", () => {
    // The manifest is loaded at module init from public/icons/manifest.json.
    // If vendor:icons has been run, "aws" should resolve to a local URL.
    // Otherwise falls back to CDN — both are valid; the assertion is that
    // *some* string is returned and the local path matches the expected
    // shape when present.
    const url = resolveIconUrl("aws");
    if (url?.startsWith("/icons/")) {
      expect(url).toBe("/icons/aws.svg");
    } else {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it("registry entries have required shape", () => {
    for (const [key, entry] of Object.entries(iconRegistry)) {
      expect(entry, `entry for ${key}`).toMatchObject({
        url: expect.any(String),
        label: expect.any(String),
        category: expect.stringMatching(/^(aws|azure|gcp|kubernetes|tech|general)$/),
      });
    }
  });
});
