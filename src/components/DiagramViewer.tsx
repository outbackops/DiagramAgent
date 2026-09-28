"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { findD2Element, getParentPath } from "@/lib/d2-editor";
import { sanitizeSvg } from "@/lib/client/sanitize-svg";
import { IconButton, cn } from "./ui/primitives";

interface DiagramViewerProps {
  svg: string;
  /** Changing this value re-fits the view (e.g. when a new diagram arrives). */
  fitKey: string | number;
  dimmed?: boolean;
  selectedPath?: string | null;
  onElementClick?: (path: string, isConnection: boolean) => void;
  onMoveNode?: (nodePath: string, targetContainerPath: string) => void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 6;
const CLICK_THRESHOLD = 5;
const DRAG_THRESHOLD = 10;

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export default function DiagramViewer({ svg, fitKey, dimmed = false, selectedPath, onElementClick, onMoveNode }: DiagramViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Scale and pan offset live together so a zoom around the cursor is one pure update.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const scale = view.scale;
  const [panning, setPanning] = useState(false);

  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const translateStart = useRef({ x: 0, y: 0 });
  const dragSource = useRef<{ path: string; startX: number; startY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const safeSvg = useMemo(() => sanitizeSvg(svg), [svg]);

  const fit = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    // Re-fit when the parent signals a new diagram.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fit();
  }, [fitKey, fit]);

  /** Zoom by `factor`, keeping the point under (clientX, clientY) fixed on screen. */
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

  // React's onWheel is passive; zooming needs preventDefault.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(factor, e.clientX, e.clientY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Selection + drop-target highlight overlays.
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !safeSvg) return;
    container.querySelectorAll(".d2-element-highlight, .d2-drop-highlight").forEach((el) => el.remove());
    container.querySelectorAll<SVGGElement>("[data-d2-selected]").forEach((el) => {
      el.removeAttribute("data-d2-selected");
      el.style.transform = "";
      el.style.opacity = "";
    });

    const highlight = (path: string, color: string, dash: string, fill: string, cssClass: string, drag: boolean) => {
      let encoded: string;
      let encodedAlt: string;
      try {
        encoded = btoa(path);
        encodedAlt = btoa(path.replace(/>/g, "&gt;"));
      } catch {
        return;
      }
      for (const g of container.querySelectorAll<SVGGElement>("g[class]")) {
        const classes = (g.getAttribute("class") || "").split(/\s+/);
        if (!classes.includes(encoded) && !classes.includes(encodedAlt)) continue;
        const box = g.getBBox?.();
        if (box) {
          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", String(box.x - 5));
          rect.setAttribute("y", String(box.y - 5));
          rect.setAttribute("width", String(box.width + 10));
          rect.setAttribute("height", String(box.height + 10));
          rect.setAttribute("rx", "8");
          rect.setAttribute("fill", fill);
          rect.setAttribute("stroke", color);
          rect.setAttribute("stroke-width", "2.5");
          rect.setAttribute("stroke-dasharray", dash);
          rect.setAttribute("pointer-events", "none");
          rect.classList.add(cssClass);
          g.parentNode?.insertBefore(rect, g);
        }
        g.setAttribute("data-d2-selected", "true");
        if (drag) {
          g.style.transform = `translate(${dragOffset.x}px, ${dragOffset.y}px)`;
          g.style.opacity = "0.7";
        }
        return;
      }
    };

    if (selectedPath) highlight(selectedPath, "#6366f1", "6 3", "rgba(99, 102, 241, 0.08)", "d2-element-highlight", dragging);
    if (dropTarget) highlight(dropTarget, "#10b981", "4 2", "rgba(16, 185, 129, 0.12)", "d2-drop-highlight", false);
  }, [selectedPath, dropTarget, safeSvg, dragging, dragOffset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
    if (selectedPath && onMoveNode) {
      const hit = findD2Element(e.target as Element);
      if (hit && !hit.isConnection && hit.path === selectedPath) {
        dragSource.current = { path: hit.path, startX: e.clientX, startY: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        return;
      }
    }
    translateStart.current = { x: view.x, y: view.y };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  /** Abandon a pan or node drag without committing anything. Safe to call more than once. */
  const cancelPointer = () => {
    dragSource.current = null;
    pointerStart.current = null;
    setDragging(false);
    setDragOffset({ x: 0, y: 0 });
    setDropTarget(null);
    setPanning(false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // The button was released somewhere we never heard about (e.g. outside the window).
    if ((dragSource.current || panning) && e.pointerType === "mouse" && e.buttons === 0) {
      cancelPointer();
      return;
    }
    if (dragSource.current && pointerStart.current) {
      const dx = e.clientX - dragSource.current.startX;
      const dy = e.clientY - dragSource.current.startY;
      if (dragging || Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        if (!dragging) setDragging(true);
        setDragOffset({ x: dx / scale, y: dy / scale });
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const hit = under ? findD2Element(under) : null;
        const sourceParent = getParentPath(dragSource.current.path);
        setDropTarget(hit && !hit.isConnection && hit.path !== dragSource.current.path && hit.path !== sourceParent ? hit.path : null);
      }
      return;
    }
    if (!panning || !pointerStart.current) return;
    const origin = pointerStart.current;
    setView((v) => ({
      ...v,
      x: translateStart.current.x + (e.clientX - origin.x),
      y: translateStart.current.y + (e.clientY - origin.y),
    }));
  };

  const endPointer = (e: React.PointerEvent) => {
    const start = pointerStart.current;
    if (dragSource.current) {
      if (dragging && dropTarget && onMoveNode) onMoveNode(dragSource.current.path, dropTarget);
      const wasDragging = dragging;
      dragSource.current = null;
      setDragging(false);
      setDragOffset({ x: 0, y: 0 });
      setDropTarget(null);
      if (wasDragging) {
        pointerStart.current = null;
        return;
      }
    }
    setPanning(false);
    if (start && onElementClick && e.type === "pointerup") {
      if (Math.abs(e.clientX - start.x) < CLICK_THRESHOLD && Math.abs(e.clientY - start.y) < CLICK_THRESHOLD) {
        const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
        const hit = findD2Element(target);
        onElementClick(hit?.path ?? "", hit?.isConnection ?? false);
      }
    }
    pointerStart.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomAt(1.2);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.2);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="application"
        aria-label="Diagram canvas. Drag to pan, scroll to zoom, plus and minus keys zoom, 0 fits."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        className={cn(
          "h-full w-full touch-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/50",
          dragging ? "cursor-grabbing" : panning ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div
          ref={contentRef}
          className={cn("diagram-paper flex h-full w-full items-center justify-center p-8 transition-opacity", dimmed && "opacity-60")}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${scale})`,
            transformOrigin: "center center",
            transition: panning || dragging ? "none" : "transform 120ms ease-out",
          }}
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
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
          {Math.round(scale * 100)}%
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
