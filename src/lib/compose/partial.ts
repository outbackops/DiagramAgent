/**
 * Whether text is a composition spec rather than D2: a JSON object, possibly
 * inside a ```json fence (D2 never starts with "{" or uses JSON fences).
 */
export function looksLikeSpec(text: string): boolean {
  return /^\s*(?:```(?:json)?\s*)?\{/i.test(text) || /```json/i.test(text);
}

/**
 * Closes a truncated JSON document — a spec still streaming in — so it
 * parses. The text is cut back to the last complete value (dropping a
 * half-written string, key or literal) and open arrays and objects are
 * closed. Returns null when no object has started yet.
 */
export function completePartialJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const src = text.slice(start);

  type Frame = { kind: "{" | "["; expectKey: boolean };
  const frames: Frame[] = [];
  let boundary = 0;
  let open: Array<"{" | "["> = [];
  const mark = (end: number) => {
    boundary = end;
    open = frames.map((f) => f.kind);
  };

  let inString = false;
  let escaped = false;
  let isKey = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (!isKey) mark(i + 1);
      }
      continue;
    }
    const top = frames[frames.length - 1];
    switch (ch) {
      case '"':
        inString = true;
        isKey = top?.kind === "{" && top.expectKey;
        break;
      case "{":
        frames.push({ kind: "{", expectKey: true });
        mark(i + 1);
        break;
      case "[":
        frames.push({ kind: "[", expectKey: false });
        mark(i + 1);
        break;
      case "}":
      case "]":
        frames.pop();
        mark(i + 1);
        if (frames.length === 0) return src.slice(0, i + 1);
        break;
      case ":":
        if (top) top.expectKey = false;
        break;
      case ",":
        // Whatever came before a comma is a complete value.
        mark(i);
        if (top?.kind === "{") top.expectKey = true;
        break;
      default:
        break;
    }
  }

  const body = src.slice(0, boundary).replace(/[\s,]+$/, "");
  const closers = open
    .slice()
    .reverse()
    .map((kind) => (kind === "{" ? "}" : "]"))
    .join("");
  const candidate = body + closers;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}
