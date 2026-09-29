import type { DiagramEdge, DiagramModel, DiagramNode } from "./types";

/** Read-only queries over a model. Cheap to build; rebuild after every change. */

export interface ModelIndex {
  byId: Map<string, DiagramNode>;
  children: Map<string | null, DiagramNode[]>;
  edgeById: Map<string, DiagramEdge>;
}

export function indexModel(model: DiagramModel): ModelIndex {
  const byId = new Map<string, DiagramNode>();
  const children = new Map<string | null, DiagramNode[]>();
  for (const n of model.nodes) {
    byId.set(n.id, n);
    const list = children.get(n.parent);
    if (list) list.push(n);
    else children.set(n.parent, [n]);
  }
  const edgeById = new Map(model.edges.map((e) => [e.id, e]));
  return { byId, children, edgeById };
}

export function isGroup(index: ModelIndex, id: string): boolean {
  const node = index.byId.get(id);
  return Boolean(node && (node.container || (index.children.get(id)?.length ?? 0) > 0));
}

/** All descendants of `id`, depth-first, parents before children. */
export function descendants(index: ModelIndex, id: string): DiagramNode[] {
  const out: DiagramNode[] = [];
  const walk = (parent: string) => {
    for (const child of index.children.get(parent) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Ancestors of `id`, nearest first. */
export function ancestors(index: ModelIndex, id: string): DiagramNode[] {
  const out: DiagramNode[] = [];
  let current = index.byId.get(id)?.parent ?? null;
  while (current !== null) {
    const node = index.byId.get(current);
    if (!node) break;
    out.push(node);
    current = node.parent;
  }
  return out;
}

/** Whether `id` is `ancestorId` or lies inside it. */
export function isWithin(index: ModelIndex, id: string, ancestorId: string): boolean {
  if (id === ancestorId) return true;
  return ancestors(index, id).some((a) => a.id === ancestorId);
}

/** Leaf nodes (not groups): what edges must route around. */
export function leafNodes(model: DiagramModel): DiagramNode[] {
  const index = indexModel(model);
  return model.nodes.filter((n) => !isGroup(index, n.id));
}

// ── D2 paths ─────────────────────────────────────────────────────────────

/**
 * Splits a D2 path into its keys. Keys that contain dots are quoted in D2
 * (`"a.b".c`); quotes are kept on the key so paths round-trip.
 */
export function splitPath(path: string): string[] {
  const keys: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of path) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      current += ch;
      quote = ch;
    } else if (ch === ".") {
      keys.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  keys.push(current);
  return keys;
}

/** Last key of a D2 path (the node's local name inside its parent). */
export function keyOf(id: string): string {
  const keys = splitPath(id);
  return keys[keys.length - 1];
}

export function joinPath(parent: string | null, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

/** D2-style edge id: `(from -> to)[n]`. */
export function edgeId(from: string, to: string, n: number): string {
  return `(${from} -> ${to})[${n}]`;
}

/** Recomputes edge ids from their endpoints so they stay unique and D2-shaped. */
export function renumberEdges(edges: DiagramEdge[]): DiagramEdge[] {
  const counts = new Map<string, number>();
  return edges.map((e) => {
    const pair = `${e.from}\u0000${e.to}`;
    const n = counts.get(pair) ?? 0;
    counts.set(pair, n + 1);
    const id = edgeId(e.from, e.to, n);
    return id === e.id ? e : { ...e, id };
  });
}

/** Turns a label into a D2 key that is unique among `taken`. */
export function uniqueKey(label: string, taken: Iterable<string>): string {
  const base =
    label
      .trim()
      .replace(/[^A-Za-z0-9_\- ]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/^[-_]+|[-_]+$/g, "") || "node";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
}
