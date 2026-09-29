import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_SELECTION,
  coerceSelection,
  formatSelection,
  getDefaultSelection,
  parseSelectionString,
  pickDefaultSelection,
  validateSelection,
} from "./selection";
import { LlmError } from "./errors";
import type { CatalogModel } from "./types";

const opus: CatalogModel = {
  provider: "copilot",
  id: "claude-opus-5.5",
  name: "Claude Opus 5.5",
  vision: true,
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
};
const haiku: CatalogModel = { provider: "copilot", id: "claude-haiku-4.5", name: "Claude Haiku 4.5", vision: true, reasoningEfforts: [] };
const gpt55: CatalogModel = {
  provider: "copilot",
  id: "gpt-5.5",
  name: "GPT-5.5",
  vision: true,
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
};
const azure4o: CatalogModel = { provider: "azure", id: "gpt-4o", name: "GPT-4o", vision: true, reasoningEfforts: [] };

describe("default selection", () => {
  afterEach(() => {
    delete process.env.DIAGRAM_AGENT_DEFAULT_MODEL;
  });

  it("defaults to Claude Opus 5.5 at medium reasoning on Copilot", () => {
    expect(DEFAULT_SELECTION).toEqual({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" });
    expect(getDefaultSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("honours DIAGRAM_AGENT_DEFAULT_MODEL", () => {
    process.env.DIAGRAM_AGENT_DEFAULT_MODEL = "copilot:gpt-5.5@high";
    expect(getDefaultSelection()).toEqual({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "high" });
  });

  it("warns and falls back when DIAGRAM_AGENT_DEFAULT_MODEL is malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DIAGRAM_AGENT_DEFAULT_MODEL = "bogus:model@ultra";
    expect(getDefaultSelection()).toEqual(DEFAULT_SELECTION);
    warn.mockRestore();
  });
});

describe("parseSelectionString", () => {
  it.each([
    ["copilot:claude-opus-5.5@medium", { provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" }],
    ["azure:gpt-4o", { provider: "azure", model: "gpt-4o" }],
    ["gpt-5.5@high", { provider: "copilot", model: "gpt-5.5", reasoningEffort: "high" }],
    ["claude-sonnet-5", { provider: "copilot", model: "claude-sonnet-5" }],
  ])("parses %s", (input, expected) => {
    expect(parseSelectionString(input)).toEqual(expected);
  });

  it.each(["", "  ", "openai:gpt-4o", "copilot:gpt@turbo", "copilot:bad model"])("rejects %j", (input) => {
    expect(parseSelectionString(input)).toBeNull();
  });

  it("round-trips through formatSelection", () => {
    const s = { provider: "copilot" as const, model: "claude-opus-5.5", reasoningEffort: "medium" as const };
    expect(parseSelectionString(formatSelection(s))).toEqual(s);
  });
});

describe("coerceSelection", () => {
  it("accepts a well-formed selection", () => {
    expect(coerceSelection({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "low" })).toEqual({
      provider: "copilot",
      model: "gpt-5.5",
      reasoningEffort: "low",
    });
  });

  it.each([
    null,
    "copilot:gpt-5.5",
    { provider: "openai", model: "gpt-5.5" },
    { provider: "copilot", model: "" },
    { provider: "copilot", model: "a b" },
    { provider: "copilot", model: "gpt-5.5", reasoningEffort: "turbo" },
  ])("rejects %j", (input) => {
    expect(coerceSelection(input)).toBeNull();
  });
});

describe("validateSelection", () => {
  it("rejects models that are not in the caller's catalog", () => {
    expect(() => validateSelection({ provider: "copilot", model: "not-a-model" }, [opus])).toThrow(LlmError);
  });

  it("does not match a model id across providers", () => {
    expect(() => validateSelection({ provider: "azure", model: "claude-opus-5.5" }, [opus])).toThrow(/not available/);
  });

  it("keeps a supported reasoning effort", () => {
    expect(validateSelection({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "max" }, [opus])).toEqual({
      provider: "copilot",
      model: "claude-opus-5.5",
      reasoningEffort: "max",
    });
  });

  it("replaces an unsupported effort with medium when available", () => {
    expect(validateSelection({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "none" }, [opus]).reasoningEffort).toBe(
      "medium",
    );
  });

  it("drops the effort for models without reasoning controls", () => {
    expect(validateSelection({ provider: "copilot", model: "claude-haiku-4.5", reasoningEffort: "high" }, [haiku])).toEqual({
      provider: "copilot",
      model: "claude-haiku-4.5",
    });
  });
});

describe("pickDefaultSelection", () => {
  it("returns null for an empty catalog", () => {
    expect(pickDefaultSelection([])).toBeNull();
  });

  it("prefers Claude Opus 5.5 @ medium when available", () => {
    expect(pickDefaultSelection([gpt55, opus, haiku])).toEqual(DEFAULT_SELECTION);
  });

  it("walks the preference list when the default is missing", () => {
    expect(pickDefaultSelection([haiku, gpt55])).toEqual({ provider: "copilot", model: "gpt-5.5", reasoningEffort: "medium" });
  });

  it("falls back to the first model when nothing preferred exists", () => {
    expect(pickDefaultSelection([azure4o], { provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" })).toEqual({
      provider: "azure",
      model: "gpt-4o",
    });
  });
});
