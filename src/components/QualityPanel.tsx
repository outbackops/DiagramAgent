"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { QualityCheck, QualityReport } from "@/lib/quality/diagram-quality";
import { Badge, cn } from "./ui/primitives";

const ORDER: Record<QualityCheck["status"], number> = { fail: 0, warn: 1, pass: 2 };

export function ScoreRing({ score, label, size = 64 }: { score: number; label: string; size?: number }) {
  const r = size / 2 - 5;
  const circumference = 2 * Math.PI * r;
  const color = score >= 85 ? "#10b981" : score >= 70 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-zinc-100 dark:stroke-zinc-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, score)) / 100)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{Math.round(score)}</span>
        <span className="text-[10px] font-medium text-zinc-400">{label}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-zinc-800/60">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}

export default function QualityPanel({ quality, loading }: { quality: QualityReport | null; loading: boolean }) {
  if (!quality) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-zinc-400">
        <CircleDashed className={cn("size-6", loading && "animate-spin")} />
        <p className="text-[13px]">{loading ? "Scoring the diagram…" : "Quality checks run automatically every time the diagram renders."}</p>
      </div>
    );
  }

  const checks = [...quality.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of quality.checks) counts[c.status]++;
  const m = quality.metrics;

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <div className="flex items-center gap-4">
        <ScoreRing score={quality.score} label={`Grade ${quality.grade}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Structural quality</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Deterministic checks on the rendered layout — no model involved.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="green">{counts.pass} passed</Badge>
            {counts.warn > 0 && <Badge tone="amber">{counts.warn} warning{counts.warn > 1 ? "s" : ""}</Badge>}
            {counts.fail > 0 && <Badge tone="rose">{counts.fail} failed</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Components" value={m.nodes} />
        <Metric label="Groups" value={m.containers} />
        <Metric label="Links" value={m.connections} />
        <Metric label="Aspect" value={`${m.aspectRatio}:1`} />
        <Metric label="Icons" value={`${Math.round(m.iconCoverage * 100)}%`} />
        <Metric label="Labels" value={`${Math.round(m.labelCoverage * 100)}%`} />
      </div>

      <ul className="mt-4 space-y-1.5">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2.5 rounded-lg border border-zinc-100 px-2.5 py-2 dark:border-zinc-800">
            {c.status === "pass" ? (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-emerald-500" />
            ) : c.status === "warn" ? (
              <AlertTriangle className="mt-px size-4 shrink-0 text-amber-500" />
            ) : (
              <XCircle className="mt-px size-4 shrink-0 text-rose-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                {c.label}
                {c.severity === "critical" && c.status !== "pass" && <Badge tone="rose">critical</Badge>}
              </p>
              <p className="mt-0.5 break-words text-xs text-zinc-500 dark:text-zinc-400">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
