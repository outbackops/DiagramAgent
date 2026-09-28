import { describe, it, expect, beforeEach, vi } from "vitest";
import { api, ApiError, safeFileName } from "./api";

function sseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split one frame across chunks to exercise buffering.
        for (const frame of frames) {
          const bytes = encoder.encode(frame);
          controller.enqueue(bytes.slice(0, 5));
          controller.enqueue(bytes.slice(5));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const selection = { provider: "copilot" as const, model: "claude-opus-5.5", reasoningEffort: "medium" as const };

describe("api.generate", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("streams deltas and returns usage and the model", async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        `data: ${JSON.stringify({ content: "a -> " })}\n\n`,
        `data: ${JSON.stringify({ content: "b" })}\n\n`,
        `data: ${JSON.stringify({ done: true, model: selection, usage: { outputTokens: 3 } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    ) as unknown as typeof fetch;
    const deltas: string[] = [];
    const result = await api.generate({ prompt: "p", existingCode: "", history: [] }, selection, (d) => deltas.push(d));
    expect(deltas).toEqual(["a -> ", "b"]);
    expect(result).toEqual({ text: "a -> b", usage: { outputTokens: 3 }, model: selection });
  });

  it("throws the in-stream error with its code", async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([`data: ${JSON.stringify({ content: "x" })}\n\n`, `data: ${JSON.stringify({ error: "Quota exhausted", code: "quota" })}\n\n`, "data: [DONE]\n\n"]),
    ) as unknown as typeof fetch;
    await expect(api.generate({ prompt: "p", existingCode: "", history: [] }, selection, () => {})).rejects.toMatchObject({
      message: "Quota exhausted",
      code: "quota",
    });
  });

  it("surfaces JSON errors from a failed request", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ error: "Model unavailable", code: "model_unavailable" }, { status: 400 })) as unknown as typeof fetch;
    const err = await api.generate({ prompt: "p", existingCode: "", history: [] }, selection, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "model_unavailable" });
  });
});

describe("api.render", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shares one request for identical code", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ svg: "<svg/>", quality: null }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const code = `a -> b # ${Math.random()}`;
    const [one, two] = await Promise.all([api.render(code), api.render(code)]);
    expect(one).toEqual(two);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "bad" }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ svg: "<svg/>", quality: null }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const code = `x -> y # ${Math.random()}`;
    await expect(api.render(code)).rejects.toMatchObject({ status: 422, message: "bad" });
    await expect(api.render(code)).resolves.toMatchObject({ svg: "<svg/>" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("lets one caller cancel without breaking the shared request", async () => {
    let resolve!: (r: Response) => void;
    globalThis.fetch = vi.fn(() => new Promise<Response>((r) => (resolve = r))) as unknown as typeof fetch;
    const code = `slow # ${Math.random()}`;
    const controller = new AbortController();
    const cancelled = api.render(code, controller.signal);
    const kept = api.render(code);
    controller.abort();
    resolve(Response.json({ svg: "<svg/>", quality: null }));
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(kept).resolves.toMatchObject({ svg: "<svg/>" });
  });
});

describe("safeFileName", () => {
  it.each([
    ["AWS three tier", "AWS-three-tier"],
    ["../../etc/passwd", "etcpasswd"],
    ["", "diagram"],
  ])("%j → %j", (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});
