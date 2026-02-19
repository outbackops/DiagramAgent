"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import PromptInput from "@/components/PromptInput";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });
const D2Renderer = dynamic(() => import("@/components/D2Renderer"), { ssr: false });

export default function Home() {
  const [d2Code, setD2Code] = useState("");
  const [renderCode, setRenderCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(async (prompt: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);
    setD2Code("");
    setRenderCode("");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, existingCode: "" }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `API error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulated += parsed.content;
              // Strip markdown code fences if LLM wraps output
              const cleaned = accumulated
                .replace(/^```d2?\n?/m, "")
                .replace(/\n?```$/m, "");
              setD2Code(cleaned);
            }
          } catch {
            // skip
          }
        }
      }

      // Final render with cleaned code
      const final = accumulated
        .replace(/^```d2?\n?/m, "")
        .replace(/\n?```$/m, "")
        .trim();
      setD2Code(final);
      setRenderCode(final);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Generation error:", err);
        setD2Code(`// Error: ${err.message}\n// Please check your Azure AI Foundry configuration.`);
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleRerender = useCallback(() => {
    setRenderCode(d2Code);
  }, [d2Code]);

  const handleRefine = useCallback(async (prompt: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsGenerating(true);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, existingCode: d2Code }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `API error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              accumulated += parsed.content;
              const cleaned = accumulated
                .replace(/^```d2?\n?/m, "")
                .replace(/\n?```$/m, "");
              setD2Code(cleaned);
            }
          } catch {
            // skip
          }
        }
      }

      const final = accumulated
        .replace(/^```d2?\n?/m, "")
        .replace(/\n?```$/m, "")
        .trim();
      setD2Code(final);
      setRenderCode(final);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Refinement error:", err);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [d2Code]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center px-6 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">DiagramAgent</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">AI-powered architecture diagrams</p>
          </div>
        </div>
      </header>

      {/* Prompt Area */}
      <div className="px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <PromptInput onGenerate={d2Code ? handleRefine : handleGenerate} isGenerating={isGenerating} />
      </div>

      {/* Main Content: Split Pane */}
      <div className="flex flex-1 min-h-0">
        {/* Code Editor */}
        <div className="w-2/5 border-r border-gray-200 dark:border-gray-800">
          <CodeEditor
            code={d2Code}
            onChange={setD2Code}
            onRender={handleRerender}
          />
        </div>

        {/* Diagram Preview */}
        <div className="w-3/5">
          <D2Renderer code={renderCode} />
        </div>
      </div>
    </div>
  );
}

