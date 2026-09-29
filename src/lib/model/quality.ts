import type { CompiledDiagram } from "@/lib/d2-render";
import type { DiagramModel } from "./types";

/**
 * Presents a model in the compiled-D2 shape the quality scorer reads, so the
 * deterministic checks score exactly what the canvas shows (including hand
 * edits and re-routed lines).
 */
export function modelToCompiled(model: DiagramModel): CompiledDiagram {
  const depth = new Map<string, number>();
  for (const n of model.nodes) {
    depth.set(n.id, n.parent === null ? 1 : (depth.get(n.parent) ?? 0) + 1);
  }
  return {
    shapes: model.nodes.map((n) => ({
      id: n.id,
      type: n.shape,
      pos: { x: n.box.x, y: n.box.y },
      width: n.box.w,
      height: n.box.h,
      label: n.label,
      icon: n.icon ?? null,
      level: depth.get(n.id) ?? 1,
    })),
    connections: model.edges.map((e) => ({
      id: e.id,
      src: e.from,
      dst: e.to,
      label: e.label ?? "",
      strokeDash: e.style.strokeDash ?? 0,
      route: e.route.map((p) => ({ x: p.x, y: p.y })),
    })),
  };
}
