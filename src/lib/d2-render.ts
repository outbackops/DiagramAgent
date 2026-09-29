import { resolveIconsInD2Code } from "@/lib/icon-registry";
import { countObstacleHits, isOrthogonalRoute, routeOrthogonal, type Point, type Rect } from "@/lib/d2-routes";
import { errorMessage } from "@/lib/error-message";

/**
 * Server-side D2 compilation (WASM, ELK layout). D2 is the automatic layout
 * engine: its compiled shapes and routes are imported into the diagram model,
 * which the app renders itself. Shared by /api/render, the export routes, the
 * fixture tests and the eval harness.
 */

export interface CompiledShape {
  id: string;
  type: string;
  classes?: string[];
  pos: { x: number; y: number };
  width: number;
  height: number;
  opacity?: number;
  strokeDash?: number;
  strokeWidth?: number;
  borderRadius?: number;
  fill?: string;
  stroke?: string;
  animated?: boolean;
  shadow?: boolean;
  "3d"?: boolean;
  multiple?: boolean;
  "double-border"?: boolean;
  tooltip?: string;
  link?: string;
  label: string;
  icon: unknown;
  iconPosition?: string;
  fontSize?: number;
  color?: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  labelWidth?: number;
  labelHeight?: number;
  labelPosition?: string;
  level: number;
}

export interface CompiledConnection {
  id: string;
  src: string;
  srcArrow?: string;
  dst: string;
  dstArrow?: string;
  opacity?: number;
  label: string;
  stroke?: string;
  strokeDash: number;
  strokeWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  color?: string;
  italic?: boolean;
  bold?: boolean;
  labelWidth?: number;
  labelHeight?: number;
  labelPosition?: string;
  labelPercentage?: number;
  route: Point[];
}

export interface CompiledDiagram {
  shapes: CompiledShape[];
  connections: CompiledConnection[];
}

export interface CompileResult {
  diagram: CompiledDiagram;
}

type D2Like = {
  compile: (code: string, opts: { layout: string; sketch: boolean; pad: number }) => Promise<{
    diagram: unknown;
    renderOptions: Record<string, unknown>;
  }>;
  /** Node worker_threads Worker hosting the WASM runtime. */
  worker?: { terminate?: () => unknown };
};

export class D2RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D2RenderError";
  }
}

export class D2BusyError extends D2RenderError {
  constructor() {
    super("Renderer is busy, try again shortly");
    this.name = "D2BusyError";
  }
}

function abortError(): Error {
  const err = new Error("Request was cancelled");
  err.name = "AbortError";
  return err;
}

/** Per-step (layout, rendering) limit; overridable for slow machines and tests. */
const stepTimeoutMs = () => Number(process.env.DIAGRAM_AGENT_RENDER_TIMEOUT_MS) || 45_000;
const queueLimit = () => Number(process.env.DIAGRAM_AGENT_RENDER_QUEUE_LIMIT) || 8;

let d2Promise: Promise<D2Like> | null = null;

function getD2(): Promise<D2Like> {
  d2Promise ??= import("@terrastruct/d2")
    .then(({ D2 }) => new D2() as unknown as D2Like)
    .catch((err) => {
      d2Promise = null;
      throw err;
    });
  return d2Promise;
}

/** Throw away a wedged instance; the next render starts a fresh worker. */
function discardD2(instance: D2Like) {
  void Promise.resolve(instance.worker?.terminate?.()).catch(() => {});
  d2Promise = null;
}

// The D2 JS wrapper tracks a single pending request: overlapping calls orphan
// the earlier promise (it never settles) and can receive each other's
// results. Every compile therefore runs strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function exclusive<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (pending >= queueLimit()) throw new D2BusyError();
  pending++;
  const runTask = async () => {
    pending--;
    if (signal?.aborted) throw abortError();
    return task();
  };
  const run = queue.then(runTask, runTask);
  queue = run.catch(() => undefined);
  return run;
}

async function step<T>(instance: D2Like, work: Promise<T>, what: string): Promise<T> {
  const limit = stepTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      discardD2(instance);
      reject(new D2RenderError(`Diagram ${what} took longer than ${Math.round(limit / 1000)}s. Simplify the diagram and try again.`));
    }, limit);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** D2 reports compile errors as a JSON array of {errmsg}; flatten that to text. */
export function formatD2Error(err: unknown): string {
  const text = errorMessage(err) || "Failed to render diagram";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.some((e) => e && typeof e === "object" && "errmsg" in e)) {
      return parsed.map((e: { errmsg?: string }) => e.errmsg ?? "").filter(Boolean).join("\n");
    }
  } catch {
    // Not JSON — keep the original message.
  }
  return text;
}

function toCompiledDiagram(raw: unknown): CompiledDiagram {
  const d = (raw ?? {}) as { shapes?: CompiledShape[] | null; connections?: CompiledConnection[] | null };
  return { shapes: d.shapes ?? [], connections: d.connections ?? [] };
}

/** Boxes of leaf shapes — what a connection must not run through. */
function leafObstacles(diagram: CompiledDiagram): Rect[] {
  const ids = diagram.shapes.map((s) => s.id);
  return diagram.shapes
    .filter((s) => !ids.some((other) => other.startsWith(`${s.id}.`)))
    .map((s) => ({ x: s.pos.x, y: s.pos.y, w: s.width, h: s.height }));
}

function fixCompiledRoutes(diagram: CompiledDiagram): CompiledDiagram {
  const obstacles = leafObstacles(diagram);
  const connections = diagram.connections.map((c) => {
    if (c.route.length < 2) return c;
    if (isOrthogonalRoute(c.route) && countObstacleHits(c.route, obstacles) === 0) return c;
    const start = c.route[0];
    const end = c.route[c.route.length - 1];
    const foreign = obstacles.filter(
      (o) =>
        !(start.x >= o.x - 2 && start.x <= o.x + o.w + 2 && start.y >= o.y - 2 && start.y <= o.y + o.h + 2) &&
        !(end.x >= o.x - 2 && end.x <= o.x + o.w + 2 && end.y >= o.y - 2 && end.y <= o.y + o.h + 2),
    );
    return { ...c, route: routeOrthogonal(start, end, foreign) };
  });
  return { ...diagram, connections };
}

export async function compileD2(code: string, options: { signal?: AbortSignal } = {}): Promise<CompileResult> {
  return exclusive(async () => {
    const d2 = await getD2();
    try {
      const compiled = await step(d2, d2.compile(resolveIconsInD2Code(code), { layout: "elk", sketch: false, pad: 40 }), "layout");
      if (!compiled || typeof compiled !== "object" || !("diagram" in compiled)) {
        throw new D2RenderError("D2 returned no diagram");
      }
      return { diagram: fixCompiledRoutes(toCompiledDiagram(compiled.diagram)) };
    } catch (err) {
      if (err instanceof D2RenderError) throw err;
      throw new D2RenderError(formatD2Error(err));
    }
  }, options.signal);
}
