"use client";

import { Eye, ListChecks, Puzzle, Wand2, Wrench } from "lucide-react";
import type { RunRecord } from "@/hooks/useDiagramAgent";
import type { CatalogModel } from "@/lib/llm/types";
import type { ReviewAssessment } from "@/lib/pipeline/refine-loop";
import { modelLabel } from "./RunCard";
import { ScoreRing } from "./QualityPanel";
import { Badge, Button } from "./ui/primitives";

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        {icon}
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReviewPanel({
  run,
  models,
  reviewEnabled,
  canApply = false,
  onApply,
}: {
  run: RunRecord | null;
  models: CatalogModel[];
  reviewEnabled: boolean;
  canApply?: boolean;
  onApply?: (assessment: ReviewAssessment) => void;
}) {
  const reviews = run?.reviews ?? [];
  // Show the review of the version on the canvas (the kept round), not simply the latest one.
  const latest = reviews.find((r) => r.round === run?.bestRound) ?? reviews[reviews.length - 1];

  if (!latest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-zinc-400">
        <Eye className="size-6" />
        <p className="max-w-64 text-[13px]">
          {reviewEnabled
            ? run?.status === "running"
              ? "The reviewer looks at the rendered image once the first draft is ready."
              : "After each generation, a vision model inspects the rendered diagram and its findings show up here."
            : "Vision review is turned off in Generation settings."}
        </p>
      </div>
    );
  }

  const a = latest.assessment;
  const keptLabel =
    reviews.length > 1 && run?.bestRound !== undefined
      ? `Showing the ${latest.round === 0 ? "first draft" : `round ${latest.round}`} review — the version on the canvas.`
      : null;

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={a.score * 10} label={`${a.score}/10`} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Vision review
            <Badge tone={a.pass ? "green" : "amber"}>{a.pass ? "Passed" : "Needs work"}</Badge>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">by {modelLabel(run?.reviewer, models)}</p>
          {keptLabel && <p className="mt-0.5 text-[11px] text-zinc-400">{keptLabel}</p>}
        </div>
      </div>

      {a.reasoning && <p className="mt-4 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">{a.reasoning}</p>}
      {onApply && (a.layout_issues?.length || a.specific_fixes?.length || a.missing_components?.length) ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-3"
          icon={<Wand2 className="size-3.5" />}
          disabled={!canApply}
          onClick={() => onApply(a)}
          title="Run another refinement round using these findings"
        >
          Apply suggested fixes
        </Button>
      ) : null}
      <Section icon={<Puzzle className="size-3.5 text-rose-500" />} title="Missing components" items={a.missing_components} />
      <Section icon={<ListChecks className="size-3.5 text-amber-500" />} title="Layout issues" items={a.layout_issues} />
      <Section icon={<Wrench className="size-3.5 text-indigo-500" />} title="Suggested fixes" items={a.specific_fixes} />

      {reviews.length > 1 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Rounds</p>
          <ol className="mt-2 space-y-1.5">
            {reviews.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-zinc-500">{r.round === 0 ? "Draft" : `Round ${r.round}`}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <span
                    className={r.assessment.pass ? "block h-full rounded-full bg-emerald-500" : "block h-full rounded-full bg-amber-500"}
                    style={{ width: `${Math.max(4, r.assessment.score * 10)}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{r.assessment.score}/10</span>
                <span className="w-9 shrink-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{r.round === run?.bestRound ? "kept" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
