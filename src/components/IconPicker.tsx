"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, Spinner, cn } from "./ui/primitives";

type IconManifest = Record<string, { local: string; label: string; category: string }>;

let manifestPromise: Promise<IconManifest> | null = null;

function loadManifest(): Promise<IconManifest> {
  manifestPromise ??= fetch("/icons/manifest.json").then((res) => {
    if (!res.ok) throw new Error("Couldn't load icons");
    return res.json() as Promise<IconManifest>;
  });
  return manifestPromise;
}

export default function IconPicker({
  value,
  onSelect,
  allowNone = false,
  autoFocus = false,
}: {
  value?: string;
  onSelect: (icon: string | undefined) => void;
  allowNone?: boolean;
  autoFocus?: boolean;
}) {
  const [manifest, setManifest] = useState<IconManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void loadManifest()
      .then((next) => {
        if (active) setManifest(next);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const items = useMemo(() => {
    const all = Object.entries(manifest ?? {}).map(([key, icon]) => ({ key, ...icon }));
    const needle = query.trim().toLowerCase();
    if (!needle) return all.slice(0, 80);
    return all.filter((icon) => `${icon.key} ${icon.label} ${icon.category}`.toLowerCase().includes(needle)).slice(0, 80);
  }, [manifest, query]);

  return (
    <div className="w-72 p-2" aria-label="Icon picker">
      <label className="relative block">
        <span className="sr-only">Search icons</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons"
          className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-[13px] text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
      </label>
      {allowNone && (
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={() => onSelect(undefined)} icon={<X className="size-3.5" />}>
          No icon
        </Button>
      )}
      {!manifest && !error && (
        <div className="flex h-32 items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
      {manifest && (
        <div className="scroll-thin mt-2 grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
          {items.map((icon) => (
            <button
              key={icon.key}
              type="button"
              onClick={() => onSelect(icon.local)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(icon.local);
              }}
              aria-label={icon.label}
              title={`${icon.label} · ${icon.category}`}
              className={cn(
                "flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border p-1.5 text-center text-[10px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70",
                value === icon.local
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon.local} alt="" className="size-7 object-contain" />
              <span className="line-clamp-2">{icon.label}</span>
            </button>
          ))}
          {items.length === 0 && <p className="col-span-3 p-4 text-center text-xs text-zinc-400">No icons found.</p>}
        </div>
      )}
    </div>
  );
}
