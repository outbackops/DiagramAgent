import type { DiagramModel } from "./types";

export type DiagramKind = "graph" | "poster" | "architecture";

/**
 * Which engine owns a document: the Architecture engine (src/lib/arch), the Poster engine
 * (src/lib/compose; legacy `composed: true`), or none — a free-form graph, usually from D2.
 * Use this instead of reading `kind` or `composed` directly.
 */
export function diagramKind(model: Pick<DiagramModel, "kind" | "composed"> | null | undefined): DiagramKind {
  if (!model) return "graph";
  if (model.kind === "architecture") return "architecture";
  if (model.kind === "poster" || model.composed) return "poster";
  return "graph";
}

/** Poster and Architecture documents are laid out by an engine and edited through a spec. */
export function isEngineLaidOut(model: Pick<DiagramModel, "kind" | "composed"> | null | undefined): boolean {
  return diagramKind(model) !== "graph";
}
