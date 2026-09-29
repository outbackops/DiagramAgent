// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const fake = vi.hoisted(() => ({ instances: 0, hang: false, terminated: 0 }));

// Mimics @terrastruct/d2's wrapper: ONE pending resolver shared by all calls,
// so overlapping calls orphan earlier promises and cross results.
vi.mock("@terrastruct/d2", () => ({
  D2: class {
    private currentResolve: ((v: unknown) => void) | null = null;
    worker = { terminate: () => void fake.terminated++ };
    constructor() {
      fake.instances++;
    }
    private send(result: unknown, delay: number) {
      return new Promise((resolve) => {
        this.currentResolve = resolve;
        if (fake.hang) return;
        setTimeout(() => this.currentResolve?.(result), delay);
      });
    }
    compile(code: string) {
      const shape = { id: code.trim(), type: "rectangle", pos: { x: 0, y: 0 }, width: 10, height: 10, label: code.trim(), icon: null, level: 1 };
      return this.send({ diagram: { shapes: [shape], connections: [] }, renderOptions: {} }, 5);
    }
  },
}));

vi.mock("@/lib/icon-registry", () => ({ resolveIconsInD2Code: (s: string) => s }));

import { compileD2, D2RenderError } from "./d2-render";

describe("compileD2 against the D2 wrapper's single-request limitation", () => {
  beforeEach(() => {
    fake.hang = false;
  });
  afterEach(() => {
    delete process.env.DIAGRAM_AGENT_RENDER_TIMEOUT_MS;
    delete process.env.DIAGRAM_AGENT_RENDER_QUEUE_LIMIT;
  });

  it("serialises concurrent compiles so each caller gets its own diagram", async () => {
    const codes = ["alpha", "bravo", "charlie", "delta", "echo"];
    const results = await Promise.all(codes.map((code) => compileD2(code)));
    results.forEach((r, i) => expect(r.diagram.shapes[0].id).toBe(codes[i]));
  });

  it("times out a wedged layout, recycles the worker, and recovers", async () => {
    process.env.DIAGRAM_AGENT_RENDER_TIMEOUT_MS = "40";
    const before = { instances: fake.instances, terminated: fake.terminated };
    fake.hang = true;
    await expect(compileD2("wedged")).rejects.toBeInstanceOf(D2RenderError);
    expect(fake.terminated).toBe(before.terminated + 1);

    fake.hang = false;
    const ok = await compileD2("recovered");
    expect(ok.diagram.shapes[0].id).toBe("recovered");
    expect(fake.instances).toBe(before.instances + 1);
  });

  it("rejects new work when the render queue is full", async () => {
    process.env.DIAGRAM_AGENT_RENDER_TIMEOUT_MS = "30";
    process.env.DIAGRAM_AGENT_RENDER_QUEUE_LIMIT = "1";
    fake.hang = true;
    const first = compileD2("first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = compileD2("second");
    await expect(compileD2("third")).rejects.toMatchObject({ name: "D2BusyError" });
    await expect(first).rejects.toBeInstanceOf(D2RenderError);
    await expect(second).rejects.toBeInstanceOf(D2RenderError);
  });

  it("skips queued work whose signal is aborted before it starts", async () => {
    process.env.DIAGRAM_AGENT_RENDER_TIMEOUT_MS = "30";
    fake.hang = true;
    const first = compileD2("first");
    const controller = new AbortController();
    const second = compileD2("second", { signal: controller.signal });
    controller.abort();
    await expect(first).rejects.toBeInstanceOf(D2RenderError);
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
  });
});
