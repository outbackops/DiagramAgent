import type { DiagramModel } from "@/lib/model/types";
import { ARCH_LIMITS } from "./spec";

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/** The page title (and optionally subtitle): canonical data, projected onto the title node. */
export function setArchTitle(model: DiagramModel, title: string, subtitle?: string): DiagramModel {
  if (!model.arch) return model;
  const nextTitle = clean(title, ARCH_LIMITS.titleChars) || model.arch.title;
  const arch = { ...model.arch, title: nextTitle };
  if (subtitle !== undefined) {
    const s = clean(subtitle, ARCH_LIMITS.subtitleChars);
    if (s) arch.subtitle = s;
    else delete arch.subtitle;
  }
  return { ...model, arch, nodes: model.nodes.map((n) => (n.generated && n.role === "title" ? { ...n, label: nextTitle } : n)) };
}
