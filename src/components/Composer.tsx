"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Kbd, cn } from "./ui/primitives";

export interface ComposerHandle {
  focus: () => void;
  setValue: (text: string) => void;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  status?: string;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ onSend, onStop, running, disabled = false, placeholder, status }, ref) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (text: string) => {
      setValue(text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }));

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    // Don't pull focus out of an open modal (e.g. the confirm dialog) when a run finishes.
    if (!running && !disabled && !document.querySelector('[aria-modal="true"]')) textareaRef.current?.focus();
  }, [running, disabled]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || running || disabled) return;
    onSend(text);
    setValue("");
  }, [disabled, onSend, running, value]);

  const canSend = value.trim().length > 0 && !running && !disabled;

  return (
    <div className="border-t border-zinc-200 bg-white/80 px-3 pb-3 pt-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      {status && (
        <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-indigo-600 dark:text-indigo-300" aria-live="polite">
          <span className="size-1.5 animate-pulse-soft rounded-full bg-indigo-500" />
          {status}
        </p>
      )}
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm transition-colors dark:bg-zinc-950",
          "border-zinc-200 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:border-zinc-700 dark:focus-within:border-indigo-500/60",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          disabled={disabled}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating (Esc)"
            title="Stop generating (Esc)"
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-zinc-400">
        <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line · <Kbd>Esc</Kbd> to stop
      </p>
    </div>
  );
});

export default Composer;
