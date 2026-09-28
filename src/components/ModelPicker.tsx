"use client";

import { useMemo, useState } from "react";
import { Brain, Check, ChevronDown, Eye, Search, Sparkles } from "lucide-react";
import type { CatalogModel, ModelSelection, ProviderId, ReasoningEffort } from "@/lib/llm/types";
import { Popover } from "./ui/Popover";
import { Badge, Segmented, cn } from "./ui/primitives";

const PROVIDER_LABEL: Record<ProviderId, string> = {
  copilot: "GitHub Copilot",
  azure: "Azure OpenAI · Entra ID",
};

const EFFORT_HINT: Record<ReasoningEffort, string> = {
  none: "No extended reasoning — fastest",
  low: "Light reasoning — fast",
  medium: "Balanced quality and speed",
  high: "Deeper reasoning — slower",
  xhigh: "Very deep reasoning — slow",
  max: "Maximum reasoning — slowest",
};

export function effortOptions(model: CatalogModel | undefined) {
  return (model?.reasoningEfforts ?? []).map((e) => ({ value: e, label: e === "xhigh" ? "x-high" : e, title: EFFORT_HINT[e] }));
}

function ModelRow({ model, selected, isDefault, onPick }: { model: CatalogModel; selected: boolean; isDefault: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      ref={selected ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none",
        selected ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-[13px] font-medium", selected ? "text-indigo-700 dark:text-indigo-200" : "text-zinc-800 dark:text-zinc-100")}>
            {model.name}
          </span>
          {isDefault && <Badge tone="indigo">Default</Badge>}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="truncate font-mono">{model.id}</span>
          {model.vision && (
            <span className="inline-flex items-center gap-0.5" title="Accepts images (can review diagrams)">
              <Eye className="size-3" />
            </span>
          )}
          {model.reasoningEfforts.length > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Supports reasoning effort">
              <Brain className="size-3" />
            </span>
          )}
          {model.multiplier !== undefined && model.multiplier !== 1 && <span title="Premium request multiplier">×{model.multiplier}</span>}
        </span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-indigo-600 dark:text-indigo-300" />}
    </button>
  );
}

export default function ModelPicker({
  models,
  selection,
  defaultSelection,
  onChange,
  disabled,
  loading,
  error,
}: {
  models: CatalogModel[];
  selection: ModelSelection;
  defaultSelection: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const [query, setQuery] = useState("");
  const current = models.find((m) => m.provider === selection.provider && m.id === selection.model);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? models.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : models;
    // Surface the recommended default first; keep the provider's order otherwise.
    const isDefault = (m: CatalogModel) => defaultSelection?.provider === m.provider && defaultSelection?.model === m.id;
    const ordered = [...filtered.filter(isDefault), ...filtered.filter((m) => !isDefault(m))];
    const byProvider = new Map<ProviderId, CatalogModel[]>();
    for (const m of ordered) byProvider.set(m.provider, [...(byProvider.get(m.provider) ?? []), m]);
    return [...byProvider.entries()];
  }, [defaultSelection, models, query]);

  const pick = (model: CatalogModel) => {
    const effort =
      selection.reasoningEffort && model.reasoningEfforts.includes(selection.reasoningEffort)
        ? selection.reasoningEffort
        : model.reasoningEfforts.includes("medium")
          ? "medium"
          : model.defaultReasoningEffort;
    onChange(effort ? { provider: model.provider, model: model.id, reasoningEffort: effort } : { provider: model.provider, model: model.id });
  };

  const efforts = effortOptions(current);

  return (
    <Popover
      align="end"
      panelClassName="w-[22rem]"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          title="Choose the model used for planning, generation and review"
          className={cn(
            "inline-flex h-8 max-w-[18rem] items-center gap-2 rounded-lg border px-2.5 text-[13px] transition-colors",
            "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <Sparkles className="size-3.5 shrink-0 text-indigo-500" />
          <span className="truncate font-medium">{current?.name ?? (loading ? "Loading models…" : selection.model)}</span>
          {selection.reasoningEffort && <span className="shrink-0 text-zinc-400">· {selection.reasoningEffort === "xhigh" ? "x-high" : selection.reasoningEffort}</span>}
          <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[min(34rem,calc(100vh-6rem))] flex-col">
          <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
            <label className="flex items-center gap-2 rounded-lg bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-800">
              <Search className="size-3.5 text-zinc-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="w-full bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
              />
            </label>
          </div>
          <div role="listbox" aria-label="Models" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {error && <p className="px-2.5 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            {groups.length === 0 && !error && <p className="px-2.5 py-6 text-center text-xs text-zinc-400">{loading ? "Loading models…" : "No models match"}</p>}
            {groups.map(([provider, list]) => (
              <div key={provider} className="mb-1">
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{PROVIDER_LABEL[provider]}</p>
                {list.map((m) => (
                  <ModelRow
                    key={`${m.provider}:${m.id}`}
                    model={m}
                    selected={m.provider === selection.provider && m.id === selection.model}
                    isDefault={defaultSelection?.provider === m.provider && defaultSelection?.model === m.id}
                    onPick={() => {
                      pick(m);
                      if (m.reasoningEfforts.length === 0) close();
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          {efforts.length > 0 && (
            <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Reasoning effort</p>
                <p className="text-[11px] text-zinc-400">{selection.reasoningEffort ? EFFORT_HINT[selection.reasoningEffort] : ""}</p>
              </div>
              <Segmented
                ariaLabel="Reasoning effort"
                size="xs"
                value={selection.reasoningEffort ?? efforts[0].value}
                options={efforts}
                onChange={(reasoningEffort) => onChange({ ...selection, reasoningEffort })}
              />
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
