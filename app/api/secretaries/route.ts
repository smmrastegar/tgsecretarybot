import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSecretaries } from "@/lib/secretaries";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const settings = await getSettings();
  const list = getSecretaries(settings);
  return NextResponse.json({ secretaries: list });
}
