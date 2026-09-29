import { describe, it, expect, afterEach, vi } from "vitest";
import { makeJsonRequest } from "../../_test-helpers";

vi.mock("@/lib/model/to-drawio", () => ({
  modelToDrawio: async (model: { nodes: { id: string }[] }, options: { title: string }) =>
    `<mxfile><diagram name="${options.title}"><!--${model.nodes.map((n) => n.id).join(",")}--></diagram></mxfile>`,
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

// NOTE: src/app/api/export/vsdx/route.ts emits a draw.io .drawio file
// (despite the directory name). The actual VSDX export lives at
// src/app/api/export/visio/route.ts.
describe("POST /api/export/vsdx (drawio output)", () => {
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

  it("returns 400 when d2Code is non-string or the model is invalid", async () => {
    const { POST } = await loadRoute();
    expect((await POST(makeJsonRequest({ d2Code: 123 }))).status).toBe(400);
    expect((await POST(makeJsonRequest({ model: { version: 1, nodes: "x", edges: [] } }))).status).toBe(400);
  });

  it("returns drawio XML with attachment headers", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ model: MODEL, title: "My Diagram" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/xml");
    expect(res.headers.get("Content-Disposition")).toMatch(/My Diagram\.drawio/);

    const text = await res.text();
    expect(text).toContain("<mxfile>");
    // The route passes the validated model to the exporter; our mock lists its node ids.
    expect(text).toContain("a,b");
  });

  it("uses default title when none provided", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ model: MODEL }));
    expect(res.headers.get("Content-Disposition")).toMatch(/Architecture/i);
  });

  it("requires credentials in production", async () => {
    env.NODE_ENV = "production";
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ d2Code: "x" }));
    expect(res.status).toBe(401);
  });
});
