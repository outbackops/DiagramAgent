import { LlmError } from "@/lib/llm/errors";
import { seal, unseal } from "./seal";

/**
 * GitHub OAuth device flow (RFC 8628). No client secret is involved; the
 * device code never reaches the browser in clear text — it travels inside a
 * sealed `flow` handle. For SSO/EMU enterprises, the Microsoft Entra ID
 * sign-in happens on GitHub's verification page.
 */

const GITHUB_WEB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "read:user";

interface FlowState {
  deviceCode: string;
  exp: number;
}

export interface DeviceFlowStart {
  flow: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowPoll =
  | { status: "pending"; interval?: number }
  | { status: "slow_down"; interval: number }
  | { status: "complete"; token: string; login: string }
  | { status: "expired" | "denied"; message: string };

type Fetch = typeof fetch;

async function postForm(fetchImpl: Fetch, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    throw new LlmError("upstream", `GitHub sign-in request failed (${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function startDeviceFlow(clientId: string, fetchImpl: Fetch = fetch): Promise<DeviceFlowStart> {
  const data = await postForm(fetchImpl, `${GITHUB_WEB}/login/device/code`, { client_id: clientId, scope: SCOPE });
  if (typeof data.error === "string") {
    const hint = data.error === "device_flow_disabled" ? " Enable Device Flow in the OAuth App settings." : "";
    throw new LlmError("not_configured", `GitHub rejected the sign-in request (${data.error}).${hint}`);
  }
  const deviceCode = String(data.device_code ?? "");
  const userCode = String(data.user_code ?? "");
  const verificationUri = String(data.verification_uri ?? `${GITHUB_WEB}/login/device`);
  const expiresIn = Number(data.expires_in ?? 900);
  const interval = Number(data.interval ?? 5);
  if (!deviceCode || !userCode) {
    throw new LlmError("upstream", "GitHub returned an incomplete device-code response");
  }
  const flow = seal({ deviceCode, exp: Date.now() + expiresIn * 1000 } satisfies FlowState, "device-flow");
  return { flow, userCode, verificationUri, expiresIn, interval };
}

export async function fetchGitHubLogin(token: string, fetchImpl: Fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${GITHUB_API}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "DiagramAgent",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 401) throw new LlmError("unauthenticated", "GitHub token is invalid or expired.");
  if (!response.ok) throw new LlmError("upstream", `GitHub user lookup failed (${response.status})`);
  const user = (await response.json()) as { login?: string };
  if (!user.login) throw new LlmError("upstream", "GitHub user lookup returned no login");
  return user.login;
}

export async function pollDeviceFlow(clientId: string, flow: string, fetchImpl: Fetch = fetch): Promise<DeviceFlowPoll> {
  const state = unseal<FlowState>(flow, "device-flow");
  if (!state || typeof state.deviceCode !== "string") {
    throw new LlmError("bad_request", "Unknown or tampered sign-in request. Start again.");
  }
  if (state.exp <= Date.now()) {
    return { status: "expired", message: "The sign-in code expired. Start again." };
  }

  const data = await postForm(fetchImpl, `${GITHUB_WEB}/login/oauth/access_token`, {
    client_id: clientId,
    device_code: state.deviceCode,
    grant_type: DEVICE_GRANT,
  });

  if (typeof data.access_token === "string" && data.access_token) {
    const login = await fetchGitHubLogin(data.access_token, fetchImpl);
    return { status: "complete", token: data.access_token, login };
  }

  switch (data.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down", interval: Number(data.interval ?? 10) };
    case "expired_token":
      return { status: "expired", message: "The sign-in code expired. Start again." };
    case "access_denied":
      return { status: "denied", message: "Sign-in was cancelled on GitHub." };
    default:
      throw new LlmError("upstream", `GitHub sign-in failed (${String(data.error ?? "unknown error")})`);
  }
}
