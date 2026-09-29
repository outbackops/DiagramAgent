import { requireCredentials } from "@/lib/auth/session";
import { resolveSelection } from "@/lib/llm";
import type { LlmCredentials, ModelSelection } from "@/lib/llm/types";
import { parseSelectionField } from "./schemas";

/** Resolve who the request runs as and which (validated) model it may use. */
export async function resolveStepContext(
  request: Request,
  requestedModel: unknown,
): Promise<{ credentials: LlmCredentials; selection: ModelSelection }> {
  const credentials = requireCredentials(request);
  const selection = await resolveSelection(parseSelectionField(requestedModel), credentials);
  return { credentials, selection };
}
