"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClarifyAnswers, ClarifyQuestion } from "@/components/ClarifyPanel";
import { resolveAnswerSpecs } from "@/lib/clarify-utils";
import { api, isD2SyntaxError } from "@/lib/client/api";
import type { ChatTurn, ModelSelection } from "@/lib/llm/types";
import { cleanD2Output } from "@/lib/pipeline/d2-text";
import {
  PipelineAbortError,
  RenderUnavailableError,
  reviewFixPrompt,
  runDiagramPipeline,
  type PipelineEvent,
  type PipelineOutcome,
  type PipelinePhase,
  type PipelineSteps,
  type ReviewAssessment,
} from "@/lib/pipeline/refine-loop";
import { usePersistedState } from "@/lib/use-persisted-state";

export interface RunStep {
  key: string;
  phase: PipelinePhase;
  round: number;
  status: "active" | "done" | "failed";
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ReviewRecord {
  round: number;
  assessment: ReviewAssessment;
}

export interface RunRecord {
  id: string;
  mode: "create" | "edit";
  prompt: string;
  status: "running" | "done" | "failed" | "cancelled";
  steps: RunStep[];
  startedAt: number;
  endedAt?: number;
  model: ModelSelection;
  reviewer?: ModelSelection;
  outcome?: PipelineOutcome;
  reviewScore?: number;
  qualityScore?: number;
  qualityGrade?: string;
  refinements?: number;
  /** Round whose candidate was kept; its review is the one that matches the canvas. */
  bestRound?: number;
  reviews: ReviewRecord[];
  notes: string[];
  error?: string;
}

export type ChatItem =
  | { id: string; kind: "user"; text: string; at: number }
  | { id: string; kind: "assistant"; text: string; at: number; tone?: "info" | "warning" }
  | { id: string; kind: "run"; run: RunRecord; at: number };

export interface AgentSettings {
  clarify: boolean;
  review: boolean;
  refinements: number;
}

export const DEFAULT_SETTINGS: AgentSettings = { clarify: true, review: true, refinements: 1 };

export interface ClarifyState {
  prompt: string;
  questions: ClarifyQuestion[];
  analysis: unknown;
}

export type AgentBusy = "idle" | "clarifying" | "running";

const MAX_ITEMS = 120;
/** Matches the server's per-turn history limit (src/lib/api/schemas.ts). */
const HISTORY_TURN_LIMIT = 20_000;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isAbort = (err: unknown) => typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

const isItems = (v: unknown): v is ChatItem[] =>
  Array.isArray(v) && v.every((i) => i && typeof i === "object" && typeof (i as ChatItem).id === "string" && typeof (i as ChatItem).kind === "string");

const isSettings = (v: unknown): v is AgentSettings =>
  !!v &&
  typeof v === "object" &&
  typeof (v as AgentSettings).clarify === "boolean" &&
  typeof (v as AgentSettings).review === "boolean" &&
  Number.isInteger((v as AgentSettings).refinements) &&
  (v as AgentSettings).refinements >= 0 &&
  (v as AgentSettings).refinements <= 3;

function applyEvent(run: RunRecord, event: PipelineEvent, now: number): RunRecord {
  const closeActive = (steps: RunStep[]) => steps.map((s) => (s.status === "active" ? { ...s, status: "done" as const, endedAt: now } : s));
  const patchLast = (phase: PipelinePhase, patch: Partial<RunStep>) => {
    const steps = [...run.steps];
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].phase === phase) {
        steps[i] = { ...steps[i], ...patch };
        break;
      }
    }
    return steps;
  };

  switch (event.type) {
    case "phase":
      return {
        ...run,
        steps: [...closeActive(run.steps), { key: `${event.phase}-${event.round}-${run.steps.length}`, phase: event.phase, round: event.round, status: "active", startedAt: now }],
      };
    case "plan":
      return event.error
        ? { ...run, steps: patchLast("planning", { status: "failed", endedAt: now, detail: "Continued without a plan" }), notes: [...run.notes, `Planning failed: ${event.error}`] }
        : { ...run, steps: patchLast("planning", { detail: "Plan ready" }) };
    case "rendered":
      return event.quality
        ? { ...run, steps: patchLast("rendering", { detail: `Quality ${event.quality.score} (${event.quality.grade})` }) }
        : run;
    case "render_error":
      return { ...run, steps: patchLast("rendering", { status: "failed", endedAt: now, detail: event.message.split("\n")[0] }) };
    case "assessment":
      return {
        ...run,
        steps: patchLast("reviewing", { detail: `Score ${event.assessment.score}/10` }),
        reviews: [...run.reviews, { round: event.round, assessment: event.assessment }],
      };
    case "review_error":
      return {
        ...run,
        steps: patchLast("reviewing", { status: "failed", endedAt: now, detail: "Review unavailable" }),
        notes: [...run.notes, `Review failed: ${event.message}`],
      };
    case "refine_error": {
      const steps = run.steps.map((s) => (s.status === "active" ? { ...s, status: "failed" as const, endedAt: now, detail: "Model call failed" } : s));
      return { ...run, steps, notes: [...run.notes, `Refinement stopped: ${event.message}. Kept the best version so far.`] };
    }
    default:
      return run;
  }
}

function migrateLegacyChat(): ChatItem[] | null {
  try {
    const raw = window.localStorage.getItem("diagramAgent.chatMessages");
    if (!raw) return null;
    const legacy = JSON.parse(raw) as Array<{ role?: string; content?: string }>;
    window.localStorage.removeItem("diagramAgent.chatMessages");
    if (!Array.isArray(legacy)) return null;
    return legacy
      .filter((m) => typeof m?.content === "string" && (m.role === "user" || m.role === "assistant"))
      .map((m) => ({ id: newId(), kind: m.role === "user" ? "user" : "assistant", text: m.content as string, at: Date.now() }) as ChatItem);
  } catch {
    return null;
  }
}

export interface AgentModels {
  selection: ModelSelection;
  reviewer: ModelSelection;
  reviewerSupportsVision: boolean;
}

export function useDiagramAgent(models: AgentModels) {
  const [code, setCode] = usePersistedState<string>("diagramAgent.d2Code", "", { validate: (v): v is string => typeof v === "string" });
  const [items, setItems] = usePersistedState<ChatItem[]>("diagramAgent.chat.v2", [], { validate: isItems });
  const [title, setTitle] = usePersistedState<string>("diagramAgent.title", "Untitled diagram", { validate: (v): v is string => typeof v === "string" });
  const [settings, setSettings] = usePersistedState<AgentSettings>("diagramAgent.settings.v2", DEFAULT_SETTINGS, { validate: isSettings });

  const [busy, setBusy] = useState<AgentBusy>("idle");
  const [clarify, setClarify] = useState<ClarifyState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { selection, reviewer, reviewerSupportsVision } = models;

  // One-time cleanup after hydration: migrate the old chat format and mark
  // runs that were interrupted by a reload.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const legacy = migrateLegacyChat();
    // One-off migration of persisted state from the previous UI version.
    setItems((current) => {
      const base = current.length === 0 && legacy ? legacy : current;
      return base.map((item) => {
        if (item.kind !== "run" || item.run.status !== "running") return item;
        const endedAt = Math.max(item.run.startedAt, ...item.run.steps.map((s) => s.endedAt ?? s.startedAt));
        return {
          ...item,
          run: {
            ...item.run,
            status: "cancelled",
            endedAt,
            steps: item.run.steps.map((s) => (s.status === "active" ? { ...s, status: "failed" as const, endedAt } : s)),
            notes: [...(item.run.notes ?? []), "Interrupted by a page reload"],
          },
        };
      });
    });
  }, [setItems]);

  const pushItem = useCallback(
    (item: ChatItem) => setItems((all) => [...all, item].slice(-MAX_ITEMS)),
    [setItems],
  );

  const updateRun = useCallback(
    (runId: string, update: (run: RunRecord) => RunRecord) =>
      setItems((all) => all.map((item) => (item.kind === "run" && item.run.id === runId ? { ...item, run: update(item.run) } : item))),
    [setItems],
  );

  const note = useCallback(
    (text: string, tone: "info" | "warning" = "info") => pushItem({ id: newId(), kind: "assistant", text, at: Date.now(), tone }),
    [pushItem],
  );

  const startRun = useCallback(
    async (input: { prompt: string; mode: "create" | "edit"; existingCode?: string; history?: ChatTurn[]; analysis?: unknown }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const reviewEnabled = settings.review && reviewerSupportsVision;

      const run: RunRecord = {
        id: newId(),
        mode: input.mode,
        prompt: input.prompt,
        status: "running",
        steps: [],
        startedAt: Date.now(),
        model: selection,
        reviewer: reviewEnabled ? reviewer : undefined,
        reviews: [],
        notes: settings.review && !reviewerSupportsVision ? [`Review skipped — ${reviewer.model} can't view images`] : [],
      };
      pushItem({ id: `run-${run.id}`, kind: "run", run, at: run.startedAt });
      setBusy("running");
      // Streaming writes straight into the editor; this is what to put back if the run is stopped or fails.
      const baseline = input.mode === "edit" ? (input.existingCode ?? "") : "";
      if (input.mode === "create") setCode("");

      const steps: PipelineSteps = {
        plan: async (prompt, analysis, signal) => (await api.plan(prompt, analysis, selection, signal)).plan,
        generate: async (genInput, signal) => {
          let raw = "";
          let frame = 0;
          const flush = () => {
            frame = 0;
            setCode(cleanD2Output(raw));
          };
          try {
            const result = await api.generate(genInput, selection, (chunk) => {
              raw += chunk;
              if (!frame) frame = requestAnimationFrame(flush);
            }, signal);
            raw = result.text;
          } finally {
            if (frame) cancelAnimationFrame(frame);
          }
          const cleaned = cleanD2Output(raw);
          if (!cleaned) throw new Error("The model returned an empty diagram");
          setCode(cleaned);
          return cleaned;
        },
        render: async (candidate, signal) => {
          try {
            return await api.render(candidate, signal);
          } catch (err) {
            // Only a 422 means the D2 is wrong; anything else must not trigger a syntax-fix round.
            if (isAbort(err) || isD2SyntaxError(err)) throw err;
            throw new RenderUnavailableError(errText(err));
          }
        },
        assess: reviewEnabled
          ? async (review, signal) => (await api.assess({ svg: review.svg, prompt: review.prompt, d2Code: review.code }, reviewer, signal)).assessment
          : undefined,
      };

      try {
        const result = await runDiagramPipeline(steps, {
          prompt: input.prompt,
          existingCode: input.existingCode,
          history: input.history,
          analysis: input.analysis,
          maxRefinements: settings.refinements,
          signal: controller.signal,
          onEvent: (event) => updateRun(run.id, (r) => applyEvent(r, event, Date.now())),
        });
        setCode(result.code);
        const now = Date.now();
        updateRun(run.id, (r) => ({
          ...r,
          status: "done",
          endedAt: now,
          steps: r.steps.map((s) => (s.status === "active" ? { ...s, status: "done", endedAt: now } : s)),
          outcome: result.outcome,
          reviewScore: result.assessment?.score,
          qualityScore: result.quality?.score,
          qualityGrade: result.quality?.grade,
          refinements: result.refinements,
          bestRound: result.bestRound ?? undefined,
        }));
      } catch (err) {
        const now = Date.now();
        const cancelled = isAbort(err) || controller.signal.aborted;
        const kept =
          err instanceof PipelineAbortError && err.bestCode
            ? { code: err.bestCode, round: err.bestRound }
            : err instanceof RenderUnavailableError && err.candidate
              ? { code: err.candidate.code, round: null }
              : null;
        // Never leave half-streamed output in place of the user's diagram. Skip
        // when a newer run or a reset has taken over the editor.
        if (abortRef.current === controller) {
          setCode(kept ? kept.code : baseline);
        }
        updateRun(run.id, (r) => ({
          ...r,
          status: cancelled ? "cancelled" : "failed",
          endedAt: now,
          error: cancelled ? undefined : errText(err),
          steps: r.steps.map((s) => (s.status === "active" ? { ...s, status: cancelled ? "done" : "failed", endedAt: now } : s)),
          // Lets the Review tab show the review of the version left on the canvas.
          ...(kept && kept.round !== null ? { bestRound: kept.round } : {}),
        }));
      } finally {
        // A newer run (or a reset) owns the busy state now; don't clobber it.
        if (abortRef.current === controller) {
          abortRef.current = null;
          setBusy("idle");
        } else if (abortRef.current === null) {
          setBusy("idle");
        }
      }
    },
    [pushItem, reviewer, reviewerSupportsVision, selection, setCode, settings.refinements, settings.review, updateRun],
  );

  const priorRequests = useCallback((): ChatTurn[] => {
    const users = items.filter((i): i is Extract<ChatItem, { kind: "user" }> => i.kind === "user");
    return users.slice(-6).map((u) => ({ role: "user", content: u.text.slice(0, HISTORY_TURN_LIMIT) }));
  }, [items]);

  const askClarify = useCallback(
    async (prompt: string) => {
      setBusy("clarifying");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await api.clarify(prompt, selection, controller.signal);
        if (result.skipClarification || result.questions.length === 0) {
          note("Your request is detailed enough — skipping clarifying questions.");
          setBusy("idle");
          void startRun({ prompt, mode: "create", analysis: result.analysis });
          return;
        }
        setClarify({ prompt, questions: result.questions as ClarifyQuestion[], analysis: result.analysis });
        setBusy("idle");
      } catch (err) {
        setBusy("idle");
        if (isAbort(err)) return;
        note(`Couldn't get clarifying questions (${errText(err)}). Generating directly.`, "warning");
        void startRun({ prompt, mode: "create" });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [note, selection, startRun],
  );

  const send = useCallback(
    (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy !== "idle") return;
      setClarify(null);
      pushItem({ id: newId(), kind: "user", text: prompt, at: Date.now() });
      if (code.trim()) {
        void startRun({ prompt, mode: "edit", existingCode: code, history: priorRequests() });
      } else if (settings.clarify) {
        void askClarify(prompt);
      } else {
        void startRun({ prompt, mode: "create" });
      }
    },
    [askClarify, busy, code, priorRequests, pushItem, settings.clarify, startRun],
  );

  const submitClarify = useCallback(
    (answers: ClarifyAnswers) => {
      if (!clarify) return;
      const specs = resolveAnswerSpecs(clarify.questions, answers);
      if (specs.length > 0) pushItem({ id: newId(), kind: "user", text: specs.map((s) => `• ${s}`).join("\n"), at: Date.now() });
      const prompt = specs.length > 0 ? `${clarify.prompt}\n\nAdditional specifications:\n${specs.map((s) => `- ${s}`).join("\n")}` : clarify.prompt;
      const analysis = clarify.analysis;
      setClarify(null);
      void startRun({ prompt, mode: "create", analysis });
    },
    [clarify, pushItem, startRun],
  );

  const skipClarify = useCallback(() => {
    if (!clarify) return;
    const { prompt, analysis } = clarify;
    setClarify(null);
    void startRun({ prompt, mode: "create", analysis });
  }, [clarify, startRun]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retryRun = useCallback(
    (run: RunRecord) => {
      if (busy !== "idle") return;
      setClarify(null);
      pushItem({ id: newId(), kind: "user", text: "Try again", at: Date.now() });
      if (run.mode === "create") {
        void startRun({ prompt: run.prompt, mode: "create" });
      } else {
        void startRun({ prompt: run.prompt, mode: "edit", existingCode: code, history: priorRequests() });
      }
    },
    [busy, code, priorRequests, pushItem, startRun],
  );

  const fixRenderError = useCallback(
    (message: string) => {
      if (busy !== "idle" || !code.trim()) return;
      const prompt = `The diagram fails to render with this D2 error: "${message}". Fix the syntax while keeping the architecture intact.`;
      setClarify(null);
      pushItem({ id: newId(), kind: "user", text: "Fix the rendering error", at: Date.now() });
      void startRun({ prompt, mode: "edit", existingCode: code });
    },
    [busy, code, pushItem, startRun],
  );

  const applyReview = useCallback(
    (assessment: ReviewAssessment) => {
      if (busy !== "idle" || !code.trim()) return;
      setClarify(null);
      pushItem({ id: newId(), kind: "user", text: "Apply the reviewer's suggested fixes", at: Date.now() });
      void startRun({ prompt: reviewFixPrompt(assessment, null), mode: "edit", existingCode: code });
    },
    [busy, code, pushItem, startRun],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCode("");
    setItems([]);
    setClarify(null);
    setBusy("idle");
    setTitle("Untitled diagram");
  }, [setCode, setItems, setTitle]);

  const latestRun = [...items].reverse().find((i): i is Extract<ChatItem, { kind: "run" }> => i.kind === "run")?.run ?? null;

  return {
    code,
    setCode,
    items,
    title,
    setTitle,
    settings,
    setSettings,
    busy,
    clarify,
    latestRun,
    send,
    submitClarify,
    skipClarify,
    stop,
    retryRun,
    reset,
    fixRenderError,
    applyReview,
  };
}
