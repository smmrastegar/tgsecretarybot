import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { hasDb, roadmapDigest } from "@/lib/db";
import { buildDailyReportHtml, snapshotDay, tehranDayBounds, tehranToday, tehranYesterday } from "@/lib/metrics";
import { reportError, reportInfo } from "@/lib/report";
import { getSettings } from "@/lib/settings";
import { sendRichMessage } from "@/lib/telegram-rich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

// Runs shortly after Tehran midnight (deploy/crontab): snapshots the
// day that just ended, then posts the productivity report with the
// roadmap plan for the new day. ?day=YYYY-MM-DD recomputes a specific
// day (no report unless &send=1); ?backfill=N snapshots the last N days
// silently so trend lines exist from the first report.
async function run(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const url = new URL(request.url);
  const backfill = Number(url.searchParams.get("backfill") ?? "0");
  if (backfill > 0) {
    const days: string[] = [];
    for (let i = 1; i <= Math.min(60, backfill); i++) {
      days.push(tehranToday(new Date(Date.now() - i * 24 * 3600 * 1000)));
    }
    for (const d of days) await snapshotDay(d);
    return NextResponse.json({ ok: true, backfilled: days });
  }
  const explicit = url.searchParams.get("day");
  const day = explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit) ? explicit : tehranYesterday();
  const send = explicit ? url.searchParams.get("send") === "1" : true;
  try {
    const m = await snapshotDay(day);
    let sent = false;
    const notify = Number((await getSettings()).ownerNotifyChatId);
    if (send && Number.isFinite(notify) && notify !== 0) {
      const today = tehranToday();
      const { from, to } = tehranDayBounds(today);
      const digest = await roadmapDigest(from, to, today);
      const html = await buildDailyReportHtml(m, {
        planned: digest.planned,
        inProgress: digest.inProgress,
      });
      await sendRichMessage({ chatId: notify, html, silent: true });
      sent = true;
    }
    reportInfo("metrics", `daily snapshot ${day}: score ${m.derived.stabilityScore}, ${m.work.messages} messages, ${m.reliability.errors} errors`);
    return NextResponse.json({ ok: true, day, sent, metrics: m });
  } catch (err) {
    reportError("cron:metrics-daily", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return run(request);
}
export async function POST(request: Request): Promise<NextResponse> {
  return run(request);
}
