import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { scAuthorizeUrl } from "@/lib/soundcloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0] || "playlist.bz";
  const url = await scAuthorizeUrl(host);
  if (!url) return NextResponse.redirect(new URL("/music?soundcloud=nocreds", `https://${host}`));
  return NextResponse.redirect(url);
}
