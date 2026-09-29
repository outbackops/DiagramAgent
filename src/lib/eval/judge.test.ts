import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/lib/llm", () => ({ getProvider: () => provider }));
vi.mock("@/lib/svg-raster", () => ({ svgToPng: async () => Buffer.from("png") }));

import { JUDGE_SYSTEM_PROMPT, judgePrompt, runJudge } from "./judge";

const ctx = { selection: { provider: "copilot" as const, model: "gpt-6-sol" }, credentials: { kind: "machine" as const } };

beforeEach(() => {
  provider.complete.mockReset();
});

describe("runJudge", () => {
  it("scores from the request and the image only — never the source", async () => {
    provider.complete.mockResolvedValue({ text: '{"score": 8, "reasoning": "Good", "missing": [], "invented_facts": ["10.0.0.0/16"]}' });
    const outcome = await runJudge({ svg: "<svg/>", prompt: "hub-and-spoke network" }, ctx);
    expect(outcome).toMatchObject({ status: "scored", judgment: { score: 8, invented_facts: ["10.0.0.0/16"], readability_issues: [] } });
    const request = provider.complete.mock.calls[0][0];
    expect(request.system).toBe(JUDGE_SYSTEM_PROMPT);
    expect(request.prompt).toBe(judgePrompt("hub-and-spoke network"));
    expect(request.images).toHaveLength(1);
  });

  it("marks a timeout or an unreadable answer unreviewed instead of scoring it", async () => {
    provider.complete.mockRejectedValueOnce(new Error("Request timed out after 180000 ms"));
    expect(await runJudge({ svg: "<svg/>", prompt: "p" }, ctx)).toEqual({ status: "unreviewed", reason: "Request timed out after 180000 ms" });
    provider.complete.mockResolvedValueOnce({ text: "I think it's quite good" });
    expect(await runJudge({ svg: "<svg/>", prompt: "p" }, ctx)).toMatchObject({ status: "unreviewed", reason: expect.stringContaining("unreadable") });
  });

  it("lets a stopped run stop instead of recording an unreviewed sample", async () => {
    const controller = new AbortController();
    controller.abort();
    provider.complete.mockImplementation(async () => {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    });
    const error = await runJudge({ svg: "<svg/>", prompt: "p" }, { ...ctx, signal: controller.signal }).catch((err: unknown) => err);
    expect((error as { name?: string }).name).toBe("AbortError");
  });
});
