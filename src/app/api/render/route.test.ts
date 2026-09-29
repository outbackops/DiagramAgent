// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeJsonRequest } from "../_test-helpers";

const shape = (id: string, x: number, icon?: string) => ({
  id,
  type: "rectangle",
  pos: { x, y: 0 },
  width: 100,
  height: 60,
  label: id,
  level: 1,
  fill: "#ffffff",
  stroke: "N1",
  strokeWidth: 2,
  icon: icon ? { Path: icon } : null,
});

vi.mock("@terrastruct/d2", () => ({
  D2: class {
    async compile(code: string) {
      if (code.includes("@@INVALID@@")) {
        throw new Error(JSON.stringify([{ errmsg: "syntax error at line 1" }]));
      }
      const icon = /icon: (\S+)/.exec(code)?.[1];
      const shapes = [shape("a", 0, icon), shape("b", 200)];
      const connections = code.includes("->")
        ? [{ id: "(a -> b)[0]", src: "a", dst: "b", srcArrow: "none", dstArrow: "triangle", label: "", strokeDash: 0, route: [{ x: 100, y: 30 }, { x: 200, y: 30 }] }]
        : [];
      return { diagram: { shapes, connections }, renderOptions: {} };
    }
    async render() {
      return "<svg/>";
    }
  },
}));

vi.mock("@/lib/icon-registry", () => ({
  iconRegistry: {},
  resolveIconsInD2Code: (s: string) => s.replace(/icon:\s*(\S+)/g, "icon: /icons/$1.svg"),
}));

const quality = vi.hoisted(() => ({
  scoreDiagram: vi.fn(() => ({ score: 91, grade: "A", checks: [], metrics: {} })),
}));
vi.mock("@/lib/quality/diagram-quality", () => quality);

import { POST } from "./route";

describe("POST /api/render", () => {
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = env.NODE_ENV;

  beforeEach(() => {
    env.NODE_ENV = savedEnv;
    quality.scoreDiagram.mockClear();
  });
  afterEach(() => {
    env.NODE_ENV = savedEnv;
  });

  it("returns 400 when code is missing or blank", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ code: "   " }))).status).toBe(400);
  });

  it("rejects oversized code", async () => {
    expect((await POST(makeJsonRequest({ code: "a".repeat(200_001) }))).status).toBe(413);
  });

  it("compiles, imports a model, renders it and scores the compiled layout", async () => {
    const res = await POST(makeJsonRequest({ code: "a -> b" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model.nodes.map((n: { id: string }) => n.id)).toEqual(["a", "b"]);
    expect(body.model.edges).toHaveLength(1);
    expect(body.model.nodes[0].style.stroke).toMatch(/^#/);
    expect(body.svg).toContain('class="da-diagram"');
    expect(body.svg).toContain('data-id="a"');
    expect(body.warnings).toEqual([]);
    expect(body.quality).toMatchObject({ score: 91, grade: "A" });
    expect(quality.scoreDiagram).toHaveBeenCalledWith("a -> b", expect.objectContaining({ shapes: expect.any(Array) }));
  });

  it("resolves icons via icon-registry before compile", async () => {
    const body = await (await POST(makeJsonRequest({ code: "a: { icon: aws-ec2 }" }))).json();
    expect(body.model.nodes[0].icon).toBe("/icons/aws-ec2.svg");
    expect(body.svg).toContain('href="/icons/aws-ec2.svg"');
  });

  it("renders and scores an edited model without compiling", async () => {
    const model = (await (await POST(makeJsonRequest({ code: "a -> b" }))).json()).model;
    quality.scoreDiagram.mockClear();
    model.nodes[1].box.x = 600;
    model.edges[0].route = [];
    const res = await POST(makeJsonRequest({ model }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.svg).toContain('data-edge="(a -&gt; b)[0]"');
    expect(body.model).toBeUndefined();
    const [code, compiled] = quality.scoreDiagram.mock.calls[0] as unknown as [string, { connections: { route: unknown[] }[] }];
    expect(code).toContain("a -> b");
    expect(compiled.connections[0].route.length).toBeGreaterThan(1);
  });

  it("rejects an invalid model", async () => {
    const res = await POST(makeJsonRequest({ model: { version: 1, nodes: [{ id: "x" }], edges: [] } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid diagram/);
  });

  it("still returns the SVG when scoring throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    quality.scoreDiagram.mockImplementationOnce(() => {
      throw new Error("scorer bug");
    });
    const body = await (await POST(makeJsonRequest({ code: "a -> b" }))).json();
    expect(body.svg).toBeTruthy();
    expect(body.quality).toBeNull();
  });

  it("returns 422 with the D2 error message on compile failure", async () => {
    const res = await POST(makeJsonRequest({ code: "@@INVALID@@" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("syntax error at line 1");
  });

  it("requires a JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/render", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "a -> b" }) as never,
    );
    expect(res.status).toBe(415);
  });

  it("requires credentials in production", async () => {
    env.NODE_ENV = "production";
    const res = await POST(makeJsonRequest({ code: "a -> b" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in with GitHub to use DiagramAgent.", code: "unauthenticated" });
  });
});
