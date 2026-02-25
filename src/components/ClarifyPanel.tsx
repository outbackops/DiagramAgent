"use client";

import { useState, useCallback } from "react";

export interface ClarifyQuestion {
  id: string;
  question: string;
  type: "single" | "multi" | "freetext";
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

export default function ClarifyPanel({
  questions,
  onSubmit,
  onSkip,
  isSubmitting = false,
}: ClarifyPanelProps) {
  const [answers, setAnswers] = useState<ClarifyAnswers>({});

  const handleSingleSelect = useCallback((qId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  }, []);

  const handleMultiToggle = useCallback((qId: string, value: string) => {
    setAnswers((prev) => {
      const current = (prev[qId] as string[]) || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [qId]: next };
    });
  }, []);

  const handleFreetext = useCallback((qId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(answers);
  }, [answers, onSubmit]);

  const answeredCount = Object.keys(answers).filter((k) => {
    const v = answers[k];
    return v && (typeof v === "string" ? v.trim().length > 0 : v.length > 0);
  }).length;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>A few quick questions to refine your diagram:</span>
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {questions.map((q, idx) => (
          <div key={q.id} className="space-y-1.5">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {idx + 1}. {q.question}
            </p>

            {q.type === "single" && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSingleSelect(q.id, opt.value)}
                      disabled={isSubmitting}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400"
                      } ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "multi" && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => {
                  const selected = ((answers[q.id] as string[]) || []).includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleMultiToggle(q.id, opt.value)}
                      disabled={isSubmitting}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400"
                      } ${isSubmitting ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {selected && (
                        <svg className="w-3 h-3 inline mr-0.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === "freetext" && (
              <input
                type="text"
                value={(answers[q.id] as string) || ""}
                onChange={(e) => handleFreetext(q.id, e.target.value)}
                placeholder="Type your answer..."
                disabled={isSubmitting}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50"
              />
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
        >
          {isSubmitting ? (
            <>
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Diagram
              {answeredCount > 0 && (
                <span className="ml-0.5 text-blue-200">({answeredCount}/{questions.length})</span>
              )}
            </>
          )}
        </button>

        <button
          onClick={onSkip}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
        >
          Skip &amp; generate directly
        </button>
      </div>
    </div>
  );
}
