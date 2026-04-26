import { describe, it, expect, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

vi.mock("@/lib/d2-to-vsdx", () => ({
  d2ToVsdx: async (_code: string) => Buffer.from("PK\x03\x04fake-vsdx-zip"),
}));

async function loadRoute() {
  return import("./route");
}

describe("POST /api/export/visio", () => {
  it("returns 400 when d2Code missing", async () => {
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
    const res = await POST(makeJsonRequest({ d2Code: "a -> b", title: "Foo" }));
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
    vi.doMock("@/lib/d2-to-vsdx", () => ({
      d2ToVsdx: async () => {
        throw new Error("conversion exploded");
      },
    }));
    const { POST } = await import("./route");
    const res = await POST(makeJsonRequest({ d2Code: "x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/conversion exploded/);
  });
});
