// @vitest-environment node
import { describe, it, expect } from "vitest";
import { guardApiRequest, readJsonBody } from "./http";

function post(headers: Record<string, string>, body = "{}") {
  return new Request("http://localhost:3000/api/generate", { method: "POST", headers, body });
}

describe("guardApiRequest", () => {
  it("allows same-origin JSON posts", () => {
    expect(guardApiRequest(post({ "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" }))).toBeNull();
  });

  it("allows JSON posts without an Origin header (server-side callers, tests)", () => {
    expect(guardApiRequest(post({ "content-type": "application/json" }))).toBeNull();
  });

  it("rejects non-JSON posts (form/text drive-by requests)", () => {
    expect(guardApiRequest(post({ "content-type": "text/plain" }))?.status).toBe(415);
  });

  it("rejects cross-origin posts", () => {
    const res = guardApiRequest(post({ "content-type": "application/json", host: "localhost:3000", origin: "https://evil.example" }));
    expect(res?.status).toBe(403);
  });

  it("rejects browser-flagged cross-site requests", () => {
    const res = guardApiRequest(post({ "content-type": "application/json", "sec-fetch-site": "cross-site" }));
    expect(res?.status).toBe(403);
  });

  it("honours x-forwarded-host behind a proxy", () => {
    const res = guardApiRequest(
      post({ "content-type": "application/json", host: "internal:3000", "x-forwarded-host": "diagrams.example.com", origin: "https://diagrams.example.com" }),
    );
    expect(res).toBeNull();
  });

  it("lets GETs through without a content type", () => {
    expect(guardApiRequest(new Request("http://localhost:3000/api/models"))).toBeNull();
  });
});

describe("readJsonBody", () => {
  it("returns objects and nulls for anything else", async () => {
    expect(await readJsonBody(post({}, '{"a":1}'))).toEqual({ a: 1 });
    expect(await readJsonBody(post({}, "[1,2]"))).toBeNull();
    expect(await readJsonBody(post({}, "{nope"))).toBeNull();
  });

  it("rejects bodies over the content-length cap before reading", async () => {
    const req = post({ "content-length": "11" }, '{"a":1}');
    await expect(readJsonBody(req, 10)).rejects.toMatchObject({ code: "bad_request", status: 413 });
  });

  it("rejects streamed bodies that exceed the cap", async () => {
    const encoder = new TextEncoder();
    const req = new Request("http://localhost:3000/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"a":"'));
          controller.enqueue(encoder.encode("x".repeat(20)));
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readJsonBody(req, 10)).rejects.toMatchObject({ status: 413 });
  });
});
