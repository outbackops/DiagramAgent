// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { seal, unseal } from "./seal";
import { SESSION_COOKIE, clearSessionCookie, getRequestCredentials, readSession, requireCredentials, sessionCookie } from "./session";
import { machineLoginAllowed, deviceFlowEnabled } from "./policy";
import { fetchGitHubLogin, pollDeviceFlow, startDeviceFlow } from "./device-flow";

const ENV_KEYS = ["DIAGRAM_AGENT_SESSION_SECRET", "DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN", "GITHUB_OAUTH_CLIENT_ID", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};
const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = env[k];
  env.DIAGRAM_AGENT_SESSION_SECRET = "x".repeat(40);
  delete env.DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN;
  delete env.GITHUB_OAUTH_CLIENT_ID;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function requestWithCookie(cookie?: string, url = "http://localhost:3000/api/x") {
  return new Request(url, { headers: cookie ? { cookie } : {} });
}

function cookieValue(setCookie: string) {
  return setCookie.split(";")[0];
}

describe("seal / unseal", () => {
  it("round-trips a payload", () => {
    const sealed = seal({ a: 1, b: "two" }, "session");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(unseal(sealed, "session")).toEqual({ a: 1, b: "two" });
  });

  it("binds the purpose so a device-flow handle is not a valid session", () => {
    const sealed = seal({ a: 1 }, "device-flow");
    expect(unseal(sealed, "session")).toBeNull();
  });

  it("rejects tampering", () => {
    const sealed = seal({ a: 1 }, "session");
    const parts = sealed.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "B" : "A") + parts[2].slice(-1);
    expect(unseal(parts.join("."), "session")).toBeNull();
    expect(unseal("garbage", "session")).toBeNull();
    expect(unseal(null, "session")).toBeNull();
  });

  it("does not leak the token in the sealed value", () => {
    expect(seal({ token: "gho_supersecret" }, "session")).not.toContain("gho_supersecret");
  });

  it("refuses short secrets", () => {
    env.DIAGRAM_AGENT_SESSION_SECRET = "short";
    expect(() => seal({}, "session")).toThrow(/at least 32/);
  });

  it("requires a secret in production", () => {
    delete env.DIAGRAM_AGENT_SESSION_SECRET;
    env.NODE_ENV = "production";
    expect(() => seal({}, "session")).toThrow(/DIAGRAM_AGENT_SESSION_SECRET/);
  });
});

describe("session cookie", () => {
  it("writes an HttpOnly, SameSite=Lax cookie and reads it back", () => {
    const set = sessionCookie(requestWithCookie(), { token: "gho_abc", login: "octocat" });
    expect(set).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).not.toContain("Secure");
    const session = readSession(requestWithCookie(cookieValue(set)));
    expect(session).toMatchObject({ token: "gho_abc", login: "octocat" });
  });

  it("marks the cookie Secure on https", () => {
    const set = sessionCookie(requestWithCookie(undefined, "https://diagrams.example.com/"), { token: "t", login: "l" });
    expect(set).toContain("; Secure");
  });

  it("ignores expired sessions", () => {
    const expired = seal({ token: "t", login: "l", exp: Date.now() - 1 }, "session");
    expect(readSession(requestWithCookie(`${SESSION_COOKIE}=${encodeURIComponent(expired)}`))).toBeNull();
  });

  it("clears the cookie", () => {
    expect(clearSessionCookie(requestWithCookie())).toContain("Max-Age=0");
  });
});

describe("request credentials", () => {
  it("prefers the in-app sign-in", () => {
    const set = sessionCookie(requestWithCookie(), { token: "gho_user", login: "octocat" });
    expect(getRequestCredentials(requestWithCookie(cookieValue(set)))).toEqual({ kind: "github-token", token: "gho_user", login: "octocat" });
  });

  it("falls back to the machine login outside production", () => {
    env.NODE_ENV = "development";
    expect(machineLoginAllowed()).toBe(true);
    expect(getRequestCredentials(requestWithCookie())).toEqual({ kind: "machine" });
  });

  it("never lends the machine login to anonymous requests in production", () => {
    env.NODE_ENV = "production";
    expect(machineLoginAllowed()).toBe(false);
    expect(getRequestCredentials(requestWithCookie())).toBeNull();
    expect(() => requireCredentials(requestWithCookie())).toThrow(/Sign in/);
  });

  it("lets operators opt in or out explicitly", () => {
    env.NODE_ENV = "production";
    env.DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN = "true";
    expect(machineLoginAllowed()).toBe(true);
    env.NODE_ENV = "development";
    env.DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN = "false";
    expect(machineLoginAllowed()).toBe(false);
  });

  it("enables device flow only with a client id", () => {
    expect(deviceFlowEnabled()).toBe(false);
    env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
    expect(deviceFlowEnabled()).toBe(true);
  });
});

describe("device flow", () => {
  function fakeFetch(routes: Record<string, () => Response>) {
    return vi.fn(async (url: string | URL | Request) => {
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      if (!key) throw new Error(`unexpected fetch ${String(url)}`);
      return routes[key]();
    }) as unknown as typeof fetch;
  }

  it("starts a flow and seals the device code", async () => {
    const fetchImpl = fakeFetch({
      "/login/device/code": () =>
        Response.json({ device_code: "dev-123", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }),
    });
    const start = await startDeviceFlow("client", fetchImpl);
    expect(start).toMatchObject({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", interval: 5 });
    expect(start.flow).not.toContain("dev-123");
    expect(unseal<{ deviceCode: string }>(start.flow, "device-flow")?.deviceCode).toBe("dev-123");
  });

  it("explains a disabled device flow", async () => {
    const fetchImpl = fakeFetch({ "/login/device/code": () => Response.json({ error: "device_flow_disabled" }) });
    await expect(startDeviceFlow("client", fetchImpl)).rejects.toThrow(/Enable Device Flow/);
  });

  async function flowHandle() {
    const fetchImpl = fakeFetch({
      "/login/device/code": () => Response.json({ device_code: "dev-1", user_code: "U", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 }),
    });
    return (await startDeviceFlow("client", fetchImpl)).flow;
  }

  it.each([
    ["authorization_pending", { status: "pending" }],
    ["slow_down", { status: "slow_down", interval: 10 }],
    ["expired_token", { status: "expired" }],
    ["access_denied", { status: "denied" }],
  ])("maps %s", async (error, expected) => {
    const flow = await flowHandle();
    const fetchImpl = fakeFetch({ "/login/oauth/access_token": () => Response.json({ error }) });
    expect(await pollDeviceFlow("client", flow, fetchImpl)).toMatchObject(expected);
  });

  it("completes with the GitHub login", async () => {
    const flow = await flowHandle();
    const fetchImpl = fakeFetch({
      "/login/oauth/access_token": () => Response.json({ access_token: "gho_new", token_type: "bearer" }),
      "api.github.com/user": () => Response.json({ login: "octocat" }),
    });
    expect(await pollDeviceFlow("client", flow, fetchImpl)).toEqual({ status: "complete", token: "gho_new", login: "octocat" });
  });

  it("rejects tampered handles without calling GitHub", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(pollDeviceFlow("client", "v1.bad.handle.x", fetchImpl)).rejects.toMatchObject({ code: "bad_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports expired handles locally", async () => {
    const flow = seal({ deviceCode: "d", exp: Date.now() - 1000 }, "device-flow");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await pollDeviceFlow("client", flow, fetchImpl)).toMatchObject({ status: "expired" });
  });

  it("maps an invalid token on user lookup", async () => {
    const fetchImpl = fakeFetch({ "api.github.com/user": () => new Response("", { status: 401 }) });
    await expect(fetchGitHubLogin("bad", fetchImpl)).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
