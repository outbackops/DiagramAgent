"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Circle, Loader2, XCircle, Zap } from "lucide-react";
import type { RunRecord, RunStep } from "@/hooks/useDiagramAgent";
import type { CatalogModel, ModelSelection } from "@/lib/llm/types";
import type { PipelinePhase } from "@/lib/pipeline/refine-loop";
import { Badge, Button, cn } from "./ui/primitives";

export const PHASE_LABEL: Record<PipelinePhase, string> = {
  planning: "Planning architecture",
  generating: "Writing D2",
  rendering: "Rendering",
  reviewing: "Reviewing layout",
  refining: "Refining",
  fixing: "Fixing syntax",
};

/** Human label for a pipeline step, including the round for refine/fix passes. */
export function phaseLabel(step: Pick<RunStep, "phase" | "round">): string {
  return step.phase === "refining" || step.phase === "fixing" ? `${PHASE_LABEL[step.phase]} · round ${step.round}` : PHASE_LABEL[step.phase];
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function modelLabel(selection: ModelSelection | undefined, models: CatalogModel[]): string {
  if (!selection) return "";
  const found = models.find((m) => m.provider === selection.provider && m.id === selection.model);
  const name = found?.name ?? selection.model;
  return selection.reasoningEffort ? `${name} · ${selection.reasoningEffort}` : name;
}

function StepRow({ step, now }: { step: RunStep; now: number }) {
  const duration = (step.endedAt ?? now) - step.startedAt;
  const label = phaseLabel(step);
  return (
    <li className="flex items-center gap-2 text-xs">
      {step.status === "active" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-indigo-500" />
      ) : step.status === "failed" ? (
        <XCircle className="size-3.5 shrink-0 text-amber-500" />
      ) : (
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
      )}
      <span className={cn("shrink-0", step.status === "active" ? "font-medium text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400")}>{label}</span>
      {step.detail && <span className="min-w-0 truncate text-zinc-400 dark:text-zinc-500" title={step.detail}>— {step.detail}</span>}
      <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{formatDuration(duration)}</span>
    </li>
  );
}

const OUTCOME: Record<string, { label: string; tone: "green" | "amber" | "sky" | "rose"; title: string }> = {
  verified: { label: "Passed review", tone: "green", title: "The reviewer scored the diagram 7/10 or higher" },
  best_effort: { label: "Reviewed", tone: "amber", title: "Best version kept; see the Review tab for suggested fixes" },
  unreviewed: { label: "Not reviewed", tone: "sky", title: "Vision review was off or unavailable" },
  render_failed: { label: "Render failed", tone: "rose", title: "The generated D2 did not compile" },
};

export default function RunCard({
  run,
  models,
  onStop,
  onRetry,
}: {
  run: RunRecord;
  models: CatalogModel[];
  onStop?: () => void;
  onRetry?: (run: RunRecord) => void;
}) {
  const running = run.status === "running";
  const now = useNow(running);
  const [expanded, setExpanded] = useState(false);
  const showSteps = running || expanded;
  const elapsed = (run.endedAt ?? now) - run.startedAt;
  const outcome = run.outcome ? OUTCOME[run.outcome] : undefined;

  return (
    <div
      className={cn(
        "animate-slide-up rounded-2xl border bg-white px-3.5 py-3 shadow-sm dark:bg-zinc-900",
        run.status === "failed" ? "border-rose-200 dark:border-rose-500/30" : "border-zinc-200 dark:border-zinc-800",
      )}
      aria-live={running ? "polite" : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-lg",
            running && "bg-indigo-600 text-white",
            run.status === "done" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            run.status === "failed" && "bg-rose-500/15 text-rose-600 dark:text-rose-400",
            run.status === "cancelled" && "bg-zinc-500/15 text-zinc-500",
          )}
        >
          {running ? <Zap className="size-3.5 animate-pulse-soft" /> : run.status === "done" ? <CheckCircle2 className="size-3.5" /> : run.status === "failed" ? <AlertTriangle className="size-3.5" /> : <Ban className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            {running
              ? run.mode === "edit"
                ? "Updating diagram"
                : "Generating diagram"
              : run.status === "done"
                ? run.mode === "edit"
                  ? "Diagram updated"
                  : "Diagram ready"
                : run.status === "failed"
                  ? "Generation failed"
                  : "Stopped"}
          </p>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={modelLabel(run.model, models)}>
            {modelLabel(run.model, models)}
            {run.reviewer && (run.reviewer.model !== run.model.model || run.reviewer.provider !== run.model.provider) && (
              <> · reviewed by {modelLabel(run.reviewer, models)}</>
            )}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{formatDuration(elapsed)}</span>
      </div>

      {run.status === "done" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {outcome && (
            <Badge tone={outcome.tone} title={outcome.title}>
              {outcome.label}
            </Badge>
          )}
          {run.reviewScore !== undefined && <Badge tone="indigo">Review {run.reviewScore}/10</Badge>}
          {run.qualityScore !== undefined && (
            <Badge tone={run.qualityScore >= 85 ? "green" : run.qualityScore >= 70 ? "amber" : "rose"}>
              Quality {run.qualityScore} · {run.qualityGrade}
            </Badge>
          )}
          {run.refinements ? <Badge>{run.refinements} refinement{run.refinements > 1 ? "s" : ""}</Badge> : null}
        </div>
      )}

      {showSteps && (run.steps.length > 0 || running) && (
        <ol className="mt-3 space-y-1.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
          {run.steps.map((step) => (
            <StepRow key={step.key} step={step} now={now} />
          ))}
          {running && run.steps.length === 0 && (
            <li className="flex items-center gap-2 text-xs text-zinc-500">
              <Circle className="size-3.5" /> Starting…
            </li>
          )}
        </ol>
      )}

      {run.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {run.notes.map((n, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span className="min-w-0 break-words">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {run.error && <p className="mt-2 break-words rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{run.error}</p>}

      <div className="mt-2.5 flex items-center gap-2">
        {running && onStop && (
          <Button variant="secondary" size="xs" onClick={onStop}>
            Stop
          </Button>
        )}
        {run.status === "failed" && onRetry && (
          <Button variant="secondary" size="xs" onClick={() => onRetry(run)}>
            Try again
          </Button>
        )}
        {!running && run.steps.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            {expanded ? "Hide steps" : "Show steps"}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
    </div>
  );
}
