"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Box, Link2, Trash2, X } from "lucide-react";
import { IconButton } from "./ui/primitives";

export interface SelectedElement {
  path: string;
  isConnection: boolean;
  connectionFrom?: string;
  connectionTo?: string;
  label?: string;
}

interface ElementEditorProps {
  selected: SelectedElement | null;
  /** Whether we're waiting for the user to pick a second node for a new connection */
  connectMode: boolean;
  onUpdateLabel: (path: string, newLabel: string, isConnection: boolean) => void;
  onDelete: (path: string, isConnection: boolean) => void;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  onDeselect: () => void;
}

export default function ElementEditor({ selected, connectMode, onUpdateLabel, onDelete, onStartConnect, onCancelConnect, onDeselect }: ElementEditorProps) {
  const [labelValue, setLabelValue] = useState("");
  // Set before a programmatic blur so onBlur doesn't save again (Enter) or save a discarded edit (Esc).
  const skipBlurSave = useRef(false);

  // Reset the draft label whenever a different element is selected.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelValue(selected?.label || "");
  }, [selected]);

  const save = useCallback(() => {
    if (skipBlurSave.current) {
      skipBlurSave.current = false;
      return;
    }
    if (selected && labelValue.trim() && labelValue.trim() !== (selected.label ?? "")) {
      onUpdateLabel(selected.path, labelValue.trim(), selected.isConnection);
    }
  }, [labelValue, onUpdateLabel, selected]);

  if (connectMode) {
    return (
      <div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 animate-slide-up items-center gap-3 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] text-white shadow-lg">
        <span className="size-2 animate-pulse-soft rounded-full bg-white" />
        Click the target node to connect
        <button type="button" onClick={onCancelConnect} className="rounded-md bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25">
          Cancel
        </button>
      </div>
    );
  }

  if (!selected) return null;

  const name = selected.isConnection ? `${selected.connectionFrom} → ${selected.connectionTo}` : selected.path;

  return (
    <div className="absolute bottom-16 left-1/2 z-20 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 animate-slide-up rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          {selected.isConnection ? <ArrowRight className="size-3.5" /> : <Box className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title={name}>
          {name}
        </span>
        <IconButton label="Deselect (Esc)" size="sm" onClick={onDeselect}>
          <X className="size-3.5" />
        </IconButton>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={labelValue}
          onChange={(e) => setLabelValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
              skipBlurSave.current = true;
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              // Discard the draft; also keep the page-level Esc (deselect / stop) from firing.
              e.preventDefault();
              e.stopPropagation();
              skipBlurSave.current = true;
              setLabelValue(selected.label || "");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Label"
          aria-label="Label"
          className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {!selected.isConnection && (
          <IconButton label="Connect to another node" onClick={onStartConnect}>
            <Link2 className="size-4" />
          </IconButton>
        )}
        <IconButton label="Delete" onClick={() => onDelete(selected.path, selected.isConnection)} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10">
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {!selected.isConnection && <p className="mt-2 text-[11px] text-zinc-400">Tip: drag the selected node onto another container to move it.</p>}
    </div>
  );
}
