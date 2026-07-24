import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getBot } from "@/lib/bot";
import { hasDb, sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getBudgetState } from "@/lib/hikerapi-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

// Daily one-shot health digest, sent SILENTLY to the owner. Covers the
// signals that have actually bitten us: budget level, monitored-account
// errors, runtime error volume, rule forwards, and stuck album buffers.
async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const settings = await getSettings();
  const notifyChat = Number(settings.ownerNotifyChatId);
  if (!Number.isFinite(notifyChat) || notifyChat === 0) {
    return NextResponse.json({ ok: true, skipped: "ownerNotifyChatId not set" });
  }

  const one = async (q: Promise<Array<Record<string, unknown>>>): Promise<Record<string, unknown>> =>
    (await q.catch(() => []))[0] ?? {};

  const msg24 = await one(sql()`
    SELECT COUNT(*)::int AS n FROM messages_log WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const errs24 = await one(sql()`
    SELECT COUNT(*)::int AS n FROM system_errors WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const monErr = await one(sql()`
    SELECT COUNT(*)::int AS n FROM monitored_accounts WHERE enabled AND last_error IS NOT NULL AND last_error <> ''`);
  const matches24 = await one(sql()`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE forwarded_to IS NOT NULL AND array_length(forwarded_to,1) > 0)::int AS forwarded
      FROM message_rule_matches WHERE matched_at > NOW() - INTERVAL '24 hours'`);
  const stuckAlbums = await one(sql()`
    SELECT COUNT(DISTINCT group_key)::int AS n FROM mirror_album_buffer
     WHERE created_at < NOW() - INTERVAL '10 minutes'`);
  const budget = await getBudgetState(1).catch(() => null);

  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const lines: string[] = ["🩺 گزارش روزانه‌ی سلامت سیستم", ""];
  if (budget && budget.budgetUsd > 0) {
    const pct = Math.round((budget.spentUsd / budget.budgetUsd) * 100);
    lines.push(
      `${pct >= 90 ? "🔴" : pct >= 70 ? "🟡" : "🟢"} بودجه‌ی HikerAPI: $${budget.spentUsd.toFixed(2)} از $${budget.budgetUsd.toFixed(2)} (${pct}٪)`,
    );
  }
  lines.push(
    `${num(monErr.n) > 0 ? "🟡" : "🟢"} اکانت‌های پایش با خطا: ${num(monErr.n)}`,
    `${num(errs24.n) > 0 ? "🟡" : "🟢"} خطاهای سیستم (۲۴س): ${num(errs24.n)}`,
    `📨 پیام‌های پردازش‌شده (۲۴س): ${num(msg24.n)}`,
    `📐 تطبیق قانون (۲۴س): ${num(matches24.total)} — ارسال‌شده: ${num(matches24.forwarded)}`,
  );
  if (num(stuckAlbums.n) > 0) {
    lines.push(`🔴 آلبوم‌های گیرکرده در بافر آینه: ${num(stuckAlbums.n)}`);
  }

  const bot = getBot();
  await bot.api.sendMessage(notifyChat, lines.join("\n"), {
    disable_notification: true,
  });
  return NextResponse.json({ ok: true, sent: true });
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
