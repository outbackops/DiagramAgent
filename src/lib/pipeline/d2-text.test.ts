import { describe, it, expect } from "vitest";
import { buildGenerationConversation, cleanD2Output, composeGenerationPrompt } from "./d2-text";

describe("cleanD2Output", () => {
  it.each([
    ["direction: right\na -> b", "direction: right\na -> b"],
    ["```d2\na -> b\n```", "a -> b"],
    ["```\na -> b\n```", "a -> b"],
    ["Here is your diagram:\n\n```d2\na -> b\n```\nLet me know!", "a -> b"],
    ["```d2\na -> b\nc -> d", "a -> b\nc -> d"],
    ["a -> b\n```", "a -> b"],
    ["```d", ""],
    ["```d2\r\na -> b\r\n```", "a -> b"],
  ])("cleans %j", (raw, expected) => {
    expect(cleanD2Output(raw)).toBe(expected);
  });
});

describe("composeGenerationPrompt", () => {
  it("returns the prompt untouched without a plan", () => {
    expect(composeGenerationPrompt("draw it", null)).toBe("draw it");
  });

  it("prefixes the plan and a deterministic scaffold", () => {
    const out = composeGenerationPrompt("draw it", {
      components: [{ name: "Web", container: "Cloud" }, { name: "DB", container: "Cloud" }],
      connections: [{ from: "Cloud.Web", to: "Cloud.DB", label: "SQL" }],
    });
    expect(out.startsWith("ARCHITECTURE PLAN:\n{")).toBe(true);
    expect(out).toContain("D2 SCAFFOLD");
    expect(out.endsWith("USER REQUEST:\ndraw it")).toBe(true);
  });

  it("omits the scaffold when the plan has no components", () => {
    const out = composeGenerationPrompt("draw it", { pattern: "x" });
    expect(out).not.toContain("D2 SCAFFOLD");
    expect(out).toContain('"pattern": "x"');
  });
});

describe("buildGenerationConversation", () => {
  it("passes a fresh prompt through with history", () => {
    expect(buildGenerationConversation({ prompt: "p", history: [{ role: "user", content: "h" }] })).toEqual({
      prompt: "p",
      history: [{ role: "user", content: "h" }],
    });
  });

  it("replays existing code as the assistant turn for edits", () => {
    const out = buildGenerationConversation({ prompt: "add cache", existingCode: "a -> b" });
    expect(out.history).toEqual([{ role: "assistant", content: "a -> b" }]);
    expect(out.prompt).toBe("Modify the above D2 diagram based on this request: add cache. Output the COMPLETE updated D2 code.");
  });

  it("drops empty history turns", () => {
    expect(buildGenerationConversation({ prompt: "p", history: [{ role: "assistant", content: "  " }] }).history).toEqual([]);
  });
});
