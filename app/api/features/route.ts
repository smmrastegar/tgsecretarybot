import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { getAllSettings } from "@/lib/db";
import { featureUsage, usageSummary } from "@/lib/feature-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live usage of every dashboard feature (counts only) — drives the Settings hub.
export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const [rows, settings] = await Promise.all([featureUsage(), getAllSettings()]);
  // Things that need the owner now (shown as a banner on the Settings hub).
  const alerts: Array<{ id: string; text: string; href: string }> = [];
  if (Number(settings.openrouterOutUntil || 0) > Date.now()) alerts.push({ id: "openrouter", text: "اعتبار OpenRouter تمام شده؛ طبقه‌بندی پیام، قانون‌ها و خلاصه‌ها متوقف‌اند", href: "/costs" });
  return NextResponse.json({ features: rows, summary: usageSummary(rows), alerts });
}
