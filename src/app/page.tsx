"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import ConversationPanel from "@/components/ConversationPanel";
import type { ComposerHandle } from "@/components/Composer";
import DeviceFlowDialog from "@/components/DeviceFlowDialog";
import CanvasToolbar from "@/components/CanvasToolbar";
import DiagramCanvas from "@/components/DiagramCanvas";
import ElementEditor from "@/components/ElementEditor";
import Inspector, { type InspectorTab } from "@/components/Inspector";
import ModelCanvas from "@/components/ModelCanvas";
import ModelPicker from "@/components/ModelPicker";
import ResizeHandle from "@/components/ResizeHandle";
import { phaseLabel } from "@/components/RunCard";
import SettingsMenu from "@/components/SettingsMenu";
import SignInGate from "@/components/SignInGate";
import TopBar from "@/components/TopBar";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/primitives";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useCopilotSession, useModelChoice } from "@/hooks/useCopilot";
import { useDiagramAgent, type AgentDocument } from "@/hooks/useDiagramAgent";
import { suggestsTidyUp, useDiagramDocument } from "@/hooks/useDiagramDocument";
import { useLiveRender } from "@/hooks/useLiveRender";
import { useModelQuality } from "@/hooks/useModelQuality";
import { useTheme } from "@/hooks/useTheme";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { connect } from "@/lib/model/ops";
import { modelToMermaid } from "@/lib/model/to-mermaid";
import type { DiagramModel } from "@/lib/model/types";
import type { ReviewAssessment } from "@/lib/pipeline/refine-loop";
import { usePersistedState } from "@/lib/use-persisted-state";

interface Layout {
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
}

const DEFAULT_LAYOUT: Layout = { sidebarWidth: 384, inspectorWidth: 460, sidebarOpen: true, inspectorOpen: true };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const isLayout = (v: unknown): v is Layout =>
  !!v &&
  typeof v === "object" &&
  typeof (v as Layout).sidebarWidth === "number" &&
  typeof (v as Layout).inspectorWidth === "number" &&
  typeof (v as Layout).sidebarOpen === "boolean" &&
  typeof (v as Layout).inspectorOpen === "boolean";

const isTab = (v: unknown): v is InspectorTab => v === "code" || v === "quality" || v === "review";

/** Ids from `ids` that still exist in `model` (nodes or edges). */
function existingIds(model: DiagramModel | null, ids: string[]): string[] {
  if (!model || ids.length === 0) return [];
  const known = new Set<string>([...model.nodes.map((n) => n.id), ...model.edges.map((e) => e.id)]);
  return ids.filter((id) => known.has(id));
}

function Workspace() {
  const theme = useTheme();
  const { toast } = useToast();
  const session = useCopilotSession();
  const choice = useModelChoice(session.catalog);
  const doc = useDiagramDocument();
  const [fitNonce, setFitNonce] = useState(0);

  const tidyUp = useCallback(async () => {
    await doc.tidyUp();
    setFitNonce((n) => n + 1);
  }, [doc]);

  const agentDocument: AgentDocument = {
    currentCode: () => (doc.model ? doc.d2 : null),
    onKeep: async (code, info) => {
      const result = await doc.acceptRunCode(code, info.layout);
      if (result.warnings.length > 0) {
        toast({ tone: "info", title: "Some parts of the diagram weren't imported", description: result.warnings.slice(0, 3).join(" · ") });
      }
      // Stable merges tuck new items in around the existing layout; many of them deserve a fresh layout (R16).
      if (suggestsTidyUp(result, info.layout)) {
        toast({
          tone: "info",
          title: `${result.added + result.regrouped} items were added or moved into new groups`,
          description: "They were placed around your layout. Tidy up to re-arrange the whole diagram.",
          action: { label: "Tidy up", onClick: () => void tidyUp().catch((err: unknown) => toast({ tone: "error", title: "Tidy up failed", description: err instanceof Error ? err.message : String(err) })) },
        });
      }
    },
  };
  const agent = useDiagramAgent(
    {
      selection: choice.selection,
      reviewer: choice.reviewer,
      reviewerSupportsVision: choice.reviewerSupportsVision,
    },
    agentDocument,
  );
  const running = agent.busy === "running";
  // New diagrams stream in as a live preview; edits keep showing your layout until the result is merged in.
  const previewing = running && agent.latestRun?.mode === "create";
  // Live renders cover new-diagram previews and code that isn't on the canvas yet (e.g. a draft that failed to render).
  const showLive = previewing || !doc.model;
  const render = useLiveRender(showLive ? agent.code : "", running);
  const modelQuality = useModelQuality(doc.model, !previewing && doc.status === "ready");

  const [layout, setLayout] = usePersistedState<Layout>("diagramAgent.layout.v2", DEFAULT_LAYOUT, { validate: isLayout });
  const [tab, setTab] = usePersistedState<InspectorTab>("diagramAgent.inspectorTab", "code", { validate: isTab });
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

  // Panels shrink with the window; when the canvas would get too narrow the
  // inspector floats over it instead of squeezing it.
  const viewport = useViewportWidth();
  const sidebarWidth = clamp(layout.sidebarWidth, 300, Math.max(300, viewport * 0.4));
  const inspectorWidth = clamp(layout.inspectorWidth, 320, Math.max(320, viewport * 0.45));
  const inspectorFloating = viewport - (layout.sidebarOpen ? sidebarWidth : 0) - inspectorWidth < 480;
  const [overlayOpen, setOverlayOpen] = useState(false);
  const inspectorVisible = inspectorFloating ? overlayOpen : layout.inspectorOpen;
  const setInspectorVisible = useCallback(
    (open: boolean | ((open: boolean) => boolean)) => {
      if (inspectorFloating) setOverlayOpen((v) => (typeof open === "function" ? open(v) : open));
      else setLayout((l) => ({ ...l, inspectorOpen: typeof open === "function" ? open(l.inspectorOpen) : open }));
    },
    [inspectorFloating, setLayout],
  );

  const [selectionState, setSelection] = useState<string[]>([]);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ id: string; nonce: number } | undefined>(undefined);
  const [pendingFixes, setPendingFixes] = useState<ReviewAssessment | null>(null);
  // Undo, AI edits and deletes can remove selected items; only pass on what still exists.
  const selection = useMemo(() => existingIds(doc.model, selectionState), [doc.model, selectionState]);

  const deselect = useCallback(() => {
    setSelection([]);
    setConnectFrom(null);
  }, []);

  const canUseModels = Boolean(session.auth?.signedIn || session.auth?.providers.azure);
  const showGate = !session.loading && !canUseModels;
  const latestRun = agent.latestRun;
  const fitKey =
    latestRun?.status === "running" ? `running-${latestRun.id}` : `${latestRun?.id ?? "none"}-${latestRun?.endedAt ?? 0}-${doc.status}-${fitNonce}`;
  const canvasModel = previewing ? render.model : (doc.model ?? render.model);

  const activePhase = latestRun?.status === "running" ? latestRun.steps.findLast((s) => s.status === "active") : undefined;
  const status =
    agent.busy === "clarifying"
      ? "Analyzing request"
      : running
        ? activePhase
          ? phaseLabel(activePhase)
          : "Starting"
        : null;

  // A run rewrites the code, so a selection made before it could point at nodes that no longer exist.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (running) deselect();
  }, [running, deselect]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (agent.busy !== "idle") agent.stop();
        else if (selection.length > 0 || connectFrom) deselect();
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        composerRef.current?.focus();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setLayout((l) => ({ ...l, sidebarOpen: !l.sidebarOpen }));
      } else if (mod && e.key === ".") {
        e.preventDefault();
        setInspectorVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent, connectFrom, deselect, selection.length, setInspectorVisible, setLayout]);

  /** Hand edits; blocked while a run is changing the diagram (R12). */
  const applyEdit = useCallback(
    (op: (model: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }) => {
      if (running) return;
      doc.apply(op, options);
    },
    [doc, running],
  );

  const onConnect = useCallback(
    (from: string, to: string) => {
      applyEdit((model) => connect(model, from, to).model);
      setConnectFrom(null);
    },
    [applyEdit],
  );

  const importD2 = useCallback(
    async (code: string, signal: AbortSignal) => {
      const warnings = await doc.importD2(code, signal);
      deselect();
      setFitNonce((n) => n + 1);
      return warnings;
    },
    [deselect, doc],
  );

  // Reviewer fixes re-arrange the layout (R22): confirm first when it was arranged by hand.
  const applyReview = useCallback(
    (assessment: ReviewAssessment) => {
      if (doc.model?.handArranged) setPendingFixes(assessment);
      else agent.applyReview(assessment);
    },
    [agent, doc.model?.handArranged],
  );

  const resizeSidebar = useCallback((dx: number) => setLayout((l) => ({ ...l, sidebarWidth: clamp(l.sidebarWidth + dx, 300, 600) })), [setLayout]);
  const resizeInspector = useCallback((dx: number) => setLayout((l) => ({ ...l, inspectorWidth: clamp(l.inspectorWidth - dx, 320, 820) })), [setLayout]);

  const requestNew = useCallback(() => {
    if (doc.model || agent.code.trim() || agent.items.length > 0 || agent.busy !== "idle") setConfirmNew(true);
    else agent.reset();
  }, [agent, doc.model]);

  const openInspector = useCallback(
    (next: InspectorTab) => {
      setTab(next);
      setInspectorVisible(true);
    },
    [setInspectorVisible, setTab],
  );

  const controls = useMemo(
    () =>
      canUseModels ? (
        <>
          <ModelPicker
            models={choice.models}
            selection={choice.selection}
            defaultSelection={session.catalog?.defaultSelection ?? null}
            onChange={choice.setSelection}
            disabled={agent.busy !== "idle"}
            loading={session.loading}
            error={session.catalogError ?? (session.catalog?.errors.copilot ? session.catalog.errors.copilot.message : null)}
          />
          <SettingsMenu
            settings={agent.settings}
            onChange={agent.setSettings}
            models={choice.models}
            reviewerChoice={choice.reviewerChoice}
            onReviewerChange={choice.setReviewerChoice}
            reviewerSupportsVision={choice.reviewerSupportsVision}
            disabled={agent.busy !== "idle"}
          />
        </>
      ) : null,
    [agent.busy, agent.setSettings, agent.settings, canUseModels, choice, session.catalog, session.catalogError, session.loading],
  );

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        title={agent.title}
        onTitleChange={agent.setTitle}
        status={status}
        theme={theme.preference}
        onCycleTheme={theme.cycle}
        sidebarOpen={layout.sidebarOpen}
        onToggleSidebar={() => setLayout((l) => ({ ...l, sidebarOpen: !l.sidebarOpen }))}
        inspectorOpen={inspectorVisible}
        onToggleInspector={() => setInspectorVisible((v) => !v)}
        onNew={requestNew}
        controls={controls}
        account={<AccountMenu auth={session.auth} onSignIn={() => setDeviceOpen(true)} onSignOut={() => void session.signOut()} onRefresh={() => void session.refresh()} />}
      />

      <main className="relative flex min-h-0 flex-1">
        {layout.sidebarOpen && (
          <>
            <section
              aria-label="Conversation"
              className="flex min-h-0 shrink-0 flex-col bg-zinc-50/70 dark:bg-zinc-950"
              style={{ width: sidebarWidth }}
            >
              {showGate ? (
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
                  <SignInGate
                    auth={session.auth}
                    error={session.authError}
                    loading={session.loading}
                    onSignIn={() => setDeviceOpen(true)}
                    onRetry={() => void session.refresh()}
                  />
                </div>
              ) : (
                <ConversationPanel
                  ref={composerRef}
                  items={agent.items}
                  busy={agent.busy}
                  clarify={agent.clarify}
                  models={choice.models}
                  hasDiagram={Boolean(doc.model?.nodes.length) || Boolean(agent.code.trim())}
                  disabled={session.loading && !session.auth}
                  onSend={agent.send}
                  onStop={agent.stop}
                  onRetry={agent.retryRun}
                  onSubmitClarify={agent.submitClarify}
                  onSkipClarify={agent.skipClarify}
                />
              )}
            </section>
            <ResizeHandle label="Resize conversation panel" onResize={resizeSidebar} />
          </>
        )}

        <section aria-label="Diagram" className="relative min-w-0 flex-1">
          <DiagramCanvas
            canvas={
              canvasModel ? (
                <ModelCanvas
                  model={canvasModel}
                  readOnly={running || !doc.model}
                  dimmed={running && !previewing}
                  fitKey={fitKey}
                  selection={selection}
                  onSelectionChange={setSelection}
                  onApply={applyEdit}
                  connectFrom={connectFrom}
                  onConnect={onConnect}
                  onRequestRename={(id) => setRenameRequest({ id, nonce: Date.now() })}
                />
              ) : null
            }
            exportModel={running ? null : doc.model}
            title={agent.title}
            streaming={running}
            busy={running}
            quality={showLive ? render.quality : modelQuality.quality}
            qualityLoading={showLive ? render.loading : modelQuality.loading}
            reviewScore={latestRun?.status === "done" ? latestRun.reviewScore : undefined}
            renderError={showLive ? render.error : null}
            renderErrorKind={showLive ? render.errorKind : null}
            onRetryRender={render.retry}
            onFixError={agent.fixRenderError}
            onShowCode={() => openInspector("code")}
            onShowQuality={() => openInspector("quality")}
            toolbar={
              doc.model && !running ? (
                <CanvasToolbar
                  model={doc.model}
                  selection={selection}
                  readOnly={running}
                  canUndo={doc.canUndo}
                  canRedo={doc.canRedo}
                  onUndo={doc.undo}
                  onRedo={doc.redo}
                  onApply={applyEdit}
                  onSelectionChange={setSelection}
                  onStartConnect={setConnectFrom}
                  onTidyUp={tidyUp}
                />
              ) : null
            }
            status={
              doc.status === "migrating" ? (
                <span className="text-xs text-zinc-500">Opening your saved diagram…</span>
              ) : doc.error ? (
                <button type="button" onClick={doc.dismissError} className="text-xs text-rose-600 hover:underline dark:text-rose-300">
                  {doc.error} (dismiss)
                </button>
              ) : null
            }
            overlay={
              <ElementEditor
                model={doc.model}
                selection={selection}
                readOnly={running}
                connectFrom={connectFrom}
                renameRequest={renameRequest}
                onApply={applyEdit}
                onStartConnect={setConnectFrom}
                onCancelConnect={() => setConnectFrom(null)}
                onDeselect={deselect}
              />
            }
          />
        </section>

        {inspectorVisible && (
          <>
            {!inspectorFloating && <ResizeHandle label="Resize inspector" onResize={resizeInspector} />}
            <div
              className={
                inspectorFloating
                  ? "absolute inset-y-0 right-0 z-20 animate-slide-up border-l border-zinc-200 shadow-2xl shadow-zinc-900/20 dark:border-zinc-800"
                  : "min-h-0 shrink-0"
              }
              style={{ width: inspectorFloating ? Math.min(inspectorWidth, viewport - 24) : inspectorWidth }}
            >
              <Inspector
                tab={tab}
                onTabChange={setTab}
                onClose={() => setInspectorVisible(false)}
                d2={doc.d2 || agent.code}
                mermaid={doc.model ? modelToMermaid(doc.model) : ""}
                streamingCode={running ? agent.code : null}
                theme={theme.resolved}
                quality={showLive ? render.quality : modelQuality.quality}
                qualityLoading={showLive ? render.loading : modelQuality.loading}
                run={latestRun}
                models={choice.models}
                reviewEnabled={agent.settings.review}
                canApplyReview={agent.busy === "idle" && Boolean(doc.model)}
                onApplyReview={applyReview}
                onImportD2={importD2}
                importDisabled={running}
              />
            </div>
          </>
        )}
      </main>

      <Dialog
        open={pendingFixes !== null}
        onClose={() => setPendingFixes(null)}
        title="Apply the suggested fixes?"
        description="Fixing layout problems re-arranges the diagram, so positions you set by hand will change. You can undo this afterwards."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingFixes(null)}>
              Keep my layout
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const fixes = pendingFixes;
                setPendingFixes(null);
                if (fixes) agent.applyReview(fixes);
              }}
            >
              Apply fixes
            </Button>
          </>
        }
      />

      <DeviceFlowDialog open={deviceOpen} onClose={() => setDeviceOpen(false)} onSignedIn={() => void session.refresh()} />

      <Dialog
        open={confirmNew}
        onClose={() => setConfirmNew(false)}
        title="Start a new diagram?"
        description={agent.busy !== "idle" ? "This stops the current generation and clears the diagram and conversation." : "This clears the current diagram and conversation."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmNew(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmNew(false);
                deselect();
                agent.reset();
                doc.clear();
              }}
            >
              Clear and start over
            </Button>
          </>
        }
      />
    </div>
  );
}

export default function Home() {
  return (
    <ToastProvider>
      <Workspace />
    </ToastProvider>
  );
}
