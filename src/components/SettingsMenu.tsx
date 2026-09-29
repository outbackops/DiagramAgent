"use client";

import { SlidersHorizontal } from "lucide-react";
import type { AgentSettings } from "@/hooks/useDiagramAgent";
import type { CatalogModel, ModelSelection } from "@/lib/llm/types";
import { selectionForModel } from "@/lib/llm/selection";
import { Popover } from "./ui/Popover";
import { IconButton, Segmented, Switch } from "./ui/primitives";

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export default function SettingsMenu({
  settings,
  onChange,
  models,
  reviewerChoice,
  onReviewerChange,
  reviewerSupportsVision,
  disabled,
}: {
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
  models: CatalogModel[];
  reviewerChoice: ModelSelection | "same";
  onReviewerChange: (choice: ModelSelection | "same") => void;
  reviewerSupportsVision: boolean;
  disabled?: boolean;
}) {
  const visionModels = models.filter((m) => m.vision);
  const reviewerValue = reviewerChoice === "same" ? "same" : `${reviewerChoice.provider}:${reviewerChoice.model}`;

  return (
    <Popover
      align="end"
      panelClassName="w-80 p-4"
      trigger={({ open, toggle, id }) => (
        <IconButton label="Generation settings" onClick={toggle} active={open} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}>
          <SlidersHorizontal className="size-4" />
        </IconButton>
      )}
    >
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Generation settings</p>
      <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
        <div className="py-2.5">
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Diagram style</p>
          <p className="mb-2 mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            Composed diagrams are laid out like a designed poster: columns, flow lanes and service cards. Graph lets D2 place a free-form graph.
          </p>
          <Segmented
            ariaLabel="Diagram style"
            value={settings.style ?? "composed"}
            options={[
              { value: "composed", label: "Composed" },
              { value: "graph", label: "Graph" },
            ]}
            disabled={disabled}
            onChange={(style) => onChange({ ...settings, style })}
          />
        </div>
        <Row title="Clarifying questions" hint="Ask a few targeted questions before drawing a new diagram.">
          <Switch label="Clarifying questions" checked={settings.clarify} disabled={disabled} onChange={(clarify) => onChange({ ...settings, clarify })} />
        </Row>
        <Row title="Vision review" hint="A model inspects the rendered image and scores it; low scores trigger refinement.">
          <Switch label="Vision review" checked={settings.review} disabled={disabled} onChange={(review) => onChange({ ...settings, review })} />
        </Row>
        <div className="py-2.5">
          <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">Refinement rounds</p>
          <p className="mb-2 mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            Extra passes allowed to fix review findings or structural problems. Every round is re-checked; the best version wins.
          </p>
          <Segmented
            ariaLabel="Refinement rounds"
            value={String(settings.refinements) as "0" | "1" | "2" | "3"}
            options={[
              { value: "0", label: "Off" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
            disabled={disabled}
            onChange={(v) => onChange({ ...settings, refinements: Number(v) })}
          />
        </div>
        <div className="py-2.5">
          <label htmlFor="reviewer-model" className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
            Reviewer model
          </label>
          <p className="mb-2 mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">Must accept images. Using a different model gives a second opinion.</p>
          <select
            id="reviewer-model"
            value={reviewerValue}
            disabled={disabled || !settings.review}
            onChange={(e) => {
              if (e.target.value === "same") return onReviewerChange("same");
              const [provider, ...rest] = e.target.value.split(":");
              const model = models.find((m) => m.provider === provider && m.id === rest.join(":"));
              if (model) onReviewerChange(selectionForModel(model, "medium"));
            }}
            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] text-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="same">Same as the main model</option>
            {visionModels.map((m) => (
              <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>
                {m.name}
              </option>
            ))}
          </select>
          {settings.review && !reviewerSupportsVision && (
            <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">The selected model can&apos;t view images, so review will be skipped.</p>
          )}
        </div>
      </div>
    </Popover>
  );
}
