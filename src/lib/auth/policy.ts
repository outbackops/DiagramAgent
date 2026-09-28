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

/** GitHub OAuth App client ID used for the in-app device-code sign-in. */
export function deviceFlowClientId(): string | null {
  return process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || null;
}

export function deviceFlowEnabled(): boolean {
  return deviceFlowClientId() !== null;
}
