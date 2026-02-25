"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { findD2Element, parseConnectionPath, getParentPath } from "@/lib/d2-editor";

interface D2RendererProps {
  code: string;
  isStreaming?: boolean;
  /** Callback when user clicks a diagram element. Passes the D2 path and whether it's a connection. */
  onElementClick?: (path: string, isConnection: boolean) => void;
  /** Callback when user drags a node onto a different container */
  onMoveNode?: (nodePath: string, targetContainerPath: string) => void;
  /** The currently selected element path (for highlight styling) */
  selectedPath?: string | null;
  className?: string;
}

export default function D2Renderer({ code, isStreaming = false, onElementClick, onMoveNode, selectedPath, className = "" }: D2RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Pan + zoom state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  // Render request tracking for abort + race condition prevention
  const renderIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Click vs drag detection
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const CLICK_THRESHOLD = 5; // pixels — if mouse moves less than this, it's a click
  const DRAG_THRESHOLD = 10; // pixels — start element drag after this distance

  // Element drag state
  const [isDraggingElement, setIsDraggingElement] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragSourceRef = useRef<{ path: string; element: Element; startX: number; startY: number } | null>(null);

  // Server-side render via /api/render
  const renderDiagram = useCallback(async (d2Code: string, requestId: number) => {
    if (!d2Code.trim()) {
      setSvg("");
      setError("");
      return;
    }

    // Abort any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: d2Code }),
        signal: controller.signal,
      });

      // Race condition guard: ignore response if a newer request was made
      if (renderIdRef.current !== requestId) return;

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to render diagram");
        setSvg("");
      } else {
        setSvg(data.svg);
        setError("");
      }
    } catch (err: any) {
      if (err.name === "AbortError") return; // Silently ignore aborted requests
      if (renderIdRef.current !== requestId) return;
      setError(err?.message || "Network error");
      setSvg("");
    } finally {
      if (renderIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  // Debounced render on code change — longer debounce during streaming
  useEffect(() => {
    if (!code) {
      setSvg("");
      setError("");
      return;
    }
    const debounceMs = isStreaming ? 1200 : 400;
    const id = ++renderIdRef.current;
    const timeout = setTimeout(() => renderDiagram(code, id), debounceMs);
    return () => clearTimeout(timeout);
  }, [code, isStreaming, renderDiagram]);

  // Reset zoom/pan only when streaming stops (not on every SVG update)
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && svg) {
      // Streaming just ended — fit to view
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, svg]);

  // Highlight selected element and apply drag visual offset
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !svg) return;

    // Remove previous highlights and transforms
    container.querySelectorAll(".d2-element-highlight, .d2-drop-highlight").forEach((el) => el.remove());
    container.querySelectorAll("[data-d2-selected]").forEach((el) => {
      el.removeAttribute("data-d2-selected");
      (el as HTMLElement).style.transform = "";
      (el as HTMLElement).style.opacity = "";
    });
    container.querySelectorAll("[data-d2-drop-target]").forEach((el) => el.removeAttribute("data-d2-drop-target"));

    const highlightElement = (path: string, color: string, dashArray: string, fillOpacity: string, cssClass: string) => {
      try {
        const encoded = btoa(path);
        const encodedAlt = btoa(path.replace(/>/g, "&gt;"));
        const allGroups = container.querySelectorAll("g[class]");
        for (const g of allGroups) {
          const classes = g.getAttribute("class") || "";
          if (classes.split(/\s+/).includes(encoded) || classes.split(/\s+/).includes(encodedAlt)) {
            const bbox = (g as SVGGraphicsElement).getBBox?.();
            if (bbox) {
              const highlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
              highlight.setAttribute("x", String(bbox.x - 4));
              highlight.setAttribute("y", String(bbox.y - 4));
              highlight.setAttribute("width", String(bbox.width + 8));
              highlight.setAttribute("height", String(bbox.height + 8));
              highlight.setAttribute("rx", "6");
              highlight.setAttribute("fill", fillOpacity);
              highlight.setAttribute("stroke", color);
              highlight.setAttribute("stroke-width", "2");
              highlight.setAttribute("stroke-dasharray", dashArray);
              highlight.classList.add(cssClass);
              g.parentNode?.insertBefore(highlight, g);
            }

            // Apply drag offset to the selected element
            if (cssClass === "d2-element-highlight" && isDraggingElement && (dragOffset.x !== 0 || dragOffset.y !== 0)) {
              (g as HTMLElement).style.transform = `translate(${dragOffset.x}px, ${dragOffset.y}px)`;
              (g as HTMLElement).style.opacity = "0.7";
              g.setAttribute("data-d2-selected", "true");
            } else if (cssClass === "d2-element-highlight") {
              g.setAttribute("data-d2-selected", "true");
            }
            return;
          }
        }
      } catch {
        // base64 encoding failed
      }
    };

    // Highlight selected element
    if (selectedPath) {
      highlightElement(selectedPath, "#3b82f6", "6 3", "rgba(59, 130, 246, 0.08)", "d2-element-highlight");
    }

    // Highlight drop target container
    if (dropTarget) {
      highlightElement(dropTarget, "#22c55e", "4 2", "rgba(34, 197, 94, 0.12)", "d2-drop-highlight");
    }
  }, [selectedPath, dropTarget, svg, isDraggingElement, dragOffset]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.min(Math.max(s * delta, 0.1), 5));
  }, []);

  // Pan handlers — with click detection for element selection and element dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };

    // Check if we're clicking on a selected element (start drag)
    if (selectedPath && onMoveNode) {
      const target = e.target as Element;
      const hit = findD2Element(target);
      if (hit && !hit.isConnection && hit.path === selectedPath) {
        dragSourceRef.current = { path: hit.path, element: hit.element, startX: e.clientX, startY: e.clientY };
        // Don't start panning yet — wait to see if it's a drag
        return;
      }
    }

    // Otherwise, start panning
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    setTranslate((t) => {
      translateStart.current = { ...t };
      return t;
    });
    (e.currentTarget as HTMLElement).style.cursor = "grabbing";
  }, [selectedPath, onMoveNode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Element drag mode
    if (dragSourceRef.current && mouseDownPosRef.current) {
      const dx = e.clientX - dragSourceRef.current.startX;
      const dy = e.clientY - dragSourceRef.current.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD || isDraggingElement) {
        if (!isDraggingElement) setIsDraggingElement(true);
        setDragOffset({ x: dx / scale, y: dy / scale });

        // Check for drop target (container under cursor)
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target) {
          const hit = findD2Element(target);
          if (hit && !hit.isConnection && hit.path !== dragSourceRef.current.path) {
            // Check it's a container (has dot in path or is different from source's parent)
            const sourceParent = getParentPath(dragSourceRef.current.path);
            if (hit.path !== sourceParent) {
              setDropTarget(hit.path);
            } else {
              setDropTarget(null);
            }
          } else {
            setDropTarget(null);
          }
        }
        return;
      }
    }

    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTranslate({
      x: translateStart.current.x + dx,
      y: translateStart.current.y + dy,
    });
  }, [scale, isDraggingElement]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Handle element drop
    if (isDraggingElement && dragSourceRef.current && dropTarget && onMoveNode) {
      onMoveNode(dragSourceRef.current.path, dropTarget);
      setIsDraggingElement(false);
      setDragOffset({ x: 0, y: 0 });
      setDropTarget(null);
      dragSourceRef.current = null;
      mouseDownPosRef.current = null;
      return;
    }

    // Cancel element drag without drop
    if (dragSourceRef.current) {
      setIsDraggingElement(false);
      setDragOffset({ x: 0, y: 0 });
      setDropTarget(null);
      dragSourceRef.current = null;
    }

    const wasPanning = isPanning.current;
    isPanning.current = false;
    (e.currentTarget as HTMLElement).style.cursor = svg ? "grab" : "default";

    // Detect click (not drag) for element selection
    if (mouseDownPosRef.current && onElementClick) {
      const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
      if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
        // This was a click, not a drag — try to find a D2 element
        const target = e.target as Element;
        const hit = findD2Element(target);
        if (hit) {
          e.stopPropagation();
          onElementClick(hit.path, hit.isConnection);
        } else {
          // Clicked on empty space — deselect
          onElementClick("", false);
        }
      }
    }
    mouseDownPosRef.current = null;
  }, [svg, onElementClick, onMoveNode, isDraggingElement, dropTarget]);

  const handleZoomIn = () => setScale((s) => Math.min(s * 1.2, 5));
  const handleZoomOut = () => setScale((s) => Math.max(s / 1.2, 0.1));
  const handleFit = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const exportSvg = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [svg]);

  const exportPng = useCallback(async () => {
    if (!svg || typeof svg !== "string") return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    const fullSvg = svg.startsWith("<svg") || svg.startsWith("<?xml")
      ? (svg.startsWith("<?xml") ? svg : `<?xml version="1.0" encoding="utf-8"?>${svg}`)
      : svg;
    const svgBlob = new Blob([fullSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onerror = () => {
      console.warn("PNG export: failed to load SVG as image");
      URL.revokeObjectURL(url);
    };
    img.onload = () => {
      const s = 2;
      canvas.width = img.width * s;
      canvas.height = img.height * s;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl;
        a.download = "diagram.png";
        a.click();
        URL.revokeObjectURL(pngUrl);
      }, "image/png");

      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [svg]);

  const [exportingVsdx, setExportingVsdx] = useState(false);

  const exportVsdx = useCallback(async () => {
    if (!svg || typeof svg !== "string") return;
    setExportingVsdx(true);
    try {
      const res = await fetch("/api/export/vsdx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ svg, title: "Architecture Diagram" }),
      });
      if (!res.ok) {
        let errorMsg = "Export failed";
        try {
          const err = await res.json();
          errorMsg = err.error || errorMsg;
        } catch {
          // response wasn't JSON
        }
        console.error("VSDX export error:", errorMsg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "diagram.drawio";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("VSDX export error:", err);
    } finally {
      setExportingVsdx(false);
    }
  }, [svg]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300 mr-auto">
          Diagram Preview
          {selectedPath && !isDraggingElement && (
            <span className="ml-2 text-xs text-blue-500 font-normal">
              — click to select, drag to move
            </span>
          )}
          {isDraggingElement && (
            <span className="ml-2 text-xs text-green-500 font-normal">
              — drop on a container to move
            </span>
          )}
        </span>
        {loading && (
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        )}
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          title="Zoom Out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <span className="text-xs text-gray-500 min-w-[3rem] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          title="Zoom In"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleFit}
          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
          title="Fit to Screen"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
          </svg>
        </button>
        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
        <button
          onClick={exportSvg}
          disabled={!svg}
          className="px-2 py-1 text-xs rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          SVG
        </button>
        <button
          onClick={exportPng}
          disabled={!svg}
          className="px-2 py-1 text-xs rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          PNG
        </button>
        <button
          onClick={exportVsdx}
          disabled={!svg || exportingVsdx}
          className="px-2 py-1 text-xs rounded bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-600 dark:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          title="Export as draw.io file (opens in draw.io, Visio, Lucidchart)"
        >
          {exportingVsdx && <div className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />}
          Visio
        </button>
      </div>

      {/* Diagram Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-white dark:bg-gray-900 relative"
        style={{ cursor: isDraggingElement ? "grabbing" : svg ? "grab" : "default" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="max-w-md p-4 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 rounded-lg">
              <p className="font-medium mb-1">Rendering Error</p>
              <p className="font-mono text-xs whitespace-pre-wrap">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && !svg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span className="text-sm">Enter a prompt to generate a diagram</span>
          </div>
        )}

        {svg && (
          <div
            ref={svgContainerRef}
            className="w-full h-full flex items-center justify-center"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: "center center",
              transition: isPanning.current ? "none" : "transform 0.15s ease-out",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}
