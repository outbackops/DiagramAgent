"use client";

import { Monitor, Moon, PanelLeft, PanelRight, Plus, Sun } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemePreference } from "@/hooks/useTheme";
import { IconButton, Spinner, cn } from "./ui/primitives";

export function Logo() {
  return (
    <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm shadow-indigo-500/30">
      <svg viewBox="0 0 24 24" className="size-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <path d="M10 6.5h3.5a2 2 0 0 1 2 2V14" />
      </svg>
    </span>
  );
}

const THEME_ICON: Record<ThemePreference, ReactNode> = {
  system: <Monitor className="size-4" />,
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
};

export default function TopBar({
  title,
  onTitleChange,
  status,
  theme,
  onCycleTheme,
  sidebarOpen,
  onToggleSidebar,
  inspectorOpen,
  onToggleInspector,
  onNew,
  newDisabled,
  controls,
  account,
}: {
  title: string;
  onTitleChange: (title: string) => void;
  status: string | null;
  theme: ThemePreference;
  onCycleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onNew: () => void;
  newDisabled?: boolean;
  controls: ReactNode;
  account: ReactNode;
}) {
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white/85 px-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85">
      <div className="flex items-center gap-2 pr-1">
        <Logo />
        <span className="hidden text-sm font-semibold tracking-tight text-zinc-900 sm:inline dark:text-zinc-50">DiagramAgent</span>
      </div>
      <span className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <IconButton label={sidebarOpen ? "Hide conversation (Ctrl+B)" : "Show conversation (Ctrl+B)"} onClick={onToggleSidebar}>
        <PanelLeft className="size-4" />
      </IconButton>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={(e) => !e.target.value.trim() && onTitleChange("Untitled diagram")}
        aria-label="Diagram title"
        spellCheck={false}
        className="h-8 w-36 min-w-0 rounded-lg bg-transparent px-2 text-[13px] font-medium text-zinc-700 outline-none transition-colors hover:bg-zinc-100 focus:bg-zinc-100 focus:ring-2 focus:ring-indigo-500/30 lg:w-56 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
      />
      {status && (
        <span
          aria-live="polite"
          className="hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 xl:inline-flex dark:bg-indigo-500/10 dark:text-indigo-300"
        >
          <Spinner className="size-3" />
          {status}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {controls}
        <IconButton label={`Theme: ${theme} (click to change)`} onClick={onCycleTheme}>
          {THEME_ICON[theme]}
        </IconButton>
        <IconButton label={inspectorOpen ? "Hide inspector (Ctrl+.)" : "Show inspector (Ctrl+.)"} onClick={onToggleInspector}>
          <PanelRight className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <button
          type="button"
          onClick={onNew}
          disabled={newDisabled}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800",
          )}
        >
          <Plus className="size-4" />
          <span className="hidden lg:inline">New</span>
        </button>
        {account}
      </div>
    </header>
  );
}
