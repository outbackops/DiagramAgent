import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getModelByRole, VISION_MODEL_ID, AVAILABLE_MODELS } from "./models";

describe("getModelByRole", () => {
  const ENV_KEYS = ["MODEL_GENERATOR", "MODEL_CLARIFIER", "MODEL_PLANNER", "MODEL_JUDGE"];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("returns gpt-4o for the judge role by default (vision-capable)", () => {
    const m = getModelByRole("judge");
    expect(m.id).toBe("gpt-4o");
    expect(m.supportsVision).toBe(true);
  });

  it("returns gpt-5.2-chat for generator/clarifier/planner roles by default", () => {
    expect(getModelByRole("generator").id).toBe("gpt-5.2-chat");
    expect(getModelByRole("clarifier").id).toBe("gpt-5.2-chat");
    expect(getModelByRole("planner").id).toBe("gpt-5.2-chat");
  });

  it("honours env override when value is a known model id", () => {
    process.env.MODEL_GENERATOR = "gpt-5";
    expect(getModelByRole("generator").id).toBe("gpt-5");
  });

  it("falls back to default and warns when env value is unknown", () => {
    process.env.MODEL_PLANNER = "fake-model-xyz";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = getModelByRole("planner");
    expect(m.id).toBe("gpt-5.2-chat");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("VISION_MODEL_ID export equals the judge default id", () => {
    expect(VISION_MODEL_ID).toBe("gpt-4o");
  });

  it("all role defaults exist in AVAILABLE_MODELS", () => {
    const ids = AVAILABLE_MODELS.map((m) => m.id);
    expect(ids).toContain("gpt-5.2-chat");
    expect(ids).toContain("gpt-4o");
  });
});
