"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (prompt: string) => void;
  onNewDiagram: () => void;
  isGenerating: boolean;
}

const EXAMPLE_PROMPTS = [
  "SQL Always On Availability Group on Azure with disaster recovery",
  "Three-tier web application on AWS with auto-scaling and CDN",
  "Microservices architecture on Kubernetes with service mesh",
  "Serverless event-driven architecture on AWS",
  "CI/CD pipeline with GitHub Actions, Docker, and Kubernetes",
  "Multi-region active-active setup on Azure",
  "Data pipeline with Kafka, Spark, and Snowflake",
  "Real-time analytics platform with Kafka and Elasticsearch",
];

export default function ChatPanel({ messages, onSend, onNewDiagram, isGenerating }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (input.trim() && !isGenerating) {
        onSend(input.trim());
        setInput("");
      }
    },
    [input, isGenerating, onSend]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleExampleClick = useCallback(
    (example: string) => {
      if (!isGenerating) {
        onSend(example);
      }
    },
    [isGenerating, onSend]
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {!hasMessages && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Describe the architecture you want to diagram. Be specific about cloud providers for provider-targeted diagrams, or keep it generic for vendor-neutral output.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Try an example
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((example, i) => (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(example)}
                    disabled={isGenerating}
                    className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 text-sm flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Generating diagram...
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasMessages ? "Describe changes to the diagram..." : "Describe an architecture..."}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-gray-100"
              disabled={isGenerating}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              type="submit"
              disabled={!input.trim() || isGenerating}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {hasMessages ? "Update" : "Generate"}
            </button>
            {hasMessages && (
              <button
                type="button"
                onClick={onNewDiagram}
                disabled={isGenerating}
                className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                New
              </button>
            )}
          </div>
        </form>
        <p className="text-xs text-gray-400 mt-1">Ctrl+Enter to send</p>
      </div>
    </div>
  );
}
