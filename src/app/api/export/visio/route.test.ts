import { describe, it, expect, afterEach, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

vi.mock("@/lib/model/to-vsdx", () => ({
  modelToVsdx: async () => Buffer.from("PK\x03\x04fake-vsdx-zip"),
}));

const MODEL = {
  version: 1,
  nodes: [
    { id: "a", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false },
    { id: "b", parent: null, label: "B", shape: "rectangle", box: { x: 200, y: 0, w: 100, h: 60 }, style: {}, container: false },
  ],
  edges: [
    { id: "(a -> b)[0]", from: "a", to: "b", srcArrow: "none", dstArrow: "triangle", style: {}, route: [{ x: 100, y: 30 }, { x: 200, y: 30 }] },
  ],
};

async function loadRoute() {
  return import("./route");
}

describe("POST /api/export/visio", () => {
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = savedEnv;
  });

  it("returns 400 when the diagram is missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 on non-string d2Code", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ d2Code: 42 }));
    expect(res.status).toBe(400);
  });

  it("returns vsdx bytes with correct headers and content-length", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ model: MODEL, title: "Foo" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.ms-visio.drawing");
    expect(res.headers.get("Content-Disposition")).toMatch(/Foo\.vsdx/);
    const len = Number(res.headers.get("Content-Length"));
    expect(len).toBeGreaterThan(0);

    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBe(len);
    // PKZip magic
    const view = new Uint8Array(buf);
    expect(view[0]).toBe(0x50); // P
    expect(view[1]).toBe(0x4b); // K
  });

  it("returns 500 with error JSON when conversion throws", async () => {
    vi.resetModules();
    vi.doMock("@/lib/model/to-vsdx", () => ({
      modelToVsdx: async () => {
        throw new Error("conversion exploded");
      },
    }));
    const { POST } = await import("./route");
    const res = await POST(makeJsonRequest({ model: MODEL }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/conversion exploded/);
  });

  it("requires credentials in production", async () => {
    env.NODE_ENV = "production";
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ d2Code: "x" }));
    expect(res.status).toBe(401);
  });
});
