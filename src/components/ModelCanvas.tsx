"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { sanitizeSvg } from "@/lib/client/sanitize-svg";
import { clientToModel, dropTargetAt, itemsInRect, nudgeDelta, resizeBox, type ResizeHandle } from "@/lib/model/canvas-geometry";
import { bottom, right, unionBoxes } from "@/lib/model/geometry";
import { deleteItems, moveItems, reparent, resizeGroup } from "@/lib/model/ops";
import { descendants, indexModel, isGroup } from "@/lib/model/query";
import { modelBounds, renderModelSvg } from "@/lib/model/render-svg";
import type { Box, DiagramModel, Point } from "@/lib/model/types";
import { IconButton, cn } from "./ui/primitives";

export interface ModelCanvasProps {
  model: DiagramModel;
  /** Pan/zoom only (used while an AI run is changing the diagram). */
  readOnly?: boolean;
  dimmed?: boolean;
  /** Changing it re-fits the view. */
  fitKey: string | number;
  /** Selected node ids and edge ids (controlled). */
  selection: string[];
  onSelectionChange: (ids: string[]) => void;
  /** Commit an edit (the parent routes lines and records undo history). */
  onApply: (op: (model: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }) => void;
  /** When set, the next click on a node connects `connectFrom` → that node. */
  connectFrom?: string | null;
  onConnect?: (from: string, to: string) => void;
  /** Double-click on an item (the parent focuses its label editor). */
  onRequestRename?: (id: string) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
const CLICK_THRESHOLD = 5;
const DRAG_THRESHOLD = 4;
const GROUP_PADDING = 24;
const HANDLE_SIZE = 8;

/** Value for a double-quoted attribute selector (CSS.escape where available). */
function escapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, (ch) => `\\${ch}`);
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const normalizeRect = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

function closestHit(target: EventTarget | null): { id: string; kind: "node" | "edge" } | null {
  if (!(target instanceof Element)) return null;
  const edge = target.closest("[data-edge]");
  if (edge) {
    const id = edge.getAttribute("data-edge");
    if (id) return { id, kind: "edge" };
  }
  const item = target.closest("[data-id]");
  if (item) {
    const id = item.getAttribute("data-id");
    if (id) return { id, kind: "node" };
  }
  return null;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function edgeBox(route: Point[]): Box | null {
  if (route.length === 0) return null;
  return unionBoxes(route.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
}

function selectionRootIds(model: DiagramModel, ids: string[]): string[] {
  const index = indexModel(model);
  return ids.filter((id) => {
    const node = index.byId.get(id);
    if (!node) return false;
    let parent = node.parent;
    while (parent !== null) {
      if (ids.includes(parent)) return false;
      parent = index.byId.get(parent)?.parent ?? null;
    }
    return true;
  });
}

function subtreeNodeIds(model: DiagramModel, roots: string[]): string[] {
  const index = indexModel(model);
  const ids = new Set<string>();
  for (const id of roots) {
    if (!index.byId.has(id)) continue;
    ids.add(id);
    for (const child of descendants(index, id)) ids.add(child.id);
  }
  return [...ids];
}

function childMinimumBox(model: DiagramModel, id: string, fallback: Box): Box {
  const index = indexModel(model);
  const children = index.children.get(id) ?? [];
  const box = unionBoxes(children.map((child) => child.box));
  if (!box) return { ...fallback, w: 80, h: 60 };
  return {
    x: Math.min(fallback.x, box.x - GROUP_PADDING),
    y: Math.min(fallback.y, box.y - GROUP_PADDING),
    w: Math.max(80, right(box) - fallback.x + GROUP_PADDING),
    h: Math.max(60, bottom(box) - fallback.y + GROUP_PADDING),
  };
}

export default function ModelCanvas({
  model,
  readOnly = false,
  dimmed = false,
  fitKey,
  selection,
  onSelectionChange,
  onApply,
  connectFrom = null,
  onConnect,
  onRequestRename,
}: ModelCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [boxSelect, setBoxSelect] = useState<Box | null>(null);
  const [resizePreview, setResizePreview] = useState<Box | null>(null);
  const [dragging, setDragging] = useState(false);

  const pointerStart = useRef<Point | null>(null);
  const modelStart = useRef<Point | null>(null);
  // Raw drop target of the current drag: undefined = not over anything yet, null = top level.
  const dropRef = useRef<string | null | undefined>(undefined);
  const pointerHit = useRef<{ id: string; kind: "node" | "edge" } | null>(null);
  const pendingConnectTarget = useRef<string | null>(null);
  const translateStart = useRef({ x: 0, y: 0 });
  const gesture = useRef<
    | null
    | { type: "click" }
    | { type: "pan" }
    | { type: "box"; base: string[] }
    | { type: "move"; roots: string[]; nodes: string[]; sourceParent: string | null }
    | { type: "resize"; id: string; handle: ResizeHandle; startBox: Box; minW: number; minH: number }
  >(null);

  const renderedSvg = useMemo(() => renderModelSvg(model, { idPrefix: "canvas-" }), [model]);
  // React 19 re-applies dangerouslySetInnerHTML whenever the object changes, so keep it stable:
  // otherwise every hover or drag re-render would rebuild the whole diagram DOM.
  const svgHtml = useMemo(() => ({ __html: sanitizeSvg(renderedSvg) }), [renderedSvg]);
  const bounds = useMemo(() => modelBounds(model), [model]);
  const viewBox = useMemo<Box>(() => ({ x: bounds.x - 40, y: bounds.y - 40, w: bounds.w + 80, h: bounds.h + 80 }), [bounds]);
  const index = useMemo(() => indexModel(model), [model]);

  // Overlay outlines and handles keep a constant on-screen size whatever the zoom.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setHostSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const pxPerUnit = hostSize.w > 0 && hostSize.h > 0 ? Math.min(hostSize.w / viewBox.w, hostSize.h / viewBox.h) * view.scale : 1;
  const unit = 1 / pxPerUnit;

  const getSvg = useCallback(() => svgHostRef.current?.querySelector("svg") as SVGSVGElement | null, []);
  const modelPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const svg = getSvg();
      const rect = svg?.getBoundingClientRect();
      const vb = svg?.viewBox.baseVal;
      return clientToModel({ x: clientX, y: clientY }, rect && rect.width > 0 && rect.height > 0 ? rect : { left: 0, top: 0, width: 1, height: 1 }, vb ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : viewBox);
    },
    [getSvg, viewBox],
  );

  const fit = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fit();
  }, [fitKey, fit]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const anchor =
      rect && clientX !== undefined && clientY !== undefined
        ? { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
        : { x: 0, y: 0 };
    setView((v) => {
      const next = clampScale(v.scale * factor);
      return {
        scale: next,
        x: anchor.x - ((anchor.x - v.x) / v.scale) * next,
        y: anchor.y - ((anchor.y - v.y) / v.scale) * next,
      };
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const clearPreview = useCallback(() => {
    const host = svgHostRef.current;
    if (host) {
      host.querySelectorAll<SVGGElement>("[data-id]").forEach((el) => {
        el.style.transform = "";
        el.style.opacity = "";
      });
      host.querySelectorAll<SVGGElement>("[data-edge]").forEach((el) => {
        el.style.opacity = "";
      });
    }
    setDropTarget(null);
    setBoxSelect(null);
    setResizePreview(null);
    setDragging(false);
  }, []);

  const cancelPointer = useCallback(() => {
    pointerStart.current = null;
    modelStart.current = null;
    dropRef.current = undefined;
    pointerHit.current = null;
    pendingConnectTarget.current = null;
    gesture.current = null;
    setPanning(false);
    clearPreview();
  }, [clearPreview]);

  const applyMovePreview = useCallback(
    (nodes: string[], dx: number, dy: number) => {
      const host = svgHostRef.current;
      if (!host) return;
      const moving = new Set(nodes);
      for (const id of nodes) {
        const el = host.querySelector<SVGGElement>(`[data-id="${escapeAttr(id)}"]`);
        if (el) {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          el.style.opacity = "0.75";
        }
      }
      host.querySelectorAll<SVGGElement>("[data-edge]").forEach((el) => {
        const id = el.getAttribute("data-edge");
        const edge = id ? index.edgeById.get(id) : undefined;
        el.style.opacity = edge && (moving.has(edge.from) || moving.has(edge.to)) ? "0.25" : "";
      });
    },
    [index.edgeById],
  );

  const updateSelection = useCallback(
    (id: string, toggle: boolean) => {
      if (!toggle) {
        onSelectionChange([id]);
        return;
      }
      onSelectionChange(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
    },
    [onSelectionChange, selection],
  );

  const finishClick = useCallback(
    (e: React.PointerEvent, start: Point) => {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved >= CLICK_THRESHOLD) return;
      const hit = closestHit(e.target) ?? pointerHit.current;
      if (connectFrom) {
        if (hit?.kind === "node" && hit.id !== connectFrom) onConnect?.(connectFrom, hit.id);
        return;
      }
      if (readOnly) return;
      if (hit) updateSelection(hit.id, e.shiftKey || e.ctrlKey || e.metaKey);
      else onSelectionChange([]);
    },
    [connectFrom, onConnect, onSelectionChange, readOnly, updateSelection],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = closestHit(e.target);
    pointerHit.current = hit;
    const point = modelPoint(e.clientX, e.clientY);
    pointerStart.current = { x: e.clientX, y: e.clientY };
    modelStart.current = point;
    translateStart.current = { x: view.x, y: view.y };

    if (connectFrom) {
      pendingConnectTarget.current = hit?.kind === "node" && hit.id !== connectFrom ? hit.id : null;
      gesture.current = { type: "click" };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }

    if (!readOnly && !connectFrom) {
      const handle = (e.target as Element).closest("[data-resize-handle]")?.getAttribute("data-resize-handle") as ResizeHandle | null;
      const selectedNode = selection.length === 1 ? index.byId.get(selection[0]) : undefined;
      if (handle && selectedNode && isGroup(index, selectedNode.id)) {
        const min = childMinimumBox(model, selectedNode.id, selectedNode.box);
        gesture.current = { type: "resize", id: selectedNode.id, handle, startBox: selectedNode.box, minW: min.w, minH: min.h };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      if (hit?.kind === "node") {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          gesture.current = { type: "click" };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          return;
        }
        const nextSelection = selection.includes(hit.id) ? selection : [hit.id];
        if (!sameSet(nextSelection, selection)) onSelectionChange(nextSelection);
        // Generated page nodes (an Architecture title) are placed by the layout, never dragged.
        const roots = selectionRootIds(model, nextSelection).filter((id) => !index.byId.get(id)?.generated);
        gesture.current = roots.length > 0 ? { type: "move", roots, nodes: subtreeNodeIds(model, roots), sourceParent: index.byId.get(roots[0])?.parent ?? null } : { type: "click" };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      if (!hit && e.shiftKey) {
        gesture.current = { type: "box", base: selection };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    }

    gesture.current = { type: "pan" };
    setPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const currentGesture = gesture.current;
    if ((currentGesture || panning) && e.pointerType === "mouse" && e.buttons === 0) {
      cancelPointer();
      return;
    }
    const hit = closestHit(e.target);
    setHoverId(hit?.id ?? null);
    if (!currentGesture || !pointerStart.current || !modelStart.current) return;

    if (currentGesture.type === "pan") {
      setView((v) => ({
        ...v,
        x: translateStart.current.x + (e.clientX - pointerStart.current!.x),
        y: translateStart.current.y + (e.clientY - pointerStart.current!.y),
      }));
      return;
    }
    if (currentGesture.type === "click") return;

    const current = modelPoint(e.clientX, e.clientY);
    const dx = current.x - modelStart.current.x;
    const dy = current.y - modelStart.current.y;
    if (currentGesture.type === "box") {
      setBoxSelect(normalizeRect(modelStart.current, modelPoint(e.clientX, e.clientY)));
      return;
    }
    if (currentGesture.type === "resize") {
      setResizePreview(resizeBox(currentGesture.startBox, currentGesture.handle, dx, dy, currentGesture.minW, currentGesture.minH));
      return;
    }
    if (currentGesture.type === "move") {
      if (!dragging && Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) < DRAG_THRESHOLD) return;
      if (!dragging) setDragging(true);
      applyMovePreview(currentGesture.nodes, dx, dy);
      const target = dropTargetAt(model, current, currentGesture.roots);
      dropRef.current = target;
      setDropTarget(target !== currentGesture.sourceParent ? target : null);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const currentGesture = gesture.current;
    const start = pointerStart.current;
    if (connectFrom && start) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < CLICK_THRESHOLD && pendingConnectTarget.current) {
        onConnect?.(connectFrom, pendingConnectTarget.current);
      }
      cancelPointer();
      return;
    }
    if (!currentGesture || !start) {
      cancelPointer();
      return;
    }
    if (currentGesture.type === "move" && dragging && modelStart.current) {
      const end = modelPoint(e.clientX, e.clientY);
      const dx = Math.round(end.x - modelStart.current.x);
      const dy = Math.round(end.y - modelStart.current.y);
      const roots = currentGesture.roots;
      const target = dropRef.current;
      // Only a drop onto a different group (or out to the top level) regroups; moving inside the same group just moves.
      if (roots.length === 1 && target !== undefined && target !== currentGesture.sourceParent) {
        const at = { x: (index.byId.get(roots[0])?.box.x ?? 0) + dx, y: (index.byId.get(roots[0])?.box.y ?? 0) + dy };
        // Ids are D2 paths, so regrouping renames the node; the pure op gives the new id up front.
        const nextId = reparent(model, roots[0], target, at).id;
        onApply((draft) => reparent(draft, roots[0], target, at).model);
        onSelectionChange([nextId]);
      } else {
        onApply((draft) => moveItems(draft, roots, dx, dy));
      }
      cancelPointer();
      return;
    }
    if (currentGesture.type === "box" && boxSelect) {
      onSelectionChange([...new Set([...currentGesture.base, ...itemsInRect(model, boxSelect)])]);
      cancelPointer();
      return;
    }
    if (currentGesture.type === "resize" && resizePreview) {
      const box = resizePreview;
      onApply((draft) => resizeGroup(draft, currentGesture.id, box));
      cancelPointer();
      return;
    }
    if (currentGesture.type === "pan") setPanning(false);
    finishClick(e, start);
    cancelPointer();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "+" || e.key === "=") {
      zoomAt(1.2);
      e.preventDefault();
      return;
    }
    if (e.key === "-" || e.key === "_") {
      zoomAt(1 / 1.2);
      e.preventDefault();
      return;
    }
    if (e.key === "0") {
      fit();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      if (!readOnly && selection.length > 0 && !connectFrom) {
        onSelectionChange([]);
        e.preventDefault();
      }
      return;
    }
    if (readOnly) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selection.length > 0) {
      const ids = [...selection];
      onApply((draft) => deleteItems(draft, ids));
      onSelectionChange([]);
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      onSelectionChange([...model.nodes.map((node) => node.id), ...model.edges.map((edge) => edge.id)]);
      e.preventDefault();
      return;
    }
    const delta = nudgeDelta(e.key, e.shiftKey);
    if ((delta.x !== 0 || delta.y !== 0) && selection.length > 0) {
      const roots = selectionRootIds(model, selection);
      onApply((draft) => moveItems(draft, roots, delta.x, delta.y), { coalesceKey: "nudge" });
      e.preventDefault();
    }
  };

  const selectedBoxes = selection.reduce<Array<{ id: string; box: Box; kind: "node" | "edge" }>>((boxes, id) => {
    if (!readOnly) {
      const node = index.byId.get(id);
      if (node) boxes.push({ id, box: resizePreview && id === selection[0] ? resizePreview : node.box, kind: "node" });
      else {
        const edge = index.edgeById.get(id);
        const box = edge ? edgeBox(edge.route) : null;
        if (box) boxes.push({ id, box, kind: "edge" });
      }
    }
    return boxes;
  }, []);
  const hoverNode = !readOnly && hoverId && !selection.includes(hoverId) ? index.byId.get(hoverId) : null;
  const selectedGroup = selection.length === 1 ? index.byId.get(selection[0]) : undefined;
  const showHandles = !readOnly && selectedGroup && isGroup(index, selectedGroup.id);

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label="Editable diagram canvas. Drag empty space to pan, scroll to zoom, click to select, Shift-drag to select a box, Delete removes, arrow keys nudge, plus and minus zoom, 0 fits."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        onDoubleClick={(e) => {
          const hit = closestHit(e.target);
          if (!readOnly && hit) onRequestRename?.(hit.id);
        }}
        className={cn(
          "h-full w-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/50",
          connectFrom ? "cursor-crosshair" : dragging || panning ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div
          ref={contentRef}
          className={cn("diagram-paper flex h-full w-full items-center justify-center p-8 transition-opacity", dimmed && "opacity-60")}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center center",
            transition: panning || dragging ? "none" : "transform 120ms ease-out",
          }}
        >
          <div className="relative h-full w-full">
            <div ref={svgHostRef} className="model-canvas-host h-full w-full" dangerouslySetInnerHTML={svgHtml} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`} aria-hidden>
              {selectedBoxes.map(({ id, box }) => (
                <rect
                  key={id}
                  x={box.x - 5 * unit}
                  y={box.y - 5 * unit}
                  width={box.w + 10 * unit}
                  height={box.h + 10 * unit}
                  rx={8 * unit}
                  fill="rgba(99, 102, 241, 0.08)"
                  stroke="#6366f1"
                  strokeWidth={2}
                  strokeDasharray={`${6 * unit} ${3 * unit}`}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {hoverNode && (
                <rect x={hoverNode.box.x - 4 * unit} y={hoverNode.box.y - 4 * unit} width={hoverNode.box.w + 8 * unit} height={hoverNode.box.h + 8 * unit} rx={8 * unit} fill="none" stroke="#818cf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
              {dropTarget &&
                (() => {
                  const node = index.byId.get(dropTarget);
                  return node ? <rect x={node.box.x - 6 * unit} y={node.box.y - 6 * unit} width={node.box.w + 12 * unit} height={node.box.h + 12 * unit} rx={10 * unit} fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" strokeWidth={2} strokeDasharray={`${4 * unit} ${2 * unit}`} vectorEffect="non-scaling-stroke" /> : null;
                })()}
              {boxSelect && <rect x={boxSelect.x} y={boxSelect.y} width={boxSelect.w} height={boxSelect.h} fill="rgba(99, 102, 241, 0.10)" stroke="#6366f1" strokeWidth={1.5} strokeDasharray={`${4 * unit} ${3 * unit}`} vectorEffect="non-scaling-stroke" />}
              {showHandles &&
                (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as ResizeHandle[]).map((handle) => {
                  const box = resizePreview ?? selectedGroup.box;
                  const x = handle.includes("w") ? box.x : handle.includes("e") ? right(box) : box.x + box.w / 2;
                  const y = handle.includes("n") ? box.y : handle.includes("s") ? bottom(box) : box.y + box.h / 2;
                  const size = HANDLE_SIZE * unit;
                  return <rect key={handle} data-resize-handle={handle} x={x - size / 2} y={y - size / 2} width={size} height={size} rx={2 * unit} fill="#ffffff" stroke="#4f46e5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="pointer-events-auto" />;
                })}
            </svg>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-xl border border-zinc-200 bg-white/90 p-1 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <IconButton label="Zoom out (−)" size="sm" onClick={() => zoomAt(1 / 1.2)}>
          <Minus className="size-4" />
        </IconButton>
        <button
          type="button"
          onClick={fit}
          title="Reset zoom (0)"
          className="min-w-12 rounded-md px-1 py-1 text-center text-xs font-medium tabular-nums text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <IconButton label="Zoom in (+)" size="sm" onClick={() => zoomAt(1.2)}>
          <Plus className="size-4" />
        </IconButton>
        <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
        <IconButton label="Fit to screen (0)" size="sm" onClick={fit}>
          <Maximize className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
