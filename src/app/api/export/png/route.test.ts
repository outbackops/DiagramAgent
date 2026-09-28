// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

const raster = vi.hoisted(() => ({
  svgToPng: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad])),
}));
vi.mock("@/lib/svg-raster", () => raster);

import { POST } from "./route";

describe("POST /api/export/png", () => {
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = savedEnv;
  });

  it("returns 400 when svg missing", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
  });

  it("returns PNG bytes with image/png Content-Type", async () => {
    const res = await POST(makeJsonRequest({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toMatch(/diagram\.png/);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect([...buf.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(raster.svgToPng).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ density: 300 }));
  });

  it("returns 500 when rasterisation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    raster.svgToPng.mockRejectedValueOnce(new Error("bad svg"));
    const res = await POST(makeJsonRequest({ svg: "<svg/>" }));
    expect(res.status).toBe(500);
  });

  it("requires credentials in production", async () => {
    env.NODE_ENV = "production";
    const res = await POST(makeJsonRequest({ svg: "<svg/>" }));
    expect(res.status).toBe(401);
  });
});
