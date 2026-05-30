import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: s });
}
