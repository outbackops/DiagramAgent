"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ChatPanel, { ChatMessage } from "@/components/PromptInput";
import ClarifyPanel, { ClarifyQuestion, ClarifyAnswers } from "@/components/ClarifyPanel";
import { resolveAnswerSpecs } from "@/lib/clarify-utils";
import ElementEditor, { SelectedElement } from "@/components/ElementEditor";
import {
  parseConnectionPath,
  findElementLabel,
  updateElementLabel,
  deleteElement,
  addConnection,
  deleteConnection,
  updateConnectionLabel,
  moveNodeToContainer,
} from "@/lib/d2-editor";

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
  const [maxIterations, setMaxIterations] = useState(1);
  const [refinementStatus, setRefinementStatus] = useState<RefinementStatus | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clarify state
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQuestion[] | null>(null);
  const [clarifyPrompt, setClarifyPrompt] = useState<string>(""); // the original prompt waiting for clarification
  const [isClarifying, setIsClarifying] = useState(false);
  const [clarifyAnalysis, setClarifyAnalysis] = useState<Record<string, unknown> | null>(null);

  // Diagram interaction state
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);

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
      signal?: AbortSignal,
      architecturePlan?: Record<string, unknown> | null
    ): Promise<string> => {
      // If an architecture plan is provided, prefix it to the prompt
      const finalPrompt = architecturePlan
        ? `ARCHITECTURE PLAN:\n${JSON.stringify(architecturePlan, null, 2)}\n\nUSER REQUEST:\n${prompt}`
        : prompt;

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: finalPrompt,
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
    ): Promise<{
      score: number;
      pass: boolean;
      reasoning?: string;
      issues?: string[];
      suggestions?: string[];
      missing_components?: string[];
      layout_issues?: string[];
      specific_fixes?: string[];
    }> => {
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

  // Fetch architecture plan from the planning API
  const fetchArchitecturePlan = useCallback(
    async (prompt: string, analysis?: Record<string, unknown> | null): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, analysis }),
        });
        const data = await res.json();
        if (res.ok && data.plan) {
          return data.plan;
        }
      } catch (err) {
        console.error("Architecture planning failed, proceeding without plan:", err);
      }
      return null;
    },
    []
  );

  // Full generate + refine loop
  const generateWithRefinement = useCallback(
    async (prompt: string, existingCode: string, history: ChatMessage[], analysis?: Record<string, unknown> | null) => {
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

      // Phase 0: Architecture Planning (for new diagrams only)
      let architecturePlan: Record<string, unknown> | null = null;
      if (!existingCode) {
        setRefinementStatus({
          phase: "generating",
          iteration: 0,
          maxIterations: autoRefine ? maxIterations : 1,
        });
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: "🏗️ Planning architecture layout..." },
        ]);
        architecturePlan = await fetchArchitecturePlan(prompt, analysis);
        if (architecturePlan) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "✅ Architecture plan ready. Generating D2 code..." },
          ]);
        }
      }

      setRefinementStatus({
        phase: "generating",
        iteration: 1,
        maxIterations: autoRefine ? maxIterations : 1,
      });

      try {
        // Step 1: Initial generation (with architecture plan if available)
        let currentCode = await streamGenerate(prompt, existingCode, history, controller.signal, architecturePlan);

        if (!autoRefine || controller.signal.aborted) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Diagram generated." },
          ]);
          setRefinementStatus(null);
          return;
        }

        // Step 2: Iterative refinement loop
        for (let i = 0; i < maxIterations; i++) {
          if (controller.signal.aborted) break;

          // 2a: Render to SVG
          console.log(`[Client] Starting render iteration ${i + 1}`);
          setRefinementStatus({
            phase: "rendering",
            iteration: i + 1,
            maxIterations: maxIterations,
          });


          let svg: string;
          try {
            svg = await renderToSvg(currentCode);
            console.log(`[Client] Render complete, length: ${svg?.length}`);
          } catch (renderErr: any) {
            console.error("[Client] Render error:", renderErr);
            // If render fails, the code has syntax errors — ask the model to fix
            setRefinementStatus({
              phase: "refining",
              iteration: i + 1,
              maxIterations: maxIterations,
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
            maxIterations: maxIterations,
          });

          let assessment: {
            score: number;
            pass: boolean;
            reasoning?: string;
            issues?: string[];
            suggestions?: string[];
            missing_components?: string[];
            layout_issues?: string[];
            specific_fixes?: string[];
          };
          try {
            assessment = await assessDiagram(svg, prompt, currentCode, controller.signal);
          } catch (assessErr: any) {
            console.warn("Assessment failed, skipping:", assessErr.message);
            break;
          }

          setRefinementStatus({
            phase: "assessing",
            iteration: i + 1,
            maxIterations: maxIterations,
            score: assessment.score,
            issues: assessment.issues || assessment.layout_issues || [],
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
            setRefinementStatus({ phase: "done", iteration: i + 1, maxIterations: maxIterations, score: assessment.score });
            doneTimerRef.current = setTimeout(() => {
              setRefinementStatus(null);
              doneTimerRef.current = null;
            }, 4000);
            return;
          }

          if (controller.signal.aborted) break;

          const issues: string[] = assessment.issues || assessment.layout_issues || [];
          const missingComponents: string[] = assessment.missing_components || [];
          const suggestions: string[] = assessment.suggestions || assessment.specific_fixes || [];
          const allIssues = [...missingComponents.map((c: string) => `Missing: ${c}`), ...issues];

          // 2d: Refine based on assessment feedback
          setRefinementStatus({
            phase: "refining",
            iteration: i + 1,
            maxIterations: maxIterations,
            score: assessment.score,
            issues: allIssues,
          });

          const issuesList = allIssues.map((iss, idx) => `${idx + 1}. ${iss}`).join("\n");
          const suggestionsList = suggestions.map((s, idx) => `${idx + 1}. ${s}`).join("\n");

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
            content: `Diagram generated with ${maxIterations} refinement iterations.`,
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
        if (abortRef.current === controller) {
           // Clear abort controller only if it's the current one
           abortRef.current = null;
        }
      }
    },
    [selectedModel, autoRefine, maxIterations, streamGenerate, renderToSvg, assessDiagram, fetchArchitecturePlan]
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

        // Store analysis from the expert intent review
        const analysis = data.analysis || null;
        setClarifyAnalysis(analysis);

        if (res.ok && data.skipClarification) {
          // Request is comprehensive enough — skip questions, go straight to planning + generation
          setClarifyQuestions(null);
          setClarifyPrompt("");
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Request is detailed enough — skipping clarification." },
          ]);
          generateWithRefinement(prompt, "", [], analysis);
        } else if (res.ok && data.questions && data.questions.length > 0) {
          setClarifyQuestions(data.questions);
        } else {
          // Clarify failed — generate directly
          setClarifyQuestions(null);
          setClarifyPrompt("");
          generateWithRefinement(prompt, "", [], analysis);
        }
      } catch {
        // Fallback: generate directly
        setClarifyQuestions(null);
        setClarifyPrompt("");
        setClarifyAnalysis(null);
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
      const specs = resolveAnswerSpecs(questions, answers);
      if (specs.length === 0) return originalPrompt;

      const parts: string[] = [originalPrompt, "\n\nAdditional specifications:"];
      for (const spec of specs) {
        parts.push(`- ${spec}`);
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
      const answeredSpecs = resolveAnswerSpecs(clarifyQuestions, answers);

      if (answeredSpecs.length > 0) {
        setChatMessages((prev) => [
          ...prev,
          { role: "user", content: answeredSpecs.map((s) => `• ${s}`).join("\n") },
        ]);
      }

      // Clear clarify state and generate with planning
      setClarifyQuestions(null);
      setClarifyPrompt("");
      generateWithRefinement(enhancedPrompt, "", [], clarifyAnalysis);
    },
    [clarifyQuestions, clarifyPrompt, clarifyAnalysis, buildEnhancedPrompt, generateWithRefinement]
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

  // --- Diagram Interaction Handlers ---

  const handleElementClick = useCallback(
    (path: string, isConnection: boolean) => {
      // If in connect mode, this click is the target
      if (connectMode && connectSource && path && !isConnection) {
        const newCode = addConnection(d2Code, connectSource, path, "");
        setD2Code(newCode);
        setConnectMode(false);
        setConnectSource(null);
        setSelectedElement(null);
        return;
      }

      // Deselect if clicked on empty space or same element
      if (!path || (selectedElement?.path === path)) {
        setSelectedElement(null);
        setConnectMode(false);
        setConnectSource(null);
        return;
      }

      // Select the element
      if (isConnection) {
        const conn = parseConnectionPath(path);
        // Find the connection label from D2 code
        let label = "";
        if (conn) {
          const lines = d2Code.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.includes("->") && trimmed.includes(conn.from) && trimmed.includes(conn.to)) {
              const labelMatch = trimmed.match(/:\s*(.+?)(?:\s*\{|$)/);
              if (labelMatch) label = labelMatch[1].trim();
              break;
            }
          }
        }
        setSelectedElement({
          path,
          isConnection: true,
          connectionFrom: conn?.from,
          connectionTo: conn?.to,
          label,
        });
      } else {
        const label = findElementLabel(d2Code, path);
        setSelectedElement({
          path,
          isConnection: false,
          label: label || path.split(".").pop() || path,
        });
      }
    },
    [d2Code, connectMode, connectSource, selectedElement]
  );

  const handleUpdateLabel = useCallback(
    (path: string, newLabel: string, isConnection: boolean) => {
      let newCode: string | null = null;

      if (isConnection) {
        const conn = parseConnectionPath(path);
        if (conn) {
          newCode = updateConnectionLabel(d2Code, conn.from, conn.to, newLabel);
        }
      } else {
        newCode = updateElementLabel(d2Code, path, newLabel);
      }

      if (newCode) {
        setD2Code(newCode);
        setSelectedElement((prev) => prev ? { ...prev, label: newLabel } : null);
      }
    },
    [d2Code]
  );

  const handleDeleteElement = useCallback(
    (path: string, isConnection: boolean) => {
      let newCode: string;

      if (isConnection) {
        const conn = parseConnectionPath(path);
        if (conn) {
          newCode = deleteConnection(d2Code, conn.from, conn.to);
        } else {
          return;
        }
      } else {
        newCode = deleteElement(d2Code, path);
      }

      setD2Code(newCode);
      setSelectedElement(null);
    },
    [d2Code]
  );

  const handleStartConnect = useCallback(() => {
    if (selectedElement && !selectedElement.isConnection) {
      setConnectSource(selectedElement.path);
      setConnectMode(true);
    }
  }, [selectedElement]);

  const handleCancelConnect = useCallback(() => {
    setConnectMode(false);
    setConnectSource(null);
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedElement(null);
    setConnectMode(false);
    setConnectSource(null);
  }, []);

  const handleMoveNode = useCallback(
    (nodePath: string, targetContainerPath: string) => {
      const newCode = moveNodeToContainer(d2Code, nodePath, targetContainerPath);
      if (newCode) {
        setD2Code(newCode);
        setSelectedElement(null);
      }
    },
    [d2Code]
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
    setSelectedElement(null);
    setConnectMode(false);
    setConnectSource(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="flex items-center px-6 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button
          onClick={handleNewDiagram}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          title="Start new diagram"
        >
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <h1 className="text-base font-bold text-gray-900 dark:text-white">DiagramAgent</h1>
        </button>

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

          {/* Iterations input */}
          {autoRefine && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-500 dark:text-gray-400">Iterations:</label>
              <input
                type="number"
                min={1}
                max={5}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                disabled={isGenerating}
                className="w-12 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}

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
        <div className="flex-1 relative">
          <D2Renderer
            code={d2Code}
            isStreaming={isGenerating}
            onElementClick={handleElementClick}
            onMoveNode={handleMoveNode}
            selectedPath={selectedElement?.path}
          />
          <ElementEditor
            selected={selectedElement}
            connectMode={connectMode}
            onUpdateLabel={handleUpdateLabel}
            onDelete={handleDeleteElement}
            onStartConnect={handleStartConnect}
            onCancelConnect={handleCancelConnect}
            onDeselect={handleDeselect}
          />
        </div>
      </div>
    </div>
  );
}
