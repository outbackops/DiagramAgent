import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest, jsonError } from "@/lib/api/http";
import type { ModelsResponse } from "@/lib/api/types";
import { requireCredentials } from "@/lib/auth/session";
import { listCatalog } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Models the caller is entitled to (their Copilot catalog, plus Azure deployments when configured). */
export async function GET(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  try {
    const catalog: ModelsResponse = await listCatalog(requireCredentials(request));
    return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err, "Models API error");
  }
}
