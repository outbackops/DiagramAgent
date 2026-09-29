"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Dialog } from "./ui/Dialog";
import { Button, Spinner } from "./ui/primitives";

export default function ImportD2Dialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (code: string, signal: AbortSignal) => Promise<string[]>;
}) {
  const [code, setCode] = useState("");
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<AbortController | null>(null);

  // Closing (Cancel, Esc, backdrop) while an import runs cancels it, so it can't replace the diagram afterwards.
  useEffect(() => {
    if (open) return;
    pending.current?.abort();
    pending.current = null;
  }, [open]);

  useEffect(() => {
    if (open) {
      setWarnings(null);
      setError(null);
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open]);

  const importCode = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      const nextWarnings = await onImport(code, controller.signal);
      if (!controller.signal.aborted) setWarnings(nextWarnings);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import a diagram"
      description="Paste a composition spec (JSON) or D2 source to replace the current diagram. The import is one undoable step."
      className="max-w-2xl"
      footer={
        warnings ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={importCode} disabled={!code.trim() || loading} icon={loading ? <Spinner className="size-3.5" /> : undefined}>Import</Button>
          </>
        )
      }
    >
      {warnings ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" /> Import complete
          </div>
          {warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Warnings</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-100">
                {warnings.map((warning, i) => <li key={i}>• {warning}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No warnings.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Diagram source"
            className="h-72 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            placeholder={'{ "title": "…", "columns": [ … ] }   or   x -> y'}
          />
          {error && (
            <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
