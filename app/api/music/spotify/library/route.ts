import { NextResponse } from "next/server";
import { getCurrentSession, requireSessionOr401 } from "@/lib/auth";
import { pinState } from "@/lib/pin-session";
import { listMyPlaylists } from "@/lib/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const account = Number(new URL(request.url).searchParams.get("account"));
  const st = await pinState(await getCurrentSession());
  if (st.scope && !st.scope.ids.includes(account)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await listMyPlaylists(account));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
