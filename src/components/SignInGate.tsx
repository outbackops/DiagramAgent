"use client";

import { AlertTriangle, LogIn, RefreshCw, TerminalSquare } from "lucide-react";
import type { AuthStatusResponse } from "@/lib/api/types";
import { Button } from "./ui/primitives";

export default function SignInGate({
  auth,
  error,
  loading,
  onSignIn,
  onRetry,
}: {
  auth: AuthStatusResponse | null;
  error: string | null;
  loading: boolean;
  onSignIn: () => void;
  onRetry: () => void;
}) {
  const deviceFlow = auth?.deviceFlow.enabled ?? false;
  const machineAllowed = auth?.machine.allowed ?? false;

  return (
    <div className="animate-fade-in px-1 pt-6">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
        <svg viewBox="0 0 16 16" className="size-5" fill="currentColor" aria-hidden>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Connect GitHub Copilot</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        DiagramAgent runs on the GitHub Copilot models your GitHub account can use — Claude, GPT and more — with no API keys. If your organization uses
        Microsoft Entra ID single sign-on, you sign in through GitHub as usual.
      </p>

      {(error || auth?.machine.error || auth?.configError) && (
        <p className="mt-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error ?? auth?.configError ?? auth?.machine.error}</span>
        </p>
      )}

      <div className="mt-5 space-y-3">
        {deviceFlow && (
          <Button variant="primary" size="md" className="w-full" icon={<LogIn className="size-4" />} onClick={onSignIn}>
            Sign in with GitHub
          </Button>
        )}

        {machineAllowed && (
          <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
              <TerminalSquare className="size-4 text-zinc-400" />
              {deviceFlow ? "Or sign in on this machine" : "Sign in on this machine"}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Run one of these in a terminal on the computer running DiagramAgent, then retry:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed text-zinc-100">
              gh auth login --web{"\n"}# or{"\n"}copilot login
            </pre>
            <Button variant="secondary" size="sm" className="mt-3" loading={loading} icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
              I&apos;ve signed in — retry
            </Button>
          </div>
        )}

        {!deviceFlow && !machineAllowed && auth && (
          <p className="rounded-xl border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            Sign-in isn&apos;t configured on this server. An operator needs to set <code className="font-mono">GITHUB_OAUTH_CLIENT_ID</code> (in-app GitHub
            sign-in) or <code className="font-mono">DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN=true</code> for single-user use.
          </p>
        )}
      </div>
    </div>
  );
}
