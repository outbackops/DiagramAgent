"use client";

import { Check, Copy, Download, PanelRightClose, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { RunRecord } from "@/hooks/useDiagramAgent";
import type { CatalogModel } from "@/lib/llm/types";
import type { ReviewAssessment } from "@/lib/pipeline/refine-loop";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import CodeEditor from "./CodeEditor";
import ImportD2Dialog from "./ImportD2Dialog";
import QualityPanel from "./QualityPanel";
import ReviewPanel from "./ReviewPanel";
import { Button, IconButton, Segmented, cn } from "./ui/primitives";

export type InspectorTab = "code" | "quality" | "review";
type CodeKind = "spec" | "d2" | "mermaid";

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Inspector({
  tab,
  onTabChange,
  onClose,
  d2,
  spec,
  mermaid,
  streamingCode,
  theme,
  quality,
  qualityLoading,
  run,
  models,
  reviewEnabled,
  canApplyReview,
  onApplyReview,
  onImportD2,
  importDisabled,
}: {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onClose: () => void;
  d2: string;
  /** Composition spec of a composed diagram (or one streaming in); null for graph diagrams. */
  spec?: string | null;
  mermaid: string;
  streamingCode: string | null;
  theme: "light" | "dark";
  quality: QualityReport | null;
  qualityLoading: boolean;
  run: RunRecord | null;
  models: CatalogModel[];
  reviewEnabled: boolean;
  canApplyReview: boolean;
  onApplyReview: (assessment: ReviewAssessment) => void;
  onImportD2(code: string, signal: AbortSignal): Promise<string[]>;
  importDisabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [chosenKind, setCodeKind] = useState<CodeKind>("spec");
  const [importOpen, setImportOpen] = useState(false);
  const tabs: Array<{ id: InspectorTab; label: string; badge?: string }> = [
    { id: "code", label: "Code" },
    { id: "quality", label: "Quality", badge: quality ? String(quality.score) : undefined },
    { id: "review", label: "Review", badge: run?.reviewScore !== undefined ? `${run.reviewScore}/10` : undefined },
  ];
  const hasSpec = spec !== null && spec !== undefined;
  // Graph diagrams have no spec; fall back to D2 without forgetting the choice.
  const codeKind: CodeKind = chosenKind === "spec" && !hasSpec ? "d2" : chosenKind;
  const streamingSpec = streamingCode !== null && streamingCode.trimStart().startsWith("{");
  const displayedCode = useMemo(() => {
    if (codeKind === "spec") return streamingSpec ? streamingCode! : (spec ?? "");
    if (codeKind === "d2") return streamingCode !== null && !streamingSpec ? streamingCode : d2;
    return mermaid;
  }, [codeKind, d2, mermaid, spec, streamingCode, streamingSpec]);
  const extension = codeKind === "spec" ? "json" : codeKind === "d2" ? "d2" : "mmd";
  const kindOptions: Array<{ value: CodeKind; label: string }> = [
    ...(hasSpec ? [{ value: "spec" as const, label: "Spec" }] : []),
    { value: "d2", label: "D2" },
    { value: "mermaid", label: "Mermaid" },
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
                tab === t.id ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
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
              <Segmented<CodeKind> ariaLabel="Code export" value={codeKind} onChange={setCodeKind} options={kindOptions} size="xs" />
              <IconButton label={copied ? "Copied" : `Copy ${codeKind}`} size="sm" disabled={!displayedCode} onClick={() => { void navigator.clipboard.writeText(displayedCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </IconButton>
              <IconButton label={`Download ${codeKind}`} size="sm" disabled={!displayedCode} onClick={() => downloadText(displayedCode, `diagram.${extension}`)}><Download className="size-3.5" /></IconButton>
            </>
          )}
          <IconButton label="Hide inspector" size="sm" onClick={onClose}><PanelRightClose className="size-4" /></IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        {tab === "code" && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <p className="min-w-0 flex-1">
                {codeKind === "spec"
                  ? "The composition spec AI edits work on; it follows your edits on the canvas."
                  : "Edit the diagram on the canvas or in chat; this code is generated from it."}
              </p>
              <Button variant="secondary" size="xs" disabled={importDisabled} onClick={() => setImportOpen(true)} icon={<Upload className="size-3" />}>Import...</Button>
            </div>
            <div className="min-h-0 flex-1"><CodeEditor code={displayedCode} onChange={() => {}} readOnly theme={theme} language={codeKind === "spec" ? "json" : codeKind === "d2" ? "d2" : "plaintext"} /></div>
            <ImportD2Dialog open={importOpen} onClose={() => setImportOpen(false)} onImport={onImportD2} />
          </div>
        )}
        {tab === "quality" && <QualityPanel quality={quality} loading={qualityLoading} />}
        {tab === "review" && <ReviewPanel run={run} models={models} reviewEnabled={reviewEnabled} canApply={canApplyReview} onApply={onApplyReview} />}
      </div>
    </aside>
  );
}
