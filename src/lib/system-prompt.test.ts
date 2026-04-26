import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt";

/**
 * The system prompt is the contract between this app and every Azure model
 * we use. Drift here silently breaks generation quality (wrong layout, wrong
 * class names, missing icon hints). These tests don't snapshot the whole
 * thing — they assert the load-bearing rules so an editor sees the failure
 * the moment they break one.
 */
describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("returns a non-trivial string", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it("starts with the agent role line", () => {
    expect(prompt.startsWith("You are an Enterprise Architecture Diagram Generator")).toBe(true);
  });

  it("locks the output rule: raw D2 only, no markdown / fences / commentary", () => {
    expect(prompt).toMatch(/Output ONLY raw, valid D2 code/);
    expect(prompt).toMatch(/No markdown, no code fences, no explanations/);
  });

  it("requires direction: right and a classes block", () => {
    expect(prompt).toContain("direction: right");
    expect(prompt).toContain("classes: {");
  });

  it("declares the canonical class names used by parseD2 / d2-to-drawio", () => {
    // Class names form the contract between LLM output and the exporters.
    // Removing one will break colour/styling in exports.
    for (const cls of [
      "subscription",
      "resource_group",
      "region",
      "network",
      "subnet",
      "resource",
    ]) {
      expect(prompt).toContain(`${cls}: {`);
    }
  });

  it("enforces horizontal/zoned layout (entry-left, compute-center)", () => {
    // Set in the layout-rules pass (TODO #13).
    expect(prompt).toMatch(/ZONE-ENTRY/);
    expect(prompt).toMatch(/ZONE-COMPUTE/);
    expect(prompt).toMatch(/leftmost/i);
  });

  it("references provider-specific icon naming (aws-*, azure-*, gcp-*)", () => {
    // Hyphenated icon-key form actually used in this repo's icon registry.
    expect(prompt).toMatch(/aws-[a-z0-9_-]+|azure-[a-z0-9_-]+|gcp-[a-z0-9_-]+/);
  });

  it("forbids splitting output into multiple blocks", () => {
    expect(prompt).toMatch(/exactly ONE unified diagram/i);
  });
});
