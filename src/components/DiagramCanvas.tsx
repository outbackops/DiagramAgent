"use client";

import { useState, type ReactNode } from "react";
import { AlertOctagon, Braces, Clipboard, Download, FileCode2, FileImage, Image as ImageIcon, Layers, Wand2 } from "lucide-react";
import type { LiveRenderState } from "@/hooks/useLiveRender";
import { api, downloadBlob, safeFileName } from "@/lib/client/api";
import DiagramViewer from "./DiagramViewer";
import { MenuItem, Popover } from "./ui/Popover";
import { Badge, Button, Spinner, cn } from "./ui/primitives";
import { useToast } from "./ui/Toast";

function ExportMenu({ code, svg, title }: { code: string; svg: string; title: string }) {
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

  return (
    <Popover
      align="end"
      panelClassName="w-64 p-1.5"
      trigger={({ open, toggle, id }) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={toggle}
          disabled={!code.trim()}
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
          <MenuItem
            icon={<ImageIcon className="size-3.5" />}
            disabled={!svg}
            hint=".svg"
            onSelect={() => {
              close();
              downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`);
            }}
          >
            SVG
          </MenuItem>
          <MenuItem
            icon={<FileImage className="size-3.5" />}
            disabled={!svg}
            hint=".png"
            onSelect={() => {
              close();
              void run("PNG", async () => downloadBlob(await api.exportPng(svg), `${base}.png`));
            }}
          >
            PNG (high resolution)
          </MenuItem>
          <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Editable</p>
          <MenuItem
            icon={<Layers className="size-3.5" />}
            hint=".drawio"
            onSelect={() => {
              close();
              void run("draw.io", async () => downloadBlob(await api.exportDrawio(code, title), `${base}.drawio`));
            }}
          >
            draw.io / diagrams.net
          </MenuItem>
          <MenuItem
            icon={<FileCode2 className="size-3.5" />}
            hint=".vsdx"
            onSelect={() => {
              close();
              void run("Visio", async () => downloadBlob(await api.exportVisio(code, title), `${base}.vsdx`));
            }}
          >
            Microsoft Visio
          </MenuItem>
          <MenuItem
            icon={<Braces className="size-3.5" />}
            hint=".d2"
            onSelect={() => {
              close();
              downloadBlob(new Blob([code], { type: "text/plain" }), `${base}.d2`);
            }}
          >
            D2 source
          </MenuItem>
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <MenuItem
            icon={<Clipboard className="size-3.5" />}
            onSelect={() => {
              close();
              void navigator.clipboard
                .writeText(code)
                .then(() => toast({ tone: "success", title: "D2 code copied" }))
                .catch(() => toast({ tone: "error", title: "Couldn't access the clipboard" }));
            }}
          >
            Copy D2 code
          </MenuItem>
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
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{busy ? "Drafting your diagram…" : "Your diagram will appear here"}</p>
        <p className="mt-1 max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          {busy ? "The code streams into the editor as the model writes it." : "Describe an architecture in the conversation panel, or paste D2 code into the editor."}
        </p>
      </div>
    </div>
  );
}

export default function DiagramCanvas({
  code,
  render,
  streaming,
  busy,
  title,
  fitKey,
  reviewScore,
  selectedPath,
  onElementClick,
  onMoveNode,
  onFixError,
  onShowCode,
  onShowQuality,
  overlay,
}: {
  code: string;
  render: LiveRenderState;
  streaming: boolean;
  busy: boolean;
  title: string;
  fitKey: string | number;
  reviewScore?: number;
  selectedPath?: string | null;
  onElementClick: (path: string, isConnection: boolean) => void;
  onMoveNode: (nodePath: string, targetContainerPath: string) => void;
  onFixError: (message: string) => void;
  onShowCode: () => void;
  onShowQuality: () => void;
  overlay?: ReactNode;
}) {
  const hasSvg = Boolean(render.svg) && Boolean(code.trim());
  const showError = Boolean(render.error) && !streaming && Boolean(code.trim());
  const q = render.quality;

  return (
    <div className="canvas-grid relative h-full w-full overflow-hidden">
      {hasSvg ? (
        <DiagramViewer
          svg={render.svg}
          fitKey={fitKey}
          dimmed={showError}
          selectedPath={selectedPath}
          onElementClick={onElementClick}
          onMoveNode={onMoveNode}
        />
      ) : (
        <EmptyCanvas busy={busy} />
      )}

      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          {(render.loading || streaming) && code.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/90 px-2 py-1 text-[11px] text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-300">
              <Spinner className="size-3" />
              {streaming ? "Live preview" : "Rendering"}
            </span>
          )}
          {q && hasSvg && !streaming && (
            <button type="button" onClick={onShowQuality} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70" title="Open quality checks">
              <Badge tone={q.score >= 85 ? "green" : q.score >= 70 ? "amber" : "rose"} className="px-2 py-1 shadow-sm">
                Quality {q.score} · {q.grade}
              </Badge>
            </button>
          )}
          {reviewScore !== undefined && hasSvg && !streaming && (
            <Badge tone="indigo" className="px-2 py-1 shadow-sm" title="Vision review score">
              Review {reviewScore}/10
            </Badge>
          )}
        </div>
        <div className="pointer-events-auto">
          <ExportMenu code={code} svg={render.svg} title={title} />
        </div>
      </div>

      {showError && (
        <div className="absolute inset-x-0 top-14 flex justify-center px-4">
          <div role="alert" className="flex w-full max-w-lg animate-slide-up items-start gap-3 rounded-xl border border-rose-200 bg-white p-3 shadow-lg dark:border-rose-500/30 dark:bg-zinc-900">
            <AlertOctagon className="mt-0.5 size-4 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">This D2 code doesn&apos;t render</p>
              <p className="mt-0.5 line-clamp-3 break-words font-mono text-[11px] text-rose-600 dark:text-rose-300">{render.error}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="xs" icon={<Wand2 className="size-3" />} disabled={busy} onClick={() => onFixError(render.error ?? "")}>
                  Fix with AI
                </Button>
                <Button variant="secondary" size="xs" onClick={onShowCode}>
                  View code
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {overlay}
    </div>
  );
}
