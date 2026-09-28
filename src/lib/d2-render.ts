import { resolveIconsInD2Code } from "@/lib/icon-registry";
import { convertConnectionsToOrthogonal } from "@/lib/svg-orthogonal";
import { errorMessage } from "@/lib/error-message";

/**
 * Server-side D2 → SVG rendering (WASM). Shared by /api/render, the quality
 * scorer, the fixture tests, and the eval harness.
 */

export interface CompiledShape {
  id: string;
  type: string;
  pos: { x: number; y: number };
  width: number;
  height: number;
  label: string;
  icon: unknown;
  level: number;
}

export interface CompiledConnection {
  id: string;
  src: string;
  dst: string;
  label: string;
  strokeDash: number;
  route: Array<{ x: number; y: number }>;
}

export interface CompiledDiagram {
  shapes: CompiledShape[];
  connections: CompiledConnection[];
}

export interface RenderResult {
  svg: string;
  diagram: CompiledDiagram;
}

type D2Like = {
  compile: (code: string, opts: { layout: string; sketch: boolean; pad: number }) => Promise<{
    diagram: unknown;
    renderOptions: Record<string, unknown>;
  }>;
  render: (diagram: unknown, opts: Record<string, unknown>) => Promise<string>;
};

export class D2RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D2RenderError";
  }
}

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

export async function renderD2(code: string): Promise<RenderResult> {
  const d2 = await getD2();
  try {
    const compiled = await d2.compile(resolveIconsInD2Code(code), { layout: "elk", sketch: false, pad: 40 });
    const svg = await d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      themeID: 0,
      center: true,
      noXMLTag: true,
    });
    return { svg: convertConnectionsToOrthogonal(svg, 8), diagram: toCompiledDiagram(compiled.diagram) };
  } catch (err) {
    throw new D2RenderError(formatD2Error(err));
  }
}
