// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/llm", async () => (await import("../_test-helpers")).llmModuleMock());

import { GET } from "./route";
import { TEST_CATALOG } from "../_test-helpers";

const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;

describe("GET /api/models", () => {
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
  });

  it("returns the caller's catalog and the default selection", async () => {
    const res = await GET(new Request("http://localhost/api/models") as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.models).toEqual(TEST_CATALOG);
    expect(body.defaultSelection).toEqual({ provider: "copilot", model: "claude-opus-5.5", reasoningEffort: "medium" });
  });

  it("requires sign-in in production", async () => {
    env.NODE_ENV = "production";
    const res = await GET(new Request("http://localhost/api/models") as never);
    expect(res.status).toBe(401);
  });
});
