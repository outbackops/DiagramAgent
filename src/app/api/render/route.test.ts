import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeJsonRequest } from "../_test-helpers";

vi.mock("@terrastruct/d2", () => ({
  D2: class {
    async compile(code: string) {
      // Reject obviously broken code
      if (code.includes("@@INVALID@@")) {
        throw new Error(JSON.stringify([{ errmsg: "syntax error at line 1" }]));
      }
      return { diagram: { code }, renderOptions: {} };
    }
    async render(diagram: { code: string }) {
      return `<svg data-from="d2-mock"><!--${diagram.code}--></svg>`;
    }
  },
}));

vi.mock("@/lib/icon-registry", () => ({
  resolveIconsInD2Code: (s: string) => s.replace(/icon:\s*(\S+)/g, "icon: /icons/$1.svg"),
}));

vi.mock("@/lib/svg-orthogonal", () => ({
  convertConnectionsToOrthogonal: (svg: string) => svg + "<!-- orthogonal-pass -->",
}));

async function loadRoute() {
  return import("./route");
}

describe("POST /api/render", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when code is missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is empty/whitespace", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ code: "   " }));
    expect(res.status).toBe(400);
  });

  it("compiles + renders + post-processes the SVG", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ code: "a -> b" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.svg).toContain("data-from=\"d2-mock\"");
    expect(body.svg).toContain("orthogonal-pass");
  });

  it("resolves icons via icon-registry before compile", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ code: "a: { icon: aws-ec2 }" }));
    const body = await res.json();
    // Mocked resolver substitutes /icons/<key>.svg — the SVG comment captures
    // the resolved code we passed to compile.
    expect(body.svg).toContain("/icons/aws-ec2.svg");
  });

  it("returns 422 with parsed errmsg on D2 compile failure", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeJsonRequest({ code: "@@INVALID@@" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("syntax error");
  });
});
