/**
 * Deterministic plan → D2 scaffold.
 *
 * Walks the JSON plan returned by /api/plan and emits a structurally-correct
 * D2 skeleton: containers, nested resources, and connections — without any
 * styling decisions. The LLM then *refines* this skeleton (adds icons,
 * grouping tweaks, edge labels, polish) instead of constructing the whole
 * thing from scratch and silently dropping nodes.
 *
 * Scope:
 * - Pure function. No I/O, no network, no LLM calls.
 * - Produces *valid* D2 (parseable). It does not aim for pretty.
 * - Skips silently on malformed input — returns "" so the upstream flow can
 *   fall back to LLM-only generation.
 */

export interface PlanComponent {
  name: string;
  type?: string;
  icon?: string;
  zone?: string;
  container?: string;
}

export interface PlanConnection {
  from: string;
  to: string;
  label?: string;
  style?: "solid" | "dashed";
}

export interface PlanLike {
  pattern?: string;
  provider?: string;
  components?: unknown;
  hierarchy?: unknown;
  connections?: unknown;
}

// ---- ID sanitisation ----

/**
 * D2 identifiers can use almost anything if quoted, but for path expressions
 * (a.b.c → a -> b -> c) we want unquoted identifiers wherever possible.
 * Replace whitespace and special chars with underscores; preserve case.
 */
export function sanitizeId(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "_";
}

/**
 * Sanitize a dotted path like "Subscription.PrimaryRegion.AppRG" — segments
 * are sanitized individually, dots between segments are preserved.
 */
export function sanitizePath(path: string): string {
  return path
    .split(".")
    .filter((seg) => seg.trim().length > 0)
    .map((seg) => sanitizeId(seg))
    .filter(Boolean)
    .join(".");
}

// ---- Hierarchy walking ----

interface ScaffoldContext {
  declaredPaths: Set<string>;
  componentLabels: Map<string, string>;
  out: string[];
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function emitNode(ctx: ScaffoldContext, path: string, label: string, depth: number) {
  if (ctx.declaredPaths.has(path)) return;
  ctx.declaredPaths.add(path);
  const id = path.split(".").pop() || path;
  if (label && label !== id) {
    ctx.out.push(`${indent(depth)}${id}: "${label.replace(/"/g, '\\"')}"`);
  } else {
    ctx.out.push(`${indent(depth)}${id}`);
  }
}

function walkHierarchy(
  ctx: ScaffoldContext,
  node: unknown,
  pathPrefix: string,
  depth: number
): void {
  if (node === null || node === undefined) return;

  // Leaf array of resource names: each becomes a node inside the current container
  if (Array.isArray(node)) {
    for (const child of node) {
      if (typeof child !== "string") continue;
      const id = sanitizeId(child);
      if (!id) continue;
      const path = pathPrefix ? `${pathPrefix}.${id}` : id;
      const label = ctx.componentLabels.get(id) ?? child;
      emitNode(ctx, path, label, depth);
    }
    return;
  }

  if (typeof node !== "object") return;

  // Object: each key is a container; its value is its body
  const obj = node as Record<string, unknown>;
  for (const [rawKey, child] of Object.entries(obj)) {
    const id = sanitizeId(rawKey);
    if (!id) continue;
    const path = pathPrefix ? `${pathPrefix}.${id}` : id;
    const isContainer =
      child !== null &&
      typeof child === "object" &&
      (Array.isArray(child) ? child.length > 0 : Object.keys(child as object).length > 0);

    if (isContainer) {
      // Open container
      if (!ctx.declaredPaths.has(path)) {
        ctx.declaredPaths.add(path);
        const label = ctx.componentLabels.get(id) ?? rawKey;
        const opener =
          label && label !== id
            ? `${indent(depth)}${id}: "${label.replace(/"/g, '\\"')}" {`
            : `${indent(depth)}${id}: {`;
        ctx.out.push(opener);
      } else {
        ctx.out.push(`${indent(depth)}${id}: {`);
      }
      walkHierarchy(ctx, child, path, depth + 1);
      ctx.out.push(`${indent(depth)}}`);
    } else {
      const label = ctx.componentLabels.get(id) ?? rawKey;
      emitNode(ctx, path, label, depth);
    }
  }
}

// ---- Connection emission ----

function emitConnection(ctx: ScaffoldContext, c: PlanConnection): string | null {
  const from = sanitizePath(c.from);
  const to = sanitizePath(c.to);
  if (!from || !to) return null;

  const label = c.label?.trim();
  const style = c.style === "dashed";

  if (label && style) {
    return `${from} -> ${to}: "${label.replace(/"/g, '\\"')}" {style.stroke-dash: 3}`;
  }
  if (label) {
    return `${from} -> ${to}: "${label.replace(/"/g, '\\"')}"`;
  }
  if (style) {
    return `${from} -> ${to}: {style.stroke-dash: 3}`;
  }
  return `${from} -> ${to}`;
}

// ---- Public API ----

export interface ScaffoldResult {
  d2: string;
  componentCount: number;
  connectionCount: number;
  containerCount: number;
}

/**
 * Build a D2 scaffold from a plan JSON. Returns empty string when the plan
 * doesn't have enough structure to scaffold from.
 */
export function planToD2Scaffold(plan: PlanLike | unknown): ScaffoldResult {
  const empty: ScaffoldResult = { d2: "", componentCount: 0, connectionCount: 0, containerCount: 0 };
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return empty;

  const p = plan as PlanLike;

  // Build component name → display label map
  const componentLabels = new Map<string, string>();
  if (Array.isArray(p.components)) {
    for (const c of p.components) {
      if (c && typeof c === "object" && typeof (c as PlanComponent).name === "string") {
        const name = (c as PlanComponent).name;
        componentLabels.set(sanitizeId(name), name);
      }
    }
  }

  const ctx: ScaffoldContext = {
    declaredPaths: new Set(),
    componentLabels,
    out: [],
  };

  ctx.out.push("# Auto-scaffolded from plan — refine, don't rebuild");
  ctx.out.push("direction: right");
  ctx.out.push("");

  // Walk hierarchy if present
  if (p.hierarchy && typeof p.hierarchy === "object") {
    walkHierarchy(ctx, p.hierarchy, "", 0);
  }

  // Add any components that have an explicit container path but weren't
  // captured by hierarchy (defensive).
  if (Array.isArray(p.components)) {
    for (const c of p.components) {
      if (!c || typeof c !== "object") continue;
      const comp = c as PlanComponent;
      if (typeof comp.name !== "string") continue;
      const id = sanitizeId(comp.name);
      if (!id) continue;
      const fullPath = comp.container
        ? `${sanitizePath(comp.container)}.${id}`
        : id;
      if (!ctx.declaredPaths.has(fullPath)) {
        // Top-level fallback: just declare it bare
        emitNode(ctx, id, comp.name, 0);
      }
    }
  }

  // Connections
  let connEmitted = 0;
  if (Array.isArray(p.connections)) {
    if (ctx.out[ctx.out.length - 1] !== "") ctx.out.push("");
    ctx.out.push("# Connections");
    for (const raw of p.connections) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as PlanConnection;
      if (typeof c.from !== "string" || typeof c.to !== "string") continue;
      const line = emitConnection(ctx, c);
      if (line) {
        ctx.out.push(line);
        connEmitted++;
      }
    }
  }

  // Count containers (lines opening with `{`)
  const containerCount = ctx.out.filter((l) => /\{\s*$/.test(l)).length;

  // If we didn't emit anything beyond the header, treat as empty
  const meaningful = ctx.out.filter((l) => l.trim() && !l.trim().startsWith("#") && !l.startsWith("direction:"));
  if (meaningful.length === 0) return empty;

  return {
    d2: ctx.out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
    componentCount: ctx.declaredPaths.size,
    connectionCount: connEmitted,
    containerCount,
  };
}
