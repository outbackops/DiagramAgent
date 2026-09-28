"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import ConversationPanel from "@/components/ConversationPanel";
import type { ComposerHandle } from "@/components/Composer";
import DeviceFlowDialog from "@/components/DeviceFlowDialog";
import DiagramCanvas from "@/components/DiagramCanvas";
import ElementEditor, { type SelectedElement } from "@/components/ElementEditor";
import Inspector, { type InspectorTab } from "@/components/Inspector";
import ModelPicker from "@/components/ModelPicker";
import ResizeHandle from "@/components/ResizeHandle";
import { phaseLabel } from "@/components/RunCard";
import SettingsMenu from "@/components/SettingsMenu";
import SignInGate from "@/components/SignInGate";
import TopBar from "@/components/TopBar";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/primitives";
import { ToastProvider } from "@/components/ui/Toast";
import { useCopilotSession, useModelChoice } from "@/hooks/useCopilot";
import { useDiagramAgent } from "@/hooks/useDiagramAgent";
import { useLiveRender } from "@/hooks/useLiveRender";
import { useTheme } from "@/hooks/useTheme";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import {
  addConnection,
  deleteConnection,
  deleteElement,
  findElementLabel,
  moveNodeToContainer,
  parseConnectionPath,
  updateConnectionLabel,
  updateElementLabel,
} from "@/lib/d2-editor";
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

function connectionLabel(code: string, from: string, to: string): string {
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.includes("->") && trimmed.includes(from) && trimmed.includes(to)) {
      const match = trimmed.match(/->[^:]*:\s*(.+?)(?:\s*\{|$)/);
      return match ? match[1].trim() : "";
    }
  }
  return "";
}

function Workspace() {
  const theme = useTheme();
  const session = useCopilotSession();
  const choice = useModelChoice(session.catalog);
  const agent = useDiagramAgent({
    selection: choice.selection,
    reviewer: choice.reviewer,
    reviewerSupportsVision: choice.reviewerSupportsVision,
  });
  const running = agent.busy === "running";
  const render = useLiveRender(agent.code, running);

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

  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  const deselect = useCallback(() => {
    setSelected(null);
    setConnectMode(false);
    setConnectSource(null);
  }, []);

  const canUseModels = Boolean(session.auth?.signedIn || session.auth?.providers.azure);
  const showGate = !session.loading && !canUseModels;
  const latestRun = agent.latestRun;
  const fitKey = latestRun?.status === "running" ? `running-${latestRun.id}` : `${latestRun?.id ?? "none"}-${latestRun?.endedAt ?? 0}-${agent.code ? "code" : "empty"}`;

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
        else if (selected || connectMode) deselect();
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
  }, [agent, connectMode, deselect, selected, setInspectorVisible, setLayout]);

  const onElementClick = useCallback(
    (path: string, isConnection: boolean) => {
      if (running) return;
      if (connectMode && connectSource && path && !isConnection) {
        agent.setCode(addConnection(agent.code, connectSource, path, ""));
        deselect();
        return;
      }
      if (!path || selected?.path === path) {
        deselect();
        return;
      }
      if (isConnection) {
        const conn = parseConnectionPath(path);
        setSelected({
          path,
          isConnection: true,
          connectionFrom: conn?.from,
          connectionTo: conn?.to,
          label: conn ? connectionLabel(agent.code, conn.from, conn.to) : "",
        });
      } else {
        setSelected({ path, isConnection: false, label: findElementLabel(agent.code, path) || path.split(".").pop() || path });
      }
    },
    [agent, connectMode, connectSource, deselect, running, selected],
  );

  const onUpdateLabel = useCallback(
    (path: string, label: string, isConnection: boolean) => {
      if (running) return;
      let next: string | null = null;
      if (isConnection) {
        const conn = parseConnectionPath(path);
        if (conn) next = updateConnectionLabel(agent.code, conn.from, conn.to, label);
      } else {
        next = updateElementLabel(agent.code, path, label);
      }
      if (next) {
        agent.setCode(next);
        setSelected((s) => (s ? { ...s, label } : null));
      }
    },
    [agent, running],
  );

  const onDeleteElement = useCallback(
    (path: string, isConnection: boolean) => {
      if (running) return;
      if (isConnection) {
        const conn = parseConnectionPath(path);
        if (!conn) return;
        agent.setCode(deleteConnection(agent.code, conn.from, conn.to));
      } else {
        agent.setCode(deleteElement(agent.code, path));
      }
      deselect();
    },
    [agent, deselect, running],
  );

  const onMoveNode = useCallback(
    (nodePath: string, target: string) => {
      if (running) return;
      const next = moveNodeToContainer(agent.code, nodePath, target);
      if (next) {
        agent.setCode(next);
        deselect();
      }
    },
    [agent, deselect, running],
  );

  const resizeSidebar = useCallback((dx: number) => setLayout((l) => ({ ...l, sidebarWidth: clamp(l.sidebarWidth + dx, 300, 600) })), [setLayout]);
  const resizeInspector = useCallback((dx: number) => setLayout((l) => ({ ...l, inspectorWidth: clamp(l.inspectorWidth - dx, 320, 820) })), [setLayout]);

  const requestNew = useCallback(() => {
    if (agent.code.trim() || agent.items.length > 0 || agent.busy !== "idle") setConfirmNew(true);
    else agent.reset();
  }, [agent]);

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
                  hasDiagram={Boolean(agent.code.trim())}
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
            code={agent.code}
            render={render}
            streaming={running}
            busy={running}
            title={agent.title}
            fitKey={fitKey}
            reviewScore={latestRun?.status === "done" ? latestRun.reviewScore : undefined}
            selectedPath={selected?.path}
            onElementClick={onElementClick}
            onMoveNode={onMoveNode}
            onFixError={agent.fixRenderError}
            onShowCode={() => openInspector("code")}
            onShowQuality={() => openInspector("quality")}
            overlay={
              <ElementEditor
                selected={selected}
                connectMode={connectMode}
                onUpdateLabel={onUpdateLabel}
                onDelete={onDeleteElement}
                onStartConnect={() => {
                  if (selected && !selected.isConnection) {
                    setConnectSource(selected.path);
                    setConnectMode(true);
                  }
                }}
                onCancelConnect={() => {
                  setConnectMode(false);
                  setConnectSource(null);
                }}
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
                code={agent.code}
                onCodeChange={agent.setCode}
                readOnly={running}
                theme={theme.resolved}
                quality={render.quality}
                qualityLoading={render.loading}
                run={latestRun}
                models={choice.models}
                reviewEnabled={agent.settings.review}
                canApplyReview={agent.busy === "idle" && Boolean(agent.code.trim())}
                onApplyReview={agent.applyReview}
              />
            </div>
          </>
        )}
      </main>

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
