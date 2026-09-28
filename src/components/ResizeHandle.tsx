"use client";

import { useRef } from "react";
import { cn } from "./ui/primitives";

/** Vertical splitter; reports horizontal drag deltas. Arrow keys resize by 16px. */
export default function ResizeHandle({ onResize, label, className }: { onResize: (deltaX: number) => void; label: string; className?: string }) {
  const last = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        last.current = e.clientX;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (last.current === null) return;
        const dx = e.clientX - last.current;
        last.current = e.clientX;
        if (dx !== 0) onResize(dx);
      }}
      onPointerUp={() => (last.current = null)}
      onPointerCancel={() => (last.current = null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(-16);
        else if (e.key === "ArrowRight") onResize(16);
        else return;
        e.preventDefault();
      }}
      className={cn(
        "group relative z-10 w-px shrink-0 cursor-col-resize bg-zinc-200 outline-none dark:bg-zinc-800",
        "after:absolute after:inset-y-0 after:-left-1.5 after:w-3 after:content-['']",
        "hover:bg-indigo-400 focus-visible:bg-indigo-500 dark:hover:bg-indigo-500",
        className,
      )}
    />
  );
}
