"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface D2RendererProps {
  code: string;
  className?: string;
}

export default function D2Renderer({ code, className = "" }: D2RendererProps) {
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

  // Server-side render via /api/render
  const renderDiagram = useCallback(async (d2Code: string) => {
    if (!d2Code.trim()) {
      setSvg("");
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: d2Code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to render diagram");
        setSvg("");
      } else {
        setSvg(data.svg);
        setError("");
      }
    } catch (err: any) {
      setError(err?.message || "Network error");
      setSvg("");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced render on code change
  useEffect(() => {
    if (!code) {
      setSvg("");
      setError("");
      return;
    }
    const timeout = setTimeout(() => renderDiagram(code), 400);
    return () => clearTimeout(timeout);
  }, [code, renderDiagram]);

  // Fit diagram to container when SVG changes
  useEffect(() => {
    if (svg) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
  }, [svg]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.min(Math.max(s * delta, 0.1), 5));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    setTranslate((t) => {
      translateStart.current = { ...t };
      return t;
    });
    e.currentTarget.style.cursor = "grabbing";
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTranslate({
      x: translateStart.current.x + dx,
      y: translateStart.current.y + dy,
    });
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    isPanning.current = false;
    e.currentTarget.style.cursor = "grab";
  }, []);

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
    if (!svg) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    const fullSvg = svg.startsWith("<svg")
      ? `<?xml version="1.0" encoding="utf-8"?>${svg}`
      : svg;
    const svgBlob = new Blob([fullSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

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

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300 mr-auto">
          Diagram Preview
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
      </div>

      {/* Diagram Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-white dark:bg-gray-900 relative"
        style={{ cursor: svg ? "grab" : "default" }}
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
