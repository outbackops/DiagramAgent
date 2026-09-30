import { isArchSpecShape } from "@/lib/arch/normalize";
import { parseSpecText } from "@/lib/compose/normalize";
import { completePartialJson, looksLikeSpec } from "@/lib/compose/partial";

/** The language a run writes and a document is edited in: an Architecture spec, a Poster (composition) spec, or D2. */
export type DiagramFormat = "architecture" | "composition" | "d2";

/**
 * Which language `code` is written in. Specs are JSON: an Architecture spec has `items` and
 * `connections`, a Poster spec `columns`. A spec still streaming in is closed off first; one that
 * can't be read yet counts as a Poster spec, like the drafts saved before Architecture existed.
 */
export function formatOfCode(code: string): DiagramFormat {
  if (!looksLikeSpec(code)) return "d2";
  for (const text of [code, completePartialJson(code)]) {
    if (!text) continue;
    try {
      return isArchSpecShape(parseSpecText(text)) ? "architecture" : "composition";
    } catch {
      // Not readable yet: try the closed-off draft.
    }
  }
  return "composition";
}

export function isSpecFormat(format: DiagramFormat | undefined): format is "architecture" | "composition" {
  return format === "architecture" || format === "composition";
}
