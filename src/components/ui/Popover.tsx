"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./primitives";

/**
 * Minimal anchored popover: click the trigger to toggle; outside click or
 * Escape closes it and returns focus to the trigger.
 */
export function Popover({
  trigger,
  children,
  align = "end",
  className,
  panelClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        (rootRef.current?.querySelector("[aria-haspopup]") as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {trigger({ open, toggle, id })}
      {open && (
        <div
          id={id}
          role="dialog"
          className={cn(
            "absolute top-full z-50 mt-2 animate-slide-up rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10",
            "dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  disabled,
  hint,
  danger,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
        "focus-visible:outline-none focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800",
        "disabled:cursor-not-allowed disabled:opacity-50",
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
      )}
    >
      {icon && <span className="flex size-4 items-center justify-center text-zinc-400">{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
    </button>
  );
}
