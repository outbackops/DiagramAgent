"use client";

import { useState, type ReactNode } from "react";
import { AlertOctagon, Braces, Clipboard, Download, FileCode2, FileImage, Image as ImageIcon, Layers, Wand2 } from "lucide-react";
import { api, downloadBlob, safeFileName } from "@/lib/client/api";
import { diagramKind } from "@/lib/model/kind";
import { renderModelSvg } from "@/lib/model/render-svg";
import { modelToD2Result } from "@/lib/model/to-d2";
import { modelToExcalidraw } from "@/lib/model/to-excalidraw";
import { modelToMermaidResult } from "@/lib/model/to-mermaid";
import type { DiagramModel } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import { MenuItem, Popover } from "./ui/Popover";
import { Badge, Button, Spinner, cn } from "./ui/primitives";
import { useToast } from "./ui/Toast";

function ExportMenu({ model, title }: { model: DiagramModel | null; title: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const base = safeFileName(title);

  const run = async (kind: string, action: () => Promise<void>) => {
    setBusy(kind);
    try {
      await action();
    } catch (err) {
      toast({ tone: "error", title: `${kind} export failed`, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast({ tone: "success", title: `${label} copied` }),
      () => toast({ tone: "error", title: "Couldn't access the clipboard" }),
    );
  };

  const showWarnings = (warnings: string[]) => {
    if (warnings.length) toast({ tone: "info", title: "Export warnings", description: warnings.join("\n") });
  };
  const d2 = model ? modelToD2Result(model) : { content: "", warnings: [] };
  const mermaid = model ? modelToMermaidResult(model) : { content: "", warnings: [] };
  const downloadExportBlob = async (result: { blob: Blob; warnings: string[] }, fileName: string) => {
    downloadBlob(result.blob, fileName);
    showWarnings(result.warnings);
  };

  return (
    <Popover
      align="end"
      panelClassName="w-64 p-1.5"
      trigger={({ open, toggle, id }) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={toggle}
          disabled={!model}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          icon={busy ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
        >
          Export
        </Button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Export">
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Image</p>
          <MenuItem icon={<ImageIcon className="size-3.5" />} disabled={!model} hint=".svg" onSelect={() => { if (!model) return; close(); downloadBlob(new Blob([renderModelSvg(model, diagramKind(model) !== "graph" ? { padding: 0 } : {})], { type: "image/svg+xml" }), `${base}.svg`); }}>SVG</MenuItem>
          <MenuItem icon={<FileImage className="size-3.5" />} disabled={!model} hint=".png" onSelect={() => { if (!model) return; close(); void run("PNG", async () => downloadExportBlob(await api.exportPng(model), `${base}.png`)); }}>PNG (high resolution)</MenuItem>
          <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Editable</p>
          <MenuItem icon={<Layers className="size-3.5" />} disabled={!model} hint=".drawio" onSelect={() => { if (!model) return; close(); void run("draw.io", async () => downloadExportBlob(await api.exportDrawio(model, title), `${base}.drawio`)); }}>draw.io / diagrams.net</MenuItem>
          <MenuItem icon={<FileCode2 className="size-3.5" />} disabled={!model} hint=".vsdx" onSelect={() => { if (!model) return; close(); void run("Visio", async () => downloadExportBlob(await api.exportVisio(model, title), `${base}.vsdx`)); }}>Microsoft Visio</MenuItem>
          <MenuItem icon={<FileCode2 className="size-3.5" />} disabled={!model} hint=".excalidraw" onSelect={() => { if (!model) return; close(); downloadBlob(new Blob([modelToExcalidraw(model)], { type: "application/json" }), `${base}.excalidraw`); }}>Excalidraw</MenuItem>
          <MenuItem icon={<Braces className="size-3.5" />} disabled={!model} hint=".d2" onSelect={() => { close(); downloadBlob(new Blob([d2.content], { type: "text/plain" }), `${base}.d2`); showWarnings(d2.warnings); }}>D2 source</MenuItem>
          <MenuItem icon={<Braces className="size-3.5" />} disabled={!model} hint=".mmd" onSelect={() => { close(); downloadBlob(new Blob([mermaid.content], { type: "text/plain" }), `${base}.mmd`); showWarnings(mermaid.warnings); }}>Mermaid</MenuItem>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <MenuItem icon={<Clipboard className="size-3.5" />} disabled={!model} onSelect={() => { close(); copy("D2", d2.content); showWarnings(d2.warnings); }}>Copy D2</MenuItem>
          <MenuItem icon={<Clipboard className="size-3.5" />} disabled={!model} onSelect={() => { close(); copy("Mermaid", mermaid.content); showWarnings(mermaid.warnings); }}>Copy Mermaid</MenuItem>
        </div>
      )}
    </Popover>
  );
}

function EmptyCanvas({ busy }: { busy: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className={cn("relative h-24 w-40", busy && "animate-pulse-soft")} aria-hidden>
        <div className="absolute left-0 top-6 h-12 w-12 rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700" />
        <div className="absolute left-14 top-0 h-24 w-26 rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-500/40" />
        <div className="absolute left-[4.6rem] top-5 h-6 w-14 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="absolute left-[4.6rem] top-13 h-6 w-14 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="absolute left-12 top-12 h-0.5 w-2 bg-zinc-300 dark:bg-zinc-700" />
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{busy ? "Drafting your diagram..." : "Your diagram will appear here"}</p>
        <p className="mt-1 max-w-xs text-xs text-zinc-500 dark:text-zinc-400">{busy ? "The model is being prepared for the canvas." : "Describe an architecture in the conversation panel, or import D2 from the code tab."}</p>
      </div>
    </div>
  );
}

export default function DiagramCanvas({
  canvas,
  exportModel,
  title,
  streaming,
  busy,
  quality,
  qualityLoading,
  reviewScore,
  renderError,
  renderErrorKind,
  onRetryRender,
  onFixError,
  onShowCode,
  onShowQuality,
  toolbar,
  overlay,
  status,
}: {
  canvas: ReactNode | null;
  exportModel: DiagramModel | null;
  title: string;
  streaming: boolean;
  busy: boolean;
  quality: QualityReport | null;
  qualityLoading: boolean;
  reviewScore?: number;
  renderError: string | null;
  renderErrorKind: "syntax" | "unavailable" | null;
  onRetryRender(): void;
  onFixError(message: string): void;
  onShowCode(): void;
  onShowQuality(): void;
  toolbar?: ReactNode;
  overlay?: ReactNode;
  status?: ReactNode;
}) {
  const hasCanvas = canvas !== null;
  const showError = Boolean(renderError) && !streaming;

  return (
    <div className="canvas-grid relative h-full w-full overflow-hidden">
      {hasCanvas ? canvas : <EmptyCanvas busy={busy} />}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {toolbar}
          {(qualityLoading || streaming) && hasCanvas && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2 py-1 text-[11px] text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300">
              <Spinner className="size-3" />
              {streaming ? "Live preview" : "Rendering"}
            </span>
          )}
          {quality && hasCanvas && !streaming && (
            <button type="button" onClick={onShowQuality} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70" title="Open quality checks">
              <Badge tone={quality.score >= 85 ? "green" : quality.score >= 70 ? "amber" : "rose"} className="px-2 py-1 shadow-sm">Quality {quality.score} · {quality.grade}</Badge>
            </button>
          )}
          {reviewScore !== undefined && hasCanvas && !streaming && <Badge tone="indigo" className="px-2 py-1 shadow-sm" title="Vision review score">Review {reviewScore}/10</Badge>}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <ExportMenu model={exportModel} title={title} />
        </div>
      </div>
      {showError && renderErrorKind === "unavailable" && (
        <div className="absolute inset-x-0 top-14 flex justify-center px-4">
          <div role="alert" className="flex w-full max-w-lg animate-slide-up items-start gap-3 rounded-xl border border-amber-200 bg-white p-3 shadow-lg dark:border-amber-500/30 dark:bg-zinc-900">
            <AlertOctagon className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">Couldn&apos;t render the diagram right now</p>
              <p className="mt-0.5 line-clamp-3 break-words text-[12px] text-zinc-600 dark:text-zinc-300">{renderError}</p>
              <div className="mt-2 flex gap-2"><Button variant="secondary" size="xs" onClick={onRetryRender}>Try again</Button></div>
            </div>
          </div>
        </div>
      )}
      {showError && renderErrorKind === "syntax" && (
        <div className="absolute inset-x-0 top-14 flex justify-center px-4">
          <div role="alert" className="flex w-full max-w-lg animate-slide-up items-start gap-3 rounded-xl border border-rose-200 bg-white p-3 shadow-lg dark:border-rose-500/30 dark:bg-zinc-900">
            <AlertOctagon className="mt-0.5 size-4 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">This diagram doesn&apos;t render</p>
              <p className="mt-0.5 line-clamp-3 break-words font-mono text-[11px] text-rose-600 dark:text-rose-300">{renderError}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="xs" icon={<Wand2 className="size-3" />} disabled={busy} onClick={() => onFixError(renderError ?? "")}>Fix with AI</Button>
                <Button variant="secondary" size="xs" onClick={onShowCode}>View code</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {status && <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center"><div className="pointer-events-auto rounded-lg bg-white/90 px-2 py-1 text-xs text-zinc-500 shadow-sm backdrop-blur dark:bg-zinc-900/90 dark:text-zinc-300">{status}</div></div>}
      {overlay}
    </div>
  );
}
