"use client";

import { useState, useCallback, useRef } from "react";

interface PromptInputProps {
  onGenerate: (prompt: string) => void;
  isGenerating: boolean;
}

const EXAMPLE_PROMPTS = [
  "SQL Always On Availability Group on Azure with disaster recovery",
  "Three-tier web application on AWS with auto-scaling and CDN",
  "Microservices architecture on Kubernetes with service mesh",
  "Data pipeline with Kafka, Spark, and Snowflake on GCP",
  "CI/CD pipeline with GitHub Actions, Docker, and Kubernetes",
  "Serverless event-driven architecture on AWS",
  "Multi-region active-active setup on Azure",
  "Real-time analytics platform with Kafka and Elasticsearch",
];

export default function PromptInput({ onGenerate, isGenerating }: PromptInputProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (prompt.trim() && !isGenerating) {
        onGenerate(prompt.trim());
      }
    },
    [prompt, isGenerating, onGenerate]
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
      setPrompt(example);
      if (!isGenerating) {
        onGenerate(example);
      }
    },
    [isGenerating, onGenerate]
  );

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="relative">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the architecture you want to diagram...&#10;&#10;e.g., SQL Always On Availability Group on Azure with disaster recovery"
          className="w-full h-28 px-4 py-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500 text-gray-900 dark:text-gray-100"
          disabled={isGenerating}
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <span className="text-xs text-gray-400">Ctrl+Enter</span>
          <button
            type="submit"
            disabled={!prompt.trim() || isGenerating}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {isGenerating ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate
              </>
            )}
          </button>
        </div>
      </form>

      {/* Example Prompts */}
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
              className="px-2.5 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed truncate max-w-[300px]"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
