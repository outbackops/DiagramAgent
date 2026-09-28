import { planToD2Scaffold } from "@/lib/plan-to-d2";

/**
 * Pure text helpers shared by the browser pipeline and the server/eval
 * pipeline. No I/O.
 */

const OPEN_FENCE = /```[ \t]*(?:d2)?[ \t]*\r?\n/i;

/**
 * Extract D2 from a model reply. Handles bare code, fenced code, prose before
 * a fence, and a fence that has not been closed yet (mid-stream).
 */
export function cleanD2Output(raw: string): string {
  if (/^\s*```[^\n]*$/.test(raw)) return "";
  const open = OPEN_FENCE.exec(raw);
  if (!open) return raw.replace(/\n?```\s*$/, "").trim();
  const body = raw.slice(open.index + open[0].length);
  const close = body.search(/\r?\n?```/);
  return (close >= 0 ? body.slice(0, close) : body).trim();
}

/**
 * Prefix the user request with the architecture plan and a deterministic D2
 * scaffold derived from it, so the generator refines a complete skeleton
 * instead of reconstructing (and dropping) components.
 */
export function composeGenerationPrompt(prompt: string, plan?: Record<string, unknown> | null): string {
  if (!plan) return prompt;
  const scaffold = planToD2Scaffold(plan);
  const scaffoldBlock =
    scaffold.d2 && scaffold.componentCount > 0
      ? `\n\nD2 SCAFFOLD (deterministic, derived from plan — refine, do not rebuild from scratch):\n${scaffold.d2}`
      : "";
  return `ARCHITECTURE PLAN:\n${JSON.stringify(plan, null, 2)}${scaffoldBlock}\n\nUSER REQUEST:\n${prompt}`;
}

export interface GenerationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build the conversation for a generate call. Edits replay the current code
 * as the assistant's last turn followed by the change request.
 */
export function buildGenerationConversation(input: {
  prompt: string;
  existingCode?: string;
  history?: GenerationTurn[];
}): { prompt: string; history: GenerationTurn[] } {
  const history = (input.history ?? []).filter((t) => t.content.trim().length > 0);
  if (!input.existingCode?.trim()) return { prompt: input.prompt, history };
  return {
    prompt: `Modify the above D2 diagram based on this request: ${input.prompt}. Output the COMPLETE updated D2 code.`,
    history: [...history, { role: "assistant", content: input.existingCode }],
  };
}
