"use client";

import { Check, Copy, Lock, PanelRightClose } from "lucide-react";
import { useState } from "react";
import type { RunRecord } from "@/hooks/useDiagramAgent";
import type { CatalogModel } from "@/lib/llm/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import CodeEditor from "./CodeEditor";
import QualityPanel from "./QualityPanel";
import ReviewPanel from "./ReviewPanel";
import { IconButton, cn } from "./ui/primitives";

export type InspectorTab = "code" | "quality" | "review";

export default function Inspector({
  tab,
  onTabChange,
  onClose,
  code,
  onCodeChange,
  readOnly,
  theme,
  quality,
  qualityLoading,
  run,
  models,
  reviewEnabled,
}: {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  code: string;
  onCodeChange: (code: string) => void;
  readOnly: boolean;
  theme: "light" | "dark";
  quality: QualityReport | null;
  qualityLoading: boolean;
  run: RunRecord | null;
  models: CatalogModel[];
  reviewEnabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const tabs: Array<{ id: InspectorTab; label: string; badge?: string }> = [
    { id: "code", label: "Code" },
    { id: "quality", label: "Quality", badge: quality ? String(quality.score) : undefined },
    { id: "review", label: "Review", badge: run?.reviewScore !== undefined ? `${run.reviewScore}/10` : undefined },
  ];

  return (
    <aside className="flex h-full min-w-0 flex-col bg-white dark:bg-zinc-900" aria-label="Inspector">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800">
        <div role="tablist" aria-label="Inspector views" className="flex items-center gap-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTabChange(t.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70",
                tab === t.id
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
              )}
            >
              {t.label}
              {t.badge && <span className="rounded bg-white px-1 text-[10px] tabular-nums text-zinc-500 shadow-sm dark:bg-zinc-700 dark:text-zinc-300">{t.badge}</span>}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {tab === "code" && (
            <>
              {readOnly && (
                <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                  <Lock className="size-3" /> Locked while generating
                </span>
              )}
              <IconButton
                label={copied ? "Copied" : "Copy code"}
                size="sm"
                disabled={!code}
                onClick={() => {
                  void navigator.clipboard.writeText(code).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </IconButton>
            </>
          )}
          <IconButton label="Hide inspector" size="sm" onClick={onClose}>
            <PanelRightClose className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === "code" && <CodeEditor code={code} onChange={onCodeChange} readOnly={readOnly} theme={theme} />}
        {tab === "quality" && <QualityPanel quality={quality} loading={qualityLoading} />}
        {tab === "review" && <ReviewPanel run={run} models={models} reviewEnabled={reviewEnabled} />}
      </div>
    </aside>
  );
}
