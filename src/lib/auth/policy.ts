/**
 * Who may use which identity. Kept dependency-free so both the LLM providers
 * and the auth routes can import it.
 */

function envFlag(name: string): boolean | null {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}

/**
 * Whether requests without an in-app sign-in may run as the GitHub account
 * that is signed in on the server machine (gh CLI / `copilot login`).
 *
 * Defaults to on for `next dev` and off for production builds, so a hosted
 * deployment never lends the host's Copilot seat to anonymous visitors.
 */
export function machineLoginAllowed(): boolean {
  return envFlag("DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN") ?? process.env.NODE_ENV !== "production";
}

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.DIAGRAM_AGENT_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostName(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTrustedHost(hostname: string | null): boolean {
  if (!hostname) return false;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || allowedHosts().has(hostname);
}

export function isLoopbackRequest(request: Request): boolean {
  let urlHost: string | null = null;
  try {
    urlHost = new URL(request.url).host;
  } catch {
    urlHost = null;
  }
  const requestHost = hostName(request.headers.get("host") ?? urlHost);
  if (!isTrustedHost(requestHost)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return isTrustedHost(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Machine login for this request: enabled by config and addressed to a loopback
 * (or allow-listed) host, so a page reached through a LAN address or a rebinding
 * DNS name can't borrow the host's GitHub session.
 */
export function machineLoginAllowedFor(request: Request): boolean {
  return machineLoginAllowed() && isLoopbackRequest(request);
}

/** GitHub OAuth App client ID used for the in-app device-code sign-in. */
export function deviceFlowClientId(): string | null {
  return process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || null;
}

export function deviceFlowEnabled(): boolean {
  return deviceFlowClientId() !== null;
}
