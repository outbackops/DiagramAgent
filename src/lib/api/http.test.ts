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
});
