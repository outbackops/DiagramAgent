"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ChatPanel, { ChatMessage } from "@/components/PromptInput";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });
const D2Renderer = dynamic(() => import("@/components/D2Renderer"), { ssr: false });

interface ModelInfo {
  id: string;
  label: string;
  description: string;
}

export default function Home() {
  const [d2Code, setD2Code] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-5.2-chat");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Load available models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) setModels(data.models);
      })
      .catch(() => {});
  }, []);

  const streamGenerate = useCallback(
    async (prompt: string, existingCode: string, history: ChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsGenerating(true);
      if (!existingCode) setD2Code("");

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            existingCode,
            history,
            model: selectedModel,
          }),
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

        // Add assistant confirmation to chat
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Diagram updated." },
        ]);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Generation error:", err);
          setD2Code(
            `# Error: ${err.message}\n# Please check your Azure AI Foundry configuration.`
          );
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${err.message}` },
          ]);
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [selectedModel]
  );

  const handleSend = useCallback(
    (prompt: string) => {
      const userMsg: ChatMessage = { role: "user", content: prompt };
      const newMessages = [...chatMessages, userMsg];
      setChatMessages(newMessages);

      if (d2Code) {
        // Follow-up: modify existing diagram
        streamGenerate(prompt, d2Code, chatMessages);
      } else {
        // Initial generation
        streamGenerate(prompt, "", []);
      }
    },
    [chatMessages, d2Code, streamGenerate]
  );

  const handleNewDiagram = useCallback(() => {
    abortRef.current?.abort();
    setD2Code("");
    setChatMessages([]);
    setIsGenerating(false);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center px-6 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white">DiagramAgent</h1>
          </div>
        </div>

        {/* Model picker */}
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={isGenerating}
          >
            {models.length > 0
              ? models.map((m) => (
                  <option key={m.id} value={m.id} title={m.description}>
                    {m.label}
                  </option>
                ))
              : <option value={selectedModel}>{selectedModel}</option>
            }
          </select>
        </div>
      </header>

      {/* Main Content: 3-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Chat Panel */}
        <div className="w-1/4 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col min-w-[280px]">
          <ChatPanel
            messages={chatMessages}
            onSend={handleSend}
            onNewDiagram={handleNewDiagram}
            isGenerating={isGenerating}
          />
        </div>

        {/* Code Editor */}
        <div className="w-[30%] border-r border-gray-200 dark:border-gray-800">
          <CodeEditor code={d2Code} onChange={setD2Code} />
        </div>

        {/* Diagram Preview */}
        <div className="flex-1">
          <D2Renderer code={d2Code} />
        </div>
      </div>
    </div>
  );
}
