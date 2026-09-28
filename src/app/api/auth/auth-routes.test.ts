// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  machineStatus: vi.fn(async () => ({ signedIn: true, login: "machine-user", detail: "machine-user (via gh)" })),
  listModels: vi.fn(async () => [{ provider: "copilot", id: "claude-opus-5.5", name: "Claude Opus 5.5", vision: true, reasoningEfforts: ["medium"] }]),
  poll: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/lib/llm/copilot-provider", () => ({
  copilotProvider: { getMachineAuthStatus: mocks.machineStatus, listModels: mocks.listModels },
}));
vi.mock("@/lib/llm/azure-provider", () => ({ azureProvider: { isConfigured: () => false } }));
vi.mock("@/lib/auth/device-flow", () => ({ pollDeviceFlow: mocks.poll, startDeviceFlow: mocks.start }));

import { GET as status } from "./status/route";
import { POST as start } from "./device/start/route";
import { POST as poll } from "./device/poll/route";
import { POST as signout } from "./signout/route";
import { sessionCookie } from "@/lib/auth/session";

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };

function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  env.DIAGRAM_AGENT_SESSION_SECRET = "s".repeat(40);
  env.NODE_ENV = "development";
  delete env.GITHUB_OAUTH_CLIENT_ID;
  delete env.DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN;
  mocks.machineStatus.mockClear();
  mocks.listModels.mockClear();
  mocks.poll.mockReset();
  mocks.start.mockReset();
});

afterEach(() => {
  for (const k of Object.keys(env)) if (!(k in saved)) delete env[k];
  Object.assign(env, saved);
});

describe("GET /api/auth/status", () => {
  it("reports the machine login in development", async () => {
    const res = await status(new Request("http://localhost/api/auth/status") as never);
    const body = await res.json();
    expect(body).toMatchObject({ signedIn: true, login: "machine-user", source: "machine", deviceFlow: { enabled: false } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("prefers the in-app session and does not touch the runtime", async () => {
    const cookie = sessionCookie(new Request("http://localhost/"), { token: "gho_x", login: "octocat" }).split(";")[0];
    const res = await status(new Request("http://localhost/api/auth/status", { headers: { cookie } }) as never);
    expect(await res.json()).toMatchObject({ signedIn: true, login: "octocat", source: "user" });
    expect(mocks.machineStatus).not.toHaveBeenCalled();
  });

  it("is signed out in production without a session", async () => {
    env.NODE_ENV = "production";
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    const res = await status(new Request("http://localhost/api/auth/status") as never);
    expect(await res.json()).toMatchObject({ signedIn: false, source: null, machine: { allowed: false }, deviceFlow: { enabled: true } });
    expect(mocks.machineStatus).not.toHaveBeenCalled();
  });

  it("surfaces runtime failures instead of throwing", async () => {
    mocks.machineStatus.mockRejectedValueOnce(new Error("spawn failed"));
    const res = await status(new Request("http://localhost/api/auth/status") as never);
    const body = await res.json();
    expect(body.signedIn).toBe(false);
    expect(body.machine.error).toBeTruthy();
  });
});

describe("device flow routes", () => {
  it("returns 503 when no OAuth client id is configured", async () => {
    const res = await start(jsonPost("http://localhost/api/auth/device/start", {}));
    expect(res.status).toBe(503);
  });

  it("starts a flow", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    mocks.start.mockResolvedValue({ flow: "sealed", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 });
    const res = await start(jsonPost("http://localhost/api/auth/device/start", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userCode: "ABCD-1234" });
    expect(mocks.start).toHaveBeenCalledWith("Iv1.test");
  });

  it("passes pending polls through", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    mocks.poll.mockResolvedValue({ status: "pending" });
    const res = await poll(jsonPost("http://localhost/api/auth/device/poll", { flow: "sealed" }));
    expect(await res.json()).toEqual({ status: "pending" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("sets the session cookie on completion without returning the token", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    mocks.poll.mockResolvedValue({ status: "complete", token: "gho_secret", login: "octocat" });
    const res = await poll(jsonPost("http://localhost/api/auth/device/poll", { flow: "sealed" }));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "complete", login: "octocat" });
    expect(text).not.toContain("gho_secret");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("da_session=");
    expect(setCookie).not.toContain("gho_secret");
    expect(mocks.listModels).toHaveBeenCalledWith({ kind: "github-token", token: "gho_secret", login: "octocat" });
  });

  it("refuses accounts without Copilot", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    mocks.poll.mockResolvedValue({ status: "complete", token: "gho_nocopilot", login: "someone" });
    mocks.listModels.mockResolvedValueOnce([]);
    const res = await poll(jsonPost("http://localhost/api/auth/device/poll", { flow: "sealed" }));
    expect(await res.json()).toMatchObject({ status: "denied" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("validates the flow handle", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    const res = await poll(jsonPost("http://localhost/api/auth/device/poll", {}));
    expect(res.status).toBe(400);
  });

  it("blocks cross-origin polls", async () => {
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    const res = await poll(jsonPost("http://localhost/api/auth/device/poll", { flow: "x" }, { host: "localhost", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(mocks.poll).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signout", () => {
  it("clears the session cookie", async () => {
    const res = await signout(jsonPost("http://localhost/api/auth/signout", {}));
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
