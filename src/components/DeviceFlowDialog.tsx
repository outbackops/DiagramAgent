"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import type { DeviceFlowStartResponse } from "@/lib/api/types";
import { api } from "@/lib/client/api";
import { Dialog } from "./ui/Dialog";
import { Button, Spinner } from "./ui/primitives";

type Phase =
  | { kind: "starting" }
  | { kind: "waiting"; start: DeviceFlowStartResponse }
  | { kind: "done"; login: string }
  | { kind: "error"; message: string };

export default function DeviceFlowDialog({ open, onClose, onSignedIn }: { open: boolean; onClose: () => void; onSignedIn: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(false);

  const stopPolling = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const begin = useCallback(async () => {
    stopPolling();
    setPhase({ kind: "starting" });
    try {
      const start = await api.startDeviceFlow();
      if (!alive.current) return;
      setPhase({ kind: "waiting", start });
      let interval = Math.max(start.interval, 5);
      const poll = async () => {
        if (!alive.current) return;
        try {
          const result = await api.pollDeviceFlow(start.flow);
          if (!alive.current) return;
          if (result.status === "complete") {
            setPhase({ kind: "done", login: result.login });
            onSignedIn();
            timer.current = setTimeout(onClose, 1200);
            return;
          }
          if (result.status === "expired" || result.status === "denied") {
            setPhase({ kind: "error", message: result.message });
            return;
          }
          if (result.status === "slow_down") interval = Math.max(result.interval, interval + 5);
        } catch (err) {
          if (!alive.current) return;
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
          return;
        }
        timer.current = setTimeout(poll, interval * 1000);
      };
      timer.current = setTimeout(poll, interval * 1000);
    } catch (err) {
      if (alive.current) setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [onClose, onSignedIn]);

  useEffect(() => {
    if (!open) return;
    alive.current = true;
    // Starting the external sign-in flow when the dialog opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void begin();
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, [open, begin]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the code is visible anyway.
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sign in with GitHub"
      description="DiagramAgent uses the GitHub Copilot models your account is entitled to."
    >
      {phase.kind === "starting" && (
        <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
          <Spinner /> Requesting a sign-in code…
        </div>
      )}

      {phase.kind === "waiting" && (
        <div className="space-y-4">
          <ol className="space-y-1.5 text-[13px] text-zinc-600 dark:text-zinc-300">
            <li>1. Copy the code below.</li>
            <li>2. Open GitHub and paste it, then approve access.</li>
          </ol>
          <div className="flex items-center justify-between rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 px-4 py-3 dark:border-indigo-500/40 dark:bg-indigo-500/10">
            <code className="font-mono text-2xl font-semibold tracking-[0.2em] text-indigo-700 dark:text-indigo-200">{phase.start.userCode}</code>
            <Button variant="secondary" size="xs" icon={<Copy className="size-3" />} onClick={() => copy(phase.start.userCode)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            icon={<ExternalLink className="size-4" />}
            onClick={() => window.open(phase.start.verificationUri, "_blank", "noopener,noreferrer")}
          >
            Open github.com/login/device
          </Button>
          <p className="flex items-start gap-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="mt-px size-3.5 shrink-0 text-emerald-500" />
            If your organization uses Microsoft Entra ID single sign-on, GitHub will route you through your Entra sign-in. The token stays on the
            server in an encrypted, HTTP-only cookie.
          </p>
          <p className="flex items-center gap-2 text-xs text-zinc-500">
            <Spinner className="size-3.5" /> Waiting for you to approve on GitHub…
          </p>
        </div>
      )}

      {phase.kind === "done" && (
        <p className="flex items-center gap-2 py-4 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-5" /> Signed in as <strong>@{phase.login}</strong>
        </p>
      )}

      {phase.kind === "error" && (
        <div className="space-y-3">
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{phase.message}</p>
          <Button variant="secondary" onClick={() => void begin()}>
            Start again
          </Button>
        </div>
      )}
    </Dialog>
  );
}
