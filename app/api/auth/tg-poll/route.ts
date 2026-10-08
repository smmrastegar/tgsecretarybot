import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { audit, pollLoginRequest } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";
import { LOGIN_COOKIE, sha256 } from "@/lib/tg-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?nonce=… → { status: "pending" | "ok" | "expired" | "unknown" }. On approval the
// session cookie is set right here (single use).
export async function GET(request: Request): Promise<NextResponse> {
  const nonce = new URL(request.url).searchParams.get("nonce") ?? "";
  const secret = (await cookies()).get(LOGIN_COOKIE)?.value ?? "";
  if (!nonce || !secret) return NextResponse.json({ status: "unknown" }, { status: 400 });
  const r = await pollLoginRequest(sha256(nonce), sha256(secret));
  if (r.status !== "approved" || !r.user) return NextResponse.json({ status: r.status });
  await setSessionCookie(await createSession(r.user));
  (await cookies()).delete({ name: LOGIN_COOKIE, path: "/api/auth" });
  await audit({ actorId: r.user.userId, actorName: r.user.username ?? null, action: "auth.telegram-deeplink" });
  return NextResponse.json({ status: "ok" });
}
