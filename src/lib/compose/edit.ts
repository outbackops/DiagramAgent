import type { DiagramModel, DiagramNode, NodeContent, Tone } from "@/lib/model/types";
import { styleFor } from "./layout";
import { SPEC_LIMITS } from "./spec";
import { toneColors } from "./theme";

/**
 * Canvas edits of composed content beyond the title: the detail text and the
 * colour family. The spec is derived from the model, so these carry into the
 * next AI edit and Tidy up.
 */

/** Roles whose details are a list of lines; the others hold one sentence. */
const LINE_ROLES = new Set(["card", "step"]);

export function hasDetails(node: DiagramNode): boolean {
  return node.role !== undefined && node.role !== "column" && node.role !== "grid";
}

/** The editable detail text of a node: body lines for cards and steps, the subtitle for everything else. */
export function detailsOf(node: DiagramNode): string {
  if (LINE_ROLES.has(node.role ?? "")) return (node.content?.lines ?? []).join("\n");
  return node.content?.subtitle ?? "";
}

export function setDetails(model: DiagramModel, id: string, text: string): DiagramModel {
  const node = model.nodes.find((n) => n.id === id);
  if (!node || !hasDetails(node)) return model;
  const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
  let content: NodeContent;
  if (LINE_ROLES.has(node.role ?? "")) {
    const max = node.role === "step" ? SPEC_LIMITS.linesPerStep : SPEC_LIMITS.linesPerCard;
    const lines = text
      .split(/\r?\n/)
      .map((line) => clean(line, SPEC_LIMITS.lineChars))
      .filter(Boolean)
      .slice(0, max);
    content = { ...node.content, lines };
    if (lines.length === 0) delete content.lines;
  } else {
    const subtitle = clean(text, SPEC_LIMITS.subtitleChars);
    content = { ...node.content, subtitle };
    if (!subtitle) delete content.subtitle;
  }
  if (JSON.stringify(content) === JSON.stringify(node.content ?? {})) return model;
  const next: DiagramNode = Object.keys(content).length === 0 ? { ...node, content: undefined } : { ...node, content };
  if (!next.content) delete next.content;
  return { ...model, nodes: model.nodes.map((n) => (n.id === id ? next : n)) };
}

export function canTone(node: DiagramNode): boolean {
  return node.role === "card" || node.role === "step" || node.role === "banner" || node.role === "lane" || (!node.role && !node.container);
}

/**
 * Recolours a node. A lane takes along the steps and step arrows that shared
 * its colour, and the used-by chips that point at it follow automatically.
 */
export function setTone(model: DiagramModel, id: string, tone: Tone): DiagramModel {
  const node = model.nodes.find((n) => n.id === id);
  if (!node || !canTone(node) || node.tone === tone) return model;
  const previous = node.tone;
  const recolour = (n: DiagramNode): DiagramNode => ({ ...n, tone, style: n.role ? styleFor(n.role, tone) : { ...n.style, fill: toneColors(tone).fill, stroke: toneColors(tone).main } });
  const followers = new Set<string>([id]);
  if (node.role === "lane") {
    for (const n of model.nodes) if (n.parent === id && n.role === "step" && n.tone === previous) followers.add(n.id);
  }
  const nodes = model.nodes.map((n) => (followers.has(n.id) ? recolour(n) : n));
  const edges = model.edges.map((e) =>
    e.kind === "step" && followers.has(e.from) && followers.has(e.to) ? { ...e, tone, style: { ...e.style, stroke: toneColors(tone).main } } : e,
  );
  return { ...model, nodes, edges };
}
