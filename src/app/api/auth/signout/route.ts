import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api/http";
import { clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", clearSessionCookie(request));
  return response;
}
