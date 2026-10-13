import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hasDb, sql } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getBudgetState } from "@/lib/hikerapi-budget";
import { faNum, sendRichMessage } from "@/lib/telegram-rich";
import { addRoadmapItem, listRoadmap } from "@/lib/db";

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

  // Daily triage of what broke: the same error seen again and again becomes a roadmap item (once), and the top ones are listed below.
  const top = (await sql()`
    SELECT source, left(message, 140) AS msg, COUNT(*)::int AS n
      FROM system_errors
     WHERE created_at > NOW() - INTERVAL '24 hours' AND level = 'error'
     GROUP BY source, left(message, 140) ORDER BY n DESC LIMIT 5`.catch(() => [])) as Array<{ source: string; msg: string; n: number }>;
  const triaged: string[] = [];
  try {
    const open = new Set((await listRoadmap({ limit: 500 })).filter((i) => i.status !== "done" && i.status !== "dropped").map((i) => i.title));
    for (const e of top) {
      if (e.n < 3) continue;
      const title = `Fix recurring ${e.source} error: ${e.msg}`.slice(0, 200);
      if (open.has(title)) continue;
      await addRoadmapItem({ kind: "fix", title, details: `Seen ${e.n} times in the last 24 hours (System Log, source "${e.source}").`, priority: e.source === "client" ? 1 : 2, source: "auto-triage", createdBy: "health-report" });
      triaged.push(title);
    }
  } catch { /* triage is best effort */ }

  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // Rich message: one status table, then a short note list. The
  // classic fallback flattens the table to "k | v" rows.
  const rows: Array<[string, string, string]> = [];
  if (budget && budget.budgetUsd > 0) {
    const pct = Math.round((budget.spentUsd / budget.budgetUsd) * 100);
    rows.push([
      pct >= 90 ? "🔴" : pct >= 70 ? "🟡" : "🟢",
      "بودجه‌ی HikerAPI",
      `$${budget.spentUsd.toFixed(2)} از $${budget.budgetUsd.toFixed(2)} (${faNum(pct)}٪)`,
    ]);
  }
  rows.push(
    [num(monErr.n) > 0 ? "🟡" : "🟢", "اکانت‌های پایش با خطا", faNum(num(monErr.n))],
    [num(errs24.n) > 0 ? "🟡" : "🟢", "خطاهای سیستم (۲۴ ساعت)", faNum(num(errs24.n))],
    ["📨", "پیام‌های پردازش‌شده (۲۴ ساعت)", faNum(num(msg24.n))],
    [
      "📐",
      "تطبیق قانون (۲۴ ساعت)",
      `${faNum(num(matches24.total))} — ارسال‌شده: ${faNum(num(matches24.forwarded))}`,
    ],
  );
  for (const e of top.slice(0, 3)) rows.push([e.n >= 3 ? "🔴" : "🟡", `${e.source}: ${e.msg.replace(/[<>&]/g, " ").slice(0, 70)}`, `×${faNum(e.n)}`]);
  if (triaged.length > 0) rows.push(["📝", "به نقشه‌ی راه اضافه شد", faNum(triaged.length)]);
  if (num(stuckAlbums.n) > 0) {
    rows.push(["🔴", "آلبوم‌های گیرکرده در بافر آینه", faNum(num(stuckAlbums.n))]);
  }
  const worst = rows.some((r) => r[0] === "🔴") ? "🔴" : rows.some((r) => r[0] === "🟡") ? "🟡" : "🟢";
  const html =
    `<h4>🩺 گزارش روزانه‌ی سلامت سیستم ${worst}</h4>` +
    `<table striped compact>` +
    `<tr><th></th><th>شاخص</th><th>مقدار</th></tr>` +
    rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("") +
    `</table>` +
    `<footer>${new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran", hour12: false })}</footer>`;

  await sendRichMessage({ chatId: notifyChat, html, silent: true });
  return NextResponse.json({ ok: true, sent: true });
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
