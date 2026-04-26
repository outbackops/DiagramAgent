import { describe, it, expect, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

vi.mock("sharp", () => ({
  default: () => ({
    png: () => ({
      toBuffer: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]),
    }),
  }),
}));

async function loadRoute() {
  return import("./route");
}

describe("POST /api/export/png", () => {
  it("returns 400 when svg missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns PNG bytes with image/png Content-Type", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toMatch(/diagram\.png/);

    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG magic
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x4e);
    expect(buf[3]).toBe(0x47);
  });
});
