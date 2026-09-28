// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeJsonRequest } from "../_test-helpers";

vi.mock("@terrastruct/d2", () => ({
  D2: class {
    async compile(code: string) {
      if (code.includes("@@INVALID@@")) {
        throw new Error(JSON.stringify([{ errmsg: "syntax error at line 1" }]));
      }
      return { diagram: { code, shapes: [], connections: [] }, renderOptions: {} };
    }
    async render(diagram: { code: string }) {
      return `<svg data-from="d2-mock"><!--${diagram.code}--></svg>`;
    }
  },
}));

vi.mock("@/lib/icon-registry", () => ({
  iconRegistry: {},
  resolveIconsInD2Code: (s: string) => s.replace(/icon:\s*(\S+)/g, "icon: /icons/$1.svg"),
}));

vi.mock("@/lib/svg-orthogonal", () => ({
  convertConnectionsToOrthogonal: (svg: string) => svg + "<!-- orthogonal-pass -->",
}));

const quality = vi.hoisted(() => ({
  scoreDiagram: vi.fn(() => ({ score: 91, grade: "A", checks: [], metrics: {} })),
}));
vi.mock("@/lib/quality/diagram-quality", () => quality);

import { POST } from "./route";

describe("POST /api/render", () => {
  beforeEach(() => {
    quality.scoreDiagram.mockClear();
  });

  it("returns 400 when code is missing or blank", async () => {
    expect((await POST(makeJsonRequest({}))).status).toBe(400);
    expect((await POST(makeJsonRequest({ code: "   " }))).status).toBe(400);
  });

  it("rejects oversized code", async () => {
    expect((await POST(makeJsonRequest({ code: "a".repeat(200_001) }))).status).toBe(413);
  });

  it("compiles, renders, post-processes, and scores", async () => {
    const res = await POST(makeJsonRequest({ code: "a -> b" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.svg).toContain('data-from="d2-mock"');
    expect(body.svg).toContain("orthogonal-pass");
    expect(body.quality).toMatchObject({ score: 91, grade: "A" });
    expect(quality.scoreDiagram).toHaveBeenCalledWith("a -> b", { shapes: [], connections: [] });
  });

  it("resolves icons via icon-registry before compile", async () => {
    const body = await (await POST(makeJsonRequest({ code: "a: { icon: aws-ec2 }" }))).json();
    expect(body.svg).toContain("/icons/aws-ec2.svg");
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
});
