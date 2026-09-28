"use client";

import { useState } from "react";
import { ExternalLink, LogIn, LogOut, Monitor, RefreshCw, UserRound } from "lucide-react";
import type { AuthStatusResponse } from "@/lib/api/types";
import { MenuItem, Popover } from "./ui/Popover";
import { Button, cn } from "./ui/primitives";

export function Avatar({ login, size = 24 }: { login: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!login || failed) {
    return (
      <span
        className="flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 font-semibold text-white"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-hidden
      >
        {login ? login[0]!.toUpperCase() : <UserRound className="size-3.5" />}
      </span>
    );
  }
  return (
    // GitHub avatars are external; next/image would need remote config for no benefit here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size * 2}`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-full ring-1 ring-zinc-200 dark:ring-zinc-700"
    />
  );
}

export default function AccountMenu({
  auth,
  onSignIn,
  onSignOut,
  onRefresh,
}: {
  auth: AuthStatusResponse | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefresh: () => void;
}) {
  if (!auth?.signedIn) {
    return auth?.deviceFlow.enabled ? (
      <Button variant="primary" size="sm" icon={<LogIn className="size-3.5" />} onClick={onSignIn}>
        Sign in
      </Button>
    ) : null;
  }

  const viaMachine = auth.source === "machine";
  return (
    <Popover
      align="end"
      panelClassName="w-72 p-1.5"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={`Account: ${auth.login}`}
          className={cn(
            "flex h-8 items-center gap-2 rounded-lg px-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70",
            open && "bg-zinc-100 dark:bg-zinc-800",
          )}
        >
          <Avatar login={auth.login} />
          <span className="hidden max-w-32 truncate text-[13px] font-medium text-zinc-700 xl:inline dark:text-zinc-200">{auth.login}</span>
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar login={auth.login} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">@{auth.login}</p>
              <p className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                {viaMachine ? <Monitor className="size-3" /> : <LogIn className="size-3" />}
                {viaMachine ? "Signed in on this machine (GitHub CLI)" : "Signed in with GitHub"}
              </p>
            </div>
          </div>
          <p className="px-2.5 pb-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            Models come from this account&apos;s GitHub Copilot plan. For Entra ID–federated organizations, access follows your enterprise SSO.
          </p>
          <div className="border-t border-zinc-100 pt-1 dark:border-zinc-800">
            {auth.deviceFlow.enabled && (
              <MenuItem
                icon={<LogIn className="size-3.5" />}
                onSelect={() => {
                  close();
                  onSignIn();
                }}
              >
                {viaMachine ? "Sign in with GitHub instead" : "Switch account"}
              </MenuItem>
            )}
            <MenuItem
              icon={<RefreshCw className="size-3.5" />}
              onSelect={() => {
                close();
                onRefresh();
              }}
            >
              Refresh models
            </MenuItem>
            <MenuItem icon={<ExternalLink className="size-3.5" />} onSelect={() => window.open("https://github.com/settings/copilot", "_blank", "noopener,noreferrer")}>
              Copilot settings
            </MenuItem>
            {!viaMachine && (
              <MenuItem
                danger
                icon={<LogOut className="size-3.5" />}
                onSelect={() => {
                  close();
                  onSignOut();
                }}
              >
                Sign out
              </MenuItem>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}
