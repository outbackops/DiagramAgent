import { describe, it, expect, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

vi.mock("@/lib/d2-to-drawio", () => ({
  d2ToDrawio: async (code: string, title: string) =>
    `<mxfile><diagram name="${title}"><!--${code}--></diagram></mxfile>`,
}));

async function loadRoute() {
  return import("./route");
}

// NOTE: src/app/api/export/vsdx/route.ts emits a draw.io .drawio file
// (despite the directory name). The actual VSDX export lives at
// src/app/api/export/visio/route.ts.
describe("POST /api/export/vsdx (drawio output)", () => {
  it("returns 400 when d2Code missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when d2Code is non-string", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ d2Code: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns drawio XML with attachment headers", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeJsonRequest({ d2Code: "a -> b", title: "My Diagram" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml");
    expect(res.headers.get("Content-Disposition")).toMatch(/My Diagram\.drawio/);

    const text = await res.text();
    expect(text).toContain("<mxfile>");
    // The route passes d2Code through to the converter; our mock embeds it raw.
    expect(text).toContain("a -> b");
  });

  it("uses default title when none provided", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ d2Code: "x" }));
    expect(res.headers.get("Content-Disposition")).toMatch(/Architecture/i);
  });
});
