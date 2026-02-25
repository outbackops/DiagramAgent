"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ChatPanel, { ChatMessage } from "@/components/PromptInput";
import ClarifyPanel, { ClarifyQuestion, ClarifyAnswers } from "@/components/ClarifyPanel";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), { ssr: false });
const D2Renderer = dynamic(() => import("@/components/D2Renderer"), { ssr: false });

interface ModelInfo {
  id: string;
  label: string;
  description: string;
}

interface RefinementStatus {
  phase: "generating" | "rendering" | "assessing" | "refining" | "done";
  iteration: number;
  maxIterations: number;
  score?: number;
  issues?: string[];
}

const MAX_REFINE_ITERATIONS = 3;

export default function Home() {
  const [d2Code, setD2Code] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-5.2-chat");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [autoRefine, setAutoRefine] = useState(true);
  const [refinementStatus, setRefinementStatus] = useState<RefinementStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clarify state
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [clarifyPrompt, setClarifyPrompt] = useState<string>(""); // the original prompt waiting for clarification
  const [isClarifying, setIsClarifying] = useState(false);

  // Load available models
  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (data.models) setModels(data.models);
      })
      .catch(() => {});
  }, []);

  // Stream generate and return the final D2 code
  const streamGenerate = useCallback(
    async (
      prompt: string,
      existingCode: string,
      history: ChatMessage[],
      signal?: AbortSignal
    ): Promise<string> => {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          existingCode,
          history,
          model: selectedModel,
        }),
        signal,
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
      return final;
    },
    [selectedModel]
  );

  // Render D2 code to SVG via the render API
  const renderToSvg = useCallback(async (code: string): Promise<string> => {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Render failed");
    return data.svg;
  }, []);

  // Assess a rendered diagram using vision model
  const assessDiagram = useCallback(
    async (
      svg: string,
      prompt: string,
      code: string,
      signal?: AbortSignal
    ): Promise<{ score: number; pass: boolean; issues: string[]; suggestions: string[] }> => {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ svg, prompt, d2Code: code }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assessment failed");
      return data.assessment;
    },
    []
  );

  // Full generate + refine loop
  const generateWithRefinement = useCallback(
    async (prompt: string, existingCode: string, history: ChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsGenerating(true);
      if (!existingCode) setD2Code("");
      // Clear any lingering done-status timer
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
      setRefinementStatus({
        phase: "generating",
        iteration: 1,
        maxIterations: autoRefine ? MAX_REFINE_ITERATIONS : 1,
      });

      try {
        // Step 1: Initial generation
        let currentCode = await streamGenerate(prompt, existingCode, history, controller.signal);

        if (!autoRefine || controller.signal.aborted) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Diagram generated." },
          ]);
          setRefinementStatus(null);
          return;
        }

        // Step 2: Iterative refinement loop
        for (let i = 0; i < MAX_REFINE_ITERATIONS; i++) {
          if (controller.signal.aborted) break;

          // 2a: Render to SVG
          setRefinementStatus({
            phase: "rendering",
            iteration: i + 1,
            maxIterations: MAX_REFINE_ITERATIONS,
          });

          let svg: string;
          try {
            svg = await renderToSvg(currentCode);
          } catch (renderErr: any) {
            // If render fails, the code has syntax errors — ask the model to fix
            setRefinementStatus({
              phase: "refining",
              iteration: i + 1,
              maxIterations: MAX_REFINE_ITERATIONS,
              issues: [`Render error: ${renderErr.message}`],
            });

            const fixPrompt = `The D2 code has a rendering error: "${renderErr.message}". Fix the D2 syntax while keeping the architecture intact. Output the COMPLETE corrected D2 code.`;
            currentCode = await streamGenerate(fixPrompt, currentCode, [], controller.signal);
            continue;
          }

          if (controller.signal.aborted) break;

          // 2b: Assess with vision model
          setRefinementStatus({
            phase: "assessing",
            iteration: i + 1,
            maxIterations: MAX_REFINE_ITERATIONS,
          });

          let assessment: { score: number; pass: boolean; issues: string[]; suggestions: string[] };
          try {
            assessment = await assessDiagram(svg, prompt, currentCode, controller.signal);
          } catch (assessErr: any) {
            console.warn("Assessment failed, skipping:", assessErr.message);
            break;
          }

          setRefinementStatus({
            phase: "assessing",
            iteration: i + 1,
            maxIterations: MAX_REFINE_ITERATIONS,
            score: assessment.score,
            issues: assessment.issues,
          });

          // 2c: If passing, we're done
          if (assessment.pass) {
            setChatMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Diagram generated and verified (score: ${assessment.score}/10 after ${i + 1} iteration${i > 0 ? "s" : ""}).`,
              },
            ]);
            setRefinementStatus({ phase: "done", iteration: i + 1, maxIterations: MAX_REFINE_ITERATIONS, score: assessment.score });
            doneTimerRef.current = setTimeout(() => {
              setRefinementStatus(null);
              doneTimerRef.current = null;
            }, 4000);
            return;
          }

          if (controller.signal.aborted) break;

          // 2d: Refine based on assessment feedback
          setRefinementStatus({
            phase: "refining",
            iteration: i + 1,
            maxIterations: MAX_REFINE_ITERATIONS,
            score: assessment.score,
            issues: assessment.issues,
          });

          const issuesList = assessment.issues.map((iss, idx) => `${idx + 1}. ${iss}`).join("\n");
          const suggestionsList = assessment.suggestions.map((s, idx) => `${idx + 1}. ${s}`).join("\n");

          const refinePrompt = `A vision-based assessment of the rendered diagram found these issues (score ${assessment.score}/10):

Issues:
${issuesList}

Suggested fixes:
${suggestionsList}

Fix these issues in the D2 code. Maintain the overall architecture but improve layout, grouping, connections, and completeness. Output the COMPLETE updated D2 code.`;

          currentCode = await streamGenerate(refinePrompt, currentCode, [], controller.signal);
        }

        // Exhausted iterations
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Diagram generated with ${MAX_REFINE_ITERATIONS} refinement iterations.`,
          },
        ]);
        setRefinementStatus(null);
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
        setRefinementStatus(null);
      } finally {
        setIsGenerating(false);
      }
    },
    [selectedModel, autoRefine, streamGenerate, renderToSvg, assessDiagram]
  );

  // Fetch clarifying questions for a new diagram prompt
  const fetchClarifyQuestions = useCallback(
    async (prompt: string) => {
      setIsClarifying(true);
      setClarifyPrompt(prompt);
      setChatMessages((prev) => [
        ...prev,
        { role: "user", content: prompt },
      ]);

      try {
        const res = await fetch("/api/clarify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, model: selectedModel }),
        });
        const data = await res.json();

        if (res.ok && data.questions && data.questions.length > 0) {
          setClarifyQuestions(data.questions);
        } else {
          // Clarify failed — generate directly
          setClarifyQuestions(null);
          setClarifyPrompt("");
          generateWithRefinement(prompt, "", []);
        }
      } catch {
        // Fallback: generate directly
        setClarifyQuestions(null);
        setClarifyPrompt("");
        generateWithRefinement(prompt, "", []);
      } finally {
        setIsClarifying(false);
      }
    },
    [selectedModel, generateWithRefinement]
  );

  // Build enhanced prompt from clarify answers
  const buildEnhancedPrompt = useCallback(
    (originalPrompt: string, questions: ClarifyQuestion[], answers: ClarifyAnswers): string => {
      const parts: string[] = [originalPrompt];
      const specs: string[] = [];

      for (const q of questions) {
        const answer = answers[q.id];
        if (!answer) continue;

        if (q.type === "freetext") {
          const text = (answer as string).trim();
          if (text) specs.push(`${q.question}: ${text}`);
        } else if (q.type === "single") {
          const opt = q.options.find((o) => o.value === answer);
          if (opt) specs.push(`${q.question}: ${opt.label}`);
        } else if (q.type === "multi") {
          const selected = (answer as string[])
            .map((v) => q.options.find((o) => o.value === v)?.label)
            .filter(Boolean);
          if (selected.length > 0) specs.push(`${q.question}: ${selected.join(", ")}`);
        }
      }

      if (specs.length > 0) {
        parts.push("\n\nAdditional specifications:");
        for (const spec of specs) {
          parts.push(`- ${spec}`);
        }
      }

      return parts.join("\n");
    },
    []
  );

  // Handle clarify answers submitted
  const handleClarifySubmit = useCallback(
    (answers: ClarifyAnswers) => {
      if (!clarifyQuestions || !clarifyPrompt) return;

      const enhancedPrompt = buildEnhancedPrompt(clarifyPrompt, clarifyQuestions, answers);

      // Show a summary of selections in chat
      const answeredSpecs: string[] = [];
      for (const q of clarifyQuestions) {
        const answer = answers[q.id];
        if (!answer) continue;
        if (q.type === "freetext") {
          const text = (answer as string).trim();
          if (text) answeredSpecs.push(`${q.question} ${text}`);
        } else if (q.type === "single") {
          const opt = q.options.find((o) => o.value === answer);
          if (opt) answeredSpecs.push(`${q.question} ${opt.label}`);
        } else if (q.type === "multi") {
          const selected = (answer as string[])
            .map((v) => q.options.find((o) => o.value === v)?.label)
            .filter(Boolean);
          if (selected.length > 0) answeredSpecs.push(`${q.question} ${selected.join(", ")}`);
        }
      }

      if (answeredSpecs.length > 0) {
        setChatMessages((prev) => [
          ...prev,
          { role: "user", content: answeredSpecs.map((s) => `• ${s}`).join("\n") },
        ]);
      }

      // Clear clarify state and generate
      setClarifyQuestions(null);
      setClarifyPrompt("");
      generateWithRefinement(enhancedPrompt, "", []);
    },
    [clarifyQuestions, clarifyPrompt, buildEnhancedPrompt, generateWithRefinement]
  );

  // Skip clarification and generate directly
  const handleClarifySkip = useCallback(() => {
    const prompt = clarifyPrompt;
    setClarifyQuestions(null);
    setClarifyPrompt("");
    if (prompt) {
      generateWithRefinement(prompt, "", []);
    }
  }, [clarifyPrompt, generateWithRefinement]);

  const handleSend = useCallback(
    (prompt: string) => {
      const userMsg: ChatMessage = { role: "user", content: prompt };

      if (d2Code) {
        // Existing diagram — update directly (no clarify)
        const newMessages = [...chatMessages, userMsg];
        setChatMessages(newMessages);
        generateWithRefinement(prompt, d2Code, chatMessages);
      } else {
        // New diagram — dismiss any existing clarify panel and start fresh
        setClarifyQuestions(null);
        setClarifyPrompt("");
        fetchClarifyQuestions(prompt);
      }
    },
    [chatMessages, d2Code, generateWithRefinement, fetchClarifyQuestions]
  );

  const handleNewDiagram = useCallback(() => {
    abortRef.current?.abort();
    if (doneTimerRef.current) {
      clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    setD2Code("");
    setChatMessages([]);
    setIsGenerating(false);
    setRefinementStatus(null);
    setClarifyQuestions(null);
    setClarifyPrompt("");
    setIsClarifying(false);
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

        {/* Controls */}
        <div className="ml-auto flex items-center gap-4">
          {/* Auto-refine toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-xs text-gray-500 dark:text-gray-400">Vision Refine</span>
            <button
              onClick={() => setAutoRefine((v) => !v)}
              disabled={isGenerating}
              className={`relative w-8 h-4.5 rounded-full transition-colors ${
                autoRefine
                  ? "bg-blue-600"
                  : "bg-gray-300 dark:bg-gray-600"
              } ${isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${
                  autoRefine ? "translate-x-3.5" : ""
                }`}
              />
            </button>
          </label>

          {/* Model picker */}
          <div className="flex items-center gap-2">
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
        </div>
      </header>

      {/* Refinement Status Bar */}
      {refinementStatus && (
        <div className="px-6 py-1.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 shrink-0">
          <div className="flex items-center gap-3">
            {refinementStatus.phase !== "done" && (
              <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin shrink-0" />
            )}
            {refinementStatus.phase === "done" && (
              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
              {refinementStatus.phase === "generating" && `Generating diagram (iteration ${refinementStatus.iteration}/${refinementStatus.maxIterations})...`}
              {refinementStatus.phase === "rendering" && `Rendering SVG for assessment (iteration ${refinementStatus.iteration})...`}
              {refinementStatus.phase === "assessing" && (
                refinementStatus.score != null
                  ? `Assessment: ${refinementStatus.score}/10 — ${refinementStatus.score >= 7 ? "passed" : "needs refinement"}`
                  : `Assessing diagram with vision model (iteration ${refinementStatus.iteration})...`
              )}
              {refinementStatus.phase === "refining" && `Refining diagram based on feedback (iteration ${refinementStatus.iteration})...`}
              {refinementStatus.phase === "done" && `Verified — score: ${refinementStatus.score}/10`}
            </span>
            {refinementStatus.issues && refinementStatus.issues.length > 0 && refinementStatus.phase !== "done" && (
              <span className="text-xs text-blue-500 dark:text-blue-400 truncate max-w-md" title={refinementStatus.issues.join("; ")}>
                {refinementStatus.issues[0]}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Content: 3-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Chat Panel */}
        <div className="w-1/4 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col min-w-[280px]">
          <ChatPanel
            messages={chatMessages}
            onSend={handleSend}
            onNewDiagram={handleNewDiagram}
            isGenerating={isGenerating}
            isClarifying={isClarifying}
            inlinePanel={
              clarifyQuestions ? (
                <ClarifyPanel
                  questions={clarifyQuestions}
                  onSubmit={handleClarifySubmit}
                  onSkip={handleClarifySkip}
                  isSubmitting={isGenerating}
                />
              ) : undefined
            }
          />
        </div>

        {/* Code Editor */}
        <div className="w-[30%] border-r border-gray-200 dark:border-gray-800">
          <CodeEditor code={d2Code} onChange={setD2Code} readOnly={isGenerating} />
        </div>

        {/* Diagram Preview */}
        <div className="flex-1">
          <D2Renderer code={d2Code} isStreaming={isGenerating} />
        </div>
      </div>
    </div>
  );
}
