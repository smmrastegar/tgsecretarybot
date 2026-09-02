import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getSecretaries } from "@/lib/secretaries";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const settings = await getSettings();
  const list = getSecretaries(settings);
  return NextResponse.json({ secretaries: list });
}
