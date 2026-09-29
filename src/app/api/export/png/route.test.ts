// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

const raster = vi.hoisted(() => ({
  svgToPng: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad])),
}));
vi.mock("@/lib/svg-raster", () => raster);

import { POST } from "./route";

const MODEL = {
  version: 1,
  nodes: [
    { id: "a", parent: null, label: "A <b>", shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false },
    { id: "b", parent: null, label: "B", shape: "rectangle", box: { x: 200, y: 0, w: 100, h: 60 }, style: {}, container: false },
  ],
  edges: [{ id: "(a -> b)[0]", from: "a", to: "b", srcArrow: "none", dstArrow: "triangle", style: {}, route: [] }],
};

describe("POST /api/export/png", () => {
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = savedEnv;
  });

  it("returns 400 without a diagram, for an invalid one, and for raw SVG", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ model: { version: 1, nodes: "x", edges: [] } }))).status).toBe(400);
    // Arbitrary client SVG is no longer rasterised.
    expect((await POST(makeJsonRequest({ svg: "<svg/>" }))).status).toBe(400);
  });

  it("renders the model on the server and returns PNG bytes", async () => {
    const res = await POST(makeJsonRequest({ model: MODEL }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toMatch(/diagram\.png/);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const [svg] = raster.svgToPng.mock.calls.at(-1) as unknown as [string];
    expect(svg).toContain('class="da-diagram"');
    expect(svg).toContain("A &lt;b&gt;");
    // A missing route gets a cheap fallback line on the server.
    expect(svg).toContain('data-edge="(a -&gt; b)[0]"');
    expect(raster.svgToPng).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ density: 300 }));
  });

  it("returns 500 when rasterisation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    raster.svgToPng.mockRejectedValueOnce(new Error("bad svg"));
    const res = await POST(makeJsonRequest({ model: MODEL }));
    expect(res.status).toBe(500);
  });

  it("requires credentials in production", async () => {
    env.NODE_ENV = "production";
    const res = await POST(makeJsonRequest({ model: MODEL }));
    expect(res.status).toBe(401);
  });
});
