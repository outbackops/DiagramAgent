import { NextRequest } from "next/server";
import { resolveStepContext } from "@/lib/api/context";
import { guardApiRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { GenerateBody, parseBody } from "@/lib/api/schemas";
import { errorResponseBody, isLlmError } from "@/lib/llm/errors";
import { runGenerate } from "@/lib/pipeline/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Streams D2 as server-sent events:
 *   data: {"content": "..."}          — incremental text
 *   data: {"done": true, "model", "usage"}
 *   data: {"error": "...", "code"}    — failure after the stream started
 *   data: [DONE]
 */
export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  let body: ReturnType<typeof GenerateBody.parse>;
  let ctx: Awaited<ReturnType<typeof resolveStepContext>>;
  try {
    body = parseBody(GenerateBody, await readJsonBody(request));
    ctx = await resolveStepContext(request, body.model);
  } catch (err) {
    return jsonError(err, "Generate API error");
  }

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          const data = typeof payload === "string" ? payload : JSON.stringify(payload);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Client went away; nothing to deliver to.
        }
      };
      try {
        const result = await runGenerate(
          { prompt: body.prompt, existingCode: body.existingCode, history: body.history },
          { ...ctx, signal: abort.signal },
          (chunk) => send({ content: chunk }),
        );
        send({ done: true, model: ctx.selection, usage: result.usage });
      } catch (err) {
        if (!(isLlmError(err) && err.code === "aborted")) {
          if (!isLlmError(err)) console.error("Generate stream error:", err);
          send(errorResponseBody(err));
        }
      } finally {
        send("[DONE]");
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
