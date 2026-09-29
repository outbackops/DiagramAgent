"use client";

import { useCallback, useState } from "react";
import { Check, HelpCircle, Sparkles } from "lucide-react";
import { Button, cn } from "./ui/primitives";

export interface ClarifyQuestion {
  id: string;
  question: string;
  rationale?: string | null;
  type: "single" | "multi";
  options: { label: string; value: string }[];
}

export interface ClarifyAnswers {
  [questionId: string]: string | string[];
}

interface ClarifyPanelProps {
  questions: ClarifyQuestion[];
  onSubmit: (answers: ClarifyAnswers) => void;
  onSkip: () => void;
  isSubmitting?: boolean;
}

const isOtherValue = (value: string) => value.toLowerCase() === "other";

export default function ClarifyPanel({ questions, onSubmit, onSkip, isSubmitting = false }: ClarifyPanelProps) {
  const [answers, setAnswers] = useState<ClarifyAnswers>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  const clearOther = (qId: string) =>
    setOtherTexts((prev) => {
      if (!(qId in prev)) return prev;
      const next = { ...prev };
      delete next[qId];
      return next;
    });

  const handleSingleSelect = useCallback((qId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
    if (!isOtherValue(value)) clearOther(qId);
  }, []);

  const handleMultiToggle = useCallback(
    (qId: string, value: string) => {
      const wasSelected = ((answers[qId] as string[]) || []).includes(value);
      setAnswers((prev) => {
        const current = (prev[qId] as string[]) || [];
        return { ...prev, [qId]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
      });
      if (wasSelected && isOtherValue(value)) clearOther(qId);
    },
    [answers],
  );

  const handleSubmit = useCallback(() => {
    const merged: ClarifyAnswers = { ...answers };
    for (const [qId, text] of Object.entries(otherTexts)) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const current = merged[qId];
      if (typeof current === "string" && isOtherValue(current)) {
        merged[qId] = `other: ${trimmed}`;
      } else if (Array.isArray(current) && current.some(isOtherValue)) {
        merged[qId] = current.map((v) => (isOtherValue(v) ? `other: ${trimmed}` : v));
      }
    }
    onSubmit(merged);
  }, [answers, otherTexts, onSubmit]);

  const answeredCount = Object.values(answers).filter((v) => (typeof v === "string" ? v.trim().length > 0 : v.length > 0)).length;

  const isOtherSelected = (qId: string): boolean => {
    const v = answers[qId];
    if (typeof v === "string") return isOtherValue(v);
    if (Array.isArray(v)) return v.some(isOtherValue);
    return false;
  };

  const isSelected = (q: ClarifyQuestion, value: string) =>
    q.type === "single" ? answers[q.id] === value : ((answers[q.id] as string[]) || []).includes(value);

  return (
    <section
      aria-label="Clarifying questions"
      className="animate-slide-up overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-b from-indigo-50/80 to-white shadow-sm dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-zinc-900"
    >
      <header className="flex items-center gap-2 border-b border-indigo-100 px-4 py-3 dark:border-indigo-500/10">
        <span className="flex size-6 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <HelpCircle className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">A few quick questions</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Answer what matters — skip the rest.</p>
        </div>
        <span className="text-[11px] font-medium tabular-nums text-indigo-600 dark:text-indigo-300">
          {answeredCount}/{questions.length}
        </span>
      </header>

      <ol className="space-y-4 px-4 py-4">
        {questions.map((q, idx) => (
          <li key={q.id} className="space-y-2">
            <div>
              <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">
                <span className="mr-1.5 text-zinc-400">{idx + 1}.</span>
                {q.question}
                {q.type === "multi" && <span className="ml-1.5 text-[11px] font-normal text-zinc-400">(pick any)</span>}
              </p>
              {q.rationale && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{q.rationale}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5" role={q.type === "single" ? "radiogroup" : "group"} aria-label={q.question}>
              {q.options.map((opt) => {
                const selected = isSelected(q, opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role={q.type === "single" ? "radio" : "checkbox"}
                    aria-checked={selected}
                    disabled={isSubmitting}
                    onClick={() => (q.type === "single" ? handleSingleSelect(q.id, opt.value) : handleMultiToggle(q.id, opt.value))}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:cursor-not-allowed disabled:opacity-50",
                      selected
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-indigo-300 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-indigo-400/60 dark:hover:text-indigo-200",
                    )}
                  >
                    {selected && q.type === "multi" && <Check className="size-3" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {isOtherSelected(q.id) && (
              <input
                type="text"
                value={otherTexts[q.id] || ""}
                onChange={(e) => setOtherTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Please specify…"
                aria-label={`Other answer for: ${q.question}`}
                disabled={isSubmitting}
                autoFocus
                className="w-full rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 dark:border-indigo-500/40 dark:bg-zinc-800 dark:text-zinc-200"
              />
            )}
          </li>
        ))}
      </ol>

      <footer className="flex items-center gap-2 border-t border-indigo-100 bg-white/60 px-4 py-3 dark:border-indigo-500/10 dark:bg-zinc-900/60">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={answeredCount === 0}
          loading={isSubmitting}
          icon={<Sparkles className="size-3.5" />}
        >
          Generate diagram
        </Button>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={isSubmitting}>
          Skip questions
        </Button>
      </footer>
    </section>
  );
}
