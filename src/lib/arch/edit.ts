import { archFitSize, growNodeToFit } from "@/lib/model/ops";
import type { DiagramModel } from "@/lib/model/types";
import { ARCH_LIMITS, MEANINGS, type Meaning } from "./spec";

export { setArchTitle } from "./title";

/**
 * Canvas edits of Architecture-specific data. Every helper returns a new model; a node whose text
 * got longer grows to fit (Tidy up re-lays everything out). Text is trimmed to the spec's budgets
 * so a round trip through the normaliser never has to repair it.
 */

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/** The detail line of a component (SKU or tier, count, version, port); empty removes it. */
export function setArchDetail(model: DiagramModel, nodeId: string, text: string): DiagramModel {
  return fit(updateArch(model, nodeId, (arch) => ({ ...arch, detail: clean(text, ARCH_LIMITS.detailChars) || undefined })), nodeId);
}

/** The facts of a boundary (address range, region, zone, namespace); empty removes them. */
export function setArchFacts(model: DiagramModel, nodeId: string, text: string): DiagramModel {
  return fit(updateArch(model, nodeId, (arch) => ({ ...arch, facts: clean(text, ARCH_LIMITS.factsChars) || undefined })), nodeId);
}

function fit(model: DiagramModel, nodeId: string): DiagramModel {
  const node = model.nodes.find((n) => n.id === nodeId);
  const size = node && archFitSize(node);
  return size ? growNodeToFit(model, nodeId, size) : model;
}

/** A connection's meaning; peering and VPN links get arrowheads at both ends. */
export function setArchMeaning(model: DiagramModel, edgeId: string, meaning: Meaning): DiagramModel {
  if (!MEANINGS.includes(meaning)) return model;
  const both = meaning === "peering" || meaning === "vpn";
  return { ...model, edges: model.edges.map((e) => (e.id === edgeId ? { ...e, meaning, srcArrow: both ? "triangle" : "none", dstArrow: "triangle" } : e)) };
}

/** A component's icon by registry key (undefined clears it). */
export function setArchIcon(model: DiagramModel, nodeId: string, key: string | undefined): DiagramModel {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== nodeId || n.container) return n;
      const next = { ...n, arch: { ...(n.arch ?? { id: n.id.split(".").at(-1) ?? n.id }), iconKey: key } };
      if (key) next.icon = `/icons/${key}.svg`;
      else delete next.icon;
      if (!key) delete next.arch.iconKey;
      return next;
    }),
  };
}

function updateArch(model: DiagramModel, nodeId: string, update: (arch: NonNullable<DiagramModel["nodes"][number]["arch"]>) => NonNullable<DiagramModel["nodes"][number]["arch"]>): DiagramModel {
  return {
    ...model,
    nodes: model.nodes.map((n) => {
      if (n.id !== nodeId || n.generated) return n;
      const arch = update(n.arch ?? { id: n.id.split(".").at(-1) ?? n.id });
      for (const key of Object.keys(arch) as Array<keyof typeof arch>) if (arch[key] === undefined) delete arch[key];
      return { ...n, arch };
    }),
  };
}
