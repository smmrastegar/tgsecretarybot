// Daily productivity / reliability metrics for the continuous-
// improvement program (docs/IMPROVEMENT_LOOP.md).
//
// One snapshot per Tehran calendar day, computed from the tables the
// product already writes, stored in system_metrics_daily and reported
// to the owner as a rich message with 7-day trend arrows. Nothing here
// is sampled or estimated: every number is a count over that day.
import { faNum, escRich } from "./telegram-rich";
import {
  hasDb,
  listMetricsSnapshots,
  roadmapDigest,
  saveMetricsSnapshot,
  sql,
  type RoadmapItem,
} from "./db";

export type DailyMetrics = {
  day: string;
  from: string;
  to: string;
  work: {
    messages: number;
    messagesFromOwner: number;
    urgentAlerts: number;
    autoReplied: number;
    transcriptions: number;
    mediaDescribed: number;
    mediaArchived: number;
    ruleMatches: number;
    ruleForwarded: number;
    ruleForwardErrors: number;
    threadSummaries: number;
    groupSummaries: number;
    groupAnalyses: number;
    emailsIn: number;
    emailsOut: number;
    smsRelayed: number;
    extractedItems: number;
    extractedDone: number;
    boardEvents: number;
    noteWatchMatches: number;
    monitorEvents: number;
    linkDownloads: number;
    followUpPings: number;
    secretarySessions: number;
    ephemeralSent: number;
    webhookUpdates: number;
  };
  reliability: {
    errors: number;
    warnings: number;
    deploysOk: number;
    deploysFailed: number;
    mediaRoutingErrors: number;
    topErrorSources: Array<{ source: string; n: number }>;
  };
  cost: {
    aiCalls: number;
    aiTokens: number;
    aiCostUsd: number;
    hikerCostUsd: number;
  };
  improvement: {
    done: Array<{ id: number; kind: string; title: string; commitSha: string | null }>;
    openCount: number;
  };
  derived: {
    forwardSuccessRate: number | null;
    errorsPer100Messages: number | null;
    aiCostPerMessageUsd: number | null;
    stabilityScore: number;
  };
};

/** Tehran calendar day → UTC bounds. Iran has had no DST since 2022. */
export function tehranDayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+03:30`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return { from, to };
}

export function tehranToday(now = new Date()): string {
  return new Date(now.getTime() + 3.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function tehranYesterday(now = new Date()): string {
  return tehranToday(new Date(now.getTime() - 24 * 3600 * 1000));
}

type Row = Record<string, unknown>;
const n = (r: Row | undefined, k: string): number => {
  const v = r?.[k];
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export async function collectDailyMetrics(day: string): Promise<DailyMetrics> {
  if (!hasDb()) throw new Error("DATABASE_URL not set");
  const { from, to } = tehranDayBounds(day);
  const f = from.toISOString();
  const t = to.toISOString();
  const q = sql() as unknown as {
    query: (text: string, params?: unknown[]) => Promise<Row[]>;
  };
  // Each table is queried on its own so one missing table (fresh
  // install, renamed column) costs one metric, not the whole snapshot.
  const one = async (text: string): Promise<Row> =>
    (await q.query(text, [f, t]).catch(() => []))[0] ?? {};
  const many = async (text: string): Promise<Row[]> => q.query(text, [f, t]).catch(() => []);

  const msgs = await one(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE from_owner)::int AS from_owner,
           COUNT(*) FILTER (WHERE alerted)::int AS alerted,
           COUNT(*) FILTER (WHERE auto_replied)::int AS auto_replied,
           COUNT(*) FILTER (WHERE transcript_at >= $1 AND transcript_at < $2)::int AS transcribed,
           COUNT(*) FILTER (WHERE media_description_at >= $1 AND media_description_at < $2)::int AS described
      FROM messages_log WHERE created_at >= $1 AND created_at < $2`);
  const media = await one(`
    SELECT COUNT(*)::int AS archived,
           COUNT(*) FILTER (WHERE transcribed_at >= $1 AND transcribed_at < $2)::int AS transcribed
      FROM media_router_messages WHERE created_at >= $1 AND created_at < $2`);
  const routing = await one(`
    SELECT COUNT(*) FILTER (WHERE decision = 'error' OR error IS NOT NULL)::int AS errors
      FROM media_routing_log WHERE created_at >= $1 AND created_at < $2`);
  const rules = await one(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE forwarded_to IS NOT NULL AND array_length(forwarded_to,1) > 0)::int AS forwarded,
           COUNT(*) FILTER (WHERE forward_errors IS NOT NULL AND forward_errors::text NOT IN ('', '[]', '{}', 'null'))::int AS errors
      FROM message_rule_matches WHERE matched_at >= $1 AND matched_at < $2`);
  const ts = await one(`SELECT COUNT(*)::int AS n FROM thread_summaries WHERE created_at >= $1 AND created_at < $2`);
  const gs = await one(`SELECT COUNT(*)::int AS n FROM group_summaries WHERE created_at >= $1 AND created_at < $2`);
  const ga = await one(`SELECT COUNT(*)::int AS n FROM group_analytics WHERE created_at >= $1 AND created_at < $2`);
  const em = await one(`
    SELECT COUNT(*) FILTER (WHERE direction = 'in')::int AS inbound,
           COUNT(*) FILTER (WHERE direction = 'out')::int AS outbound
      FROM emails WHERE created_at >= $1 AND created_at < $2`);
  const sms = await one(`SELECT COUNT(*)::int AS n FROM sms_dedup WHERE first_sent_at >= $1 AND first_sent_at < $2`);
  const ex = await one(`
    SELECT COUNT(*)::int AS created,
           (SELECT COUNT(*)::int FROM extracted_items WHERE done_at >= $1 AND done_at < $2) AS done
      FROM extracted_items WHERE created_at >= $1 AND created_at < $2`);
  const gbe = await one(`SELECT COUNT(*)::int AS n FROM group_board_events WHERE created_at >= $1 AND created_at < $2`);
  const nw = await one(`SELECT COUNT(*)::int AS n FROM note_watch_matches WHERE created_at >= $1 AND created_at < $2`);
  const mon = await one(`SELECT COUNT(*)::int AS n FROM monitor_events WHERE detected_at >= $1 AND detected_at < $2`);
  const ldj = await one(`SELECT COUNT(*)::int AS n FROM link_download_jobs WHERE created_at >= $1 AND created_at < $2`);
  const fu = await one(`SELECT COUNT(*)::int AS n FROM chat_rules WHERE follow_up_last_ping_at >= $1 AND follow_up_last_ping_at < $2`);
  const ss = await one(`SELECT COUNT(*)::int AS n FROM secretary_sessions WHERE created_at >= $1 AND created_at < $2`);
  const eph = await one(`SELECT COUNT(*)::int AS n FROM ephemeral_messages WHERE created_at >= $1 AND created_at < $2`);
  const upd = await one(`SELECT COUNT(*)::int AS n FROM processed_updates WHERE processed_at >= $1 AND processed_at < $2`);
  const errs = await one(`
    SELECT COUNT(*) FILTER (WHERE level = 'error')::int AS errors,
           COUNT(*) FILTER (WHERE level = 'warn')::int AS warnings,
           COUNT(*) FILTER (WHERE source LIKE 'deploy%' AND level = 'info' AND message LIKE 'deploy OK%')::int AS deploys_ok,
           COUNT(*) FILTER (WHERE source LIKE 'deploy%' AND level = 'error' AND message LIKE 'tests failed%')::int AS deploys_failed
      FROM system_errors WHERE created_at >= $1 AND created_at < $2`);
  const topErr = await many(`
    SELECT source, COUNT(*)::int AS n FROM system_errors
     WHERE created_at >= $1 AND created_at < $2 AND level = 'error'
     GROUP BY source ORDER BY n DESC LIMIT 5`);
  const ai = await one(`
    SELECT COUNT(*)::int AS calls, COALESCE(SUM(total_tokens),0)::bigint AS tokens,
           COALESCE(SUM(cost_usd),0)::float AS cost
      FROM ai_usage WHERE created_at >= $1 AND created_at < $2`);
  const hk = await one(`SELECT COALESCE(SUM(cost_usd),0)::float AS cost FROM hikerapi_usage WHERE called_at >= $1 AND called_at < $2`);
  const digest = await roadmapDigest(from, to, day).catch(() => ({
    done: [] as RoadmapItem[],
    planned: [] as RoadmapItem[],
    inProgress: [] as RoadmapItem[],
    openCount: 0,
  }));

  const work = {
    messages: n(msgs, "total"),
    messagesFromOwner: n(msgs, "from_owner"),
    urgentAlerts: n(msgs, "alerted"),
    autoReplied: n(msgs, "auto_replied"),
    transcriptions: n(msgs, "transcribed") + n(media, "transcribed"),
    mediaDescribed: n(msgs, "described"),
    mediaArchived: n(media, "archived"),
    ruleMatches: n(rules, "total"),
    ruleForwarded: n(rules, "forwarded"),
    ruleForwardErrors: n(rules, "errors"),
    threadSummaries: n(ts, "n"),
    groupSummaries: n(gs, "n"),
    groupAnalyses: n(ga, "n"),
    emailsIn: n(em, "inbound"),
    emailsOut: n(em, "outbound"),
    smsRelayed: n(sms, "n"),
    extractedItems: n(ex, "created"),
    extractedDone: n(ex, "done"),
    boardEvents: n(gbe, "n"),
    noteWatchMatches: n(nw, "n"),
    monitorEvents: n(mon, "n"),
    linkDownloads: n(ldj, "n"),
    followUpPings: n(fu, "n"),
    secretarySessions: n(ss, "n"),
    ephemeralSent: n(eph, "n"),
    webhookUpdates: n(upd, "n"),
  };
  const reliability = {
    errors: n(errs, "errors"),
    warnings: n(errs, "warnings"),
    deploysOk: n(errs, "deploys_ok"),
    deploysFailed: n(errs, "deploys_failed"),
    mediaRoutingErrors: n(routing, "errors"),
    topErrorSources: topErr.map((r) => ({ source: String(r.source ?? "?"), n: n(r, "n") })),
  };
  const cost = {
    aiCalls: n(ai, "calls"),
    aiTokens: n(ai, "tokens"),
    aiCostUsd: Math.round(n(ai, "cost") * 10000) / 10000,
    hikerCostUsd: Math.round(n(hk, "cost") * 10000) / 10000,
  };
  const improvement = {
    done: digest.done.map((d) => ({ id: d.id, kind: d.kind, title: d.title, commitSha: d.commitSha })),
    openCount: digest.openCount,
  };
  const derived = {
    forwardSuccessRate:
      work.ruleMatches > 0 ? Math.round((work.ruleForwarded / work.ruleMatches) * 1000) / 10 : null,
    errorsPer100Messages:
      work.messages > 0 ? Math.round((reliability.errors / work.messages) * 10000) / 100 : null,
    aiCostPerMessageUsd:
      work.messages > 0 ? Math.round((cost.aiCostUsd / work.messages) * 100000) / 100000 : null,
    stabilityScore: stabilityScore(reliability, work),
  };
  return { day, from: f, to: t, work, reliability, cost, improvement, derived };
}

// 0-100. Deliberately simple and explainable: errors and failed
// deliveries cost points, nothing earns them back. The number is for
// spotting a bad day at a glance, not for ranking.
export function stabilityScore(
  r: { errors: number; deploysFailed: number; mediaRoutingErrors: number },
  w: { ruleForwardErrors: number },
): number {
  let s = 100;
  s -= Math.min(40, r.errors * 2);
  s -= Math.min(20, w.ruleForwardErrors * 5);
  s -= Math.min(10, r.mediaRoutingErrors * 2);
  s -= r.deploysFailed > 0 ? 20 : 0;
  return Math.max(0, s);
}

export async function snapshotDay(day: string): Promise<DailyMetrics> {
  const m = await collectDailyMetrics(day);
  await saveMetricsSnapshot(day, m);
  return m;
}

/** Average of a numeric path over the snapshots strictly before `day`. */
function avgPath(
  snaps: Array<{ day: string; metrics: Record<string, unknown> }>,
  day: string,
  path: string[],
  windowDays = 7,
): number | null {
  const prior = snaps.filter((s) => s.day < day).slice(0, windowDays);
  if (prior.length === 0) return null;
  const vals = prior
    .map((s) => {
      let cur: unknown = s.metrics;
      for (const k of path) cur = (cur as Record<string, unknown> | undefined)?.[k];
      return typeof cur === "number" ? cur : Number(cur);
    })
    .filter((v) => Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function trend(cur: number, avg: number | null, higherIsBetter: boolean): string {
  if (avg == null) return "—";
  const diff = cur - avg;
  const rel = avg === 0 ? (cur === 0 ? 0 : 1) : diff / avg;
  if (Math.abs(rel) < 0.1) return "➡️";
  const up = diff > 0;
  const good = up === higherIsBetter;
  return `${up ? "⬆️" : "⬇️"}${good ? "" : "⚠️"}`;
}

const fmtAvg = (v: number | null): string => (v == null ? "—" : faNum(Math.round(v * 10) / 10));

/** Rich-HTML daily report: yesterday's numbers with 7-day trend. */
export async function buildDailyReportHtml(m: DailyMetrics, opts?: {
  planned?: RoadmapItem[];
  inProgress?: RoadmapItem[];
}): Promise<string> {
  const snaps = await listMetricsSnapshots(14).catch(() => []);
  const row = (label: string, path: string[], cur: number, higherIsBetter = true, fmt: (v: number) => string = (v) => faNum(v)) =>
    `<tr><td>${label}</td><td>${fmt(cur)}</td><td>${fmtAvg(avgPath(snaps, m.day, path))}</td><td>${trend(cur, avgPath(snaps, m.day, path), higherIsBetter)}</td></tr>`;
  const head = `<tr><th>شاخص</th><th>دیروز</th><th>میانگین ۷ روز</th><th>روند</th></tr>`;
  const w = m.work;
  const r = m.reliability;
  const c = m.cost;
  const usd = (v: number) => `$${v.toFixed(3)}`;
  const parts: string[] = [];
  const scoreEmoji = m.derived.stabilityScore >= 90 ? "🟢" : m.derived.stabilityScore >= 70 ? "🟡" : "🔴";
  parts.push(`<h4>📈 گزارش بهره‌وری روزانه — ${escRich(m.day)}</h4>`);
  parts.push(
    `<p>${scoreEmoji} <b>امتیاز پایداری: ${faNum(m.derived.stabilityScore)}/۱۰۰</b>` +
      (m.derived.forwardSuccessRate != null ? ` · نرخ موفقیت فوروارد قوانین ${faNum(m.derived.forwardSuccessRate)}٪` : "") +
      (m.derived.errorsPer100Messages != null ? ` · خطا به ازای هر ۱۰۰ پیام ${faNum(m.derived.errorsPer100Messages)}` : "") +
      `</p>`,
  );
  parts.push(`<h5>🛠 کارکرد سیستم</h5><table striped compact>${head}`);
  parts.push(row("پیام‌های پردازش‌شده", ["work", "messages"], w.messages));
  parts.push(row("آپدیت‌های وب‌هوک", ["work", "webhookUpdates"], w.webhookUpdates));
  parts.push(row("هشدار فوری", ["work", "urgentAlerts"], w.urgentAlerts));
  parts.push(row("پاسخ خودکار", ["work", "autoReplied"], w.autoReplied));
  parts.push(row("پیاده‌سازی صدا", ["work", "transcriptions"], w.transcriptions));
  parts.push(row("مدیای آرشیوشده", ["work", "mediaArchived"], w.mediaArchived));
  parts.push(row("تطبیق قانون", ["work", "ruleMatches"], w.ruleMatches));
  parts.push(row("فوروارد قانون", ["work", "ruleForwarded"], w.ruleForwarded));
  parts.push(row("خلاصه‌ی گفتگو", ["work", "threadSummaries"], w.threadSummaries));
  parts.push(row("خلاصه/تحلیل گروه", ["work", "groupSummaries"], w.groupSummaries + w.groupAnalyses));
  parts.push(row("ایمیل (ورودی/خروجی)", ["work", "emailsIn"], w.emailsIn, true, (v) => `${faNum(v)}/${faNum(w.emailsOut)}`));
  parts.push(row("پیامک منتقل‌شده", ["work", "smsRelayed"], w.smsRelayed));
  parts.push(row("کار/یادآور استخراج‌شده", ["work", "extractedItems"], w.extractedItems));
  parts.push(row("رویداد برد تسک", ["work", "boardEvents"], w.boardEvents));
  parts.push(row("تطبیق واچ‌لیست", ["work", "noteWatchMatches"], w.noteWatchMatches));
  parts.push(row("رویداد مانیتورینگ", ["work", "monitorEvents"], w.monitorEvents));
  parts.push(row("یادآور پیگیری", ["work", "followUpPings"], w.followUpPings));
  parts.push(`</table>`);
  parts.push(`<h5>🩺 پایداری</h5><table striped compact>${head}`);
  parts.push(row("خطاها", ["reliability", "errors"], r.errors, false));
  parts.push(row("هشدارها", ["reliability", "warnings"], r.warnings, false));
  parts.push(row("خطای فوروارد قانون", ["work", "ruleForwardErrors"], w.ruleForwardErrors, false));
  parts.push(row("خطای مسیریابی مدیا", ["reliability", "mediaRoutingErrors"], r.mediaRoutingErrors, false));
  parts.push(row("دیپلوی موفق/ناموفق", ["reliability", "deploysOk"], r.deploysOk, true, (v) => `${faNum(v)}/${faNum(r.deploysFailed)}`));
  parts.push(`</table>`);
  if (r.topErrorSources.length > 0) {
    parts.push(
      `<p>منابع خطا: ${r.topErrorSources.map((s) => `<code>${escRich(s.source)}</code> ×${faNum(s.n)}`).join("، ")}</p>`,
    );
  }
  parts.push(`<h5>💵 هزینه</h5><table striped compact>${head}`);
  parts.push(row("فراخوانی AI", ["cost", "aiCalls"], c.aiCalls, false));
  parts.push(row("هزینه‌ی AI", ["cost", "aiCostUsd"], c.aiCostUsd, false, usd));
  parts.push(row("هزینه‌ی HikerAPI", ["cost", "hikerCostUsd"], c.hikerCostUsd, false, usd));
  parts.push(`</table>`);
  parts.push(`<h5>🚀 بهبود روزانه</h5>`);
  const kindEmoji: Record<string, string> = { feature: "✨", fix: "🐛", improvement: "🔧", chore: "🧹" };
  if (m.improvement.done.length > 0) {
    parts.push(`<p><b>دیروز تحویل شد:</b></p><ul>${m.improvement.done
      .map((d) => `<li><input type="checkbox" checked>${kindEmoji[d.kind] ?? ""} ${escRich(d.title)}${d.commitSha ? ` <code>${escRich(d.commitSha.slice(0, 7))}</code>` : ""}</li>`)
      .join("")}</ul>`);
  } else {
    parts.push(`<p>دیروز هیچ آیتمی از نقشه‌ی راه بسته نشد.</p>`);
  }
  const todo = [...(opts?.inProgress ?? []), ...(opts?.planned ?? [])].slice(0, 8);
  if (todo.length > 0) {
    parts.push(`<p><b>برنامه‌ی امروز:</b></p><ul>${todo
      .map((d) => `<li><input type="checkbox">${kindEmoji[d.kind] ?? ""} ${escRich(d.title)}${d.status === "in_progress" ? " <i>(در حال انجام)</i>" : ""}</li>`)
      .join("")}</ul>`);
  } else {
    parts.push(`<p>⚠️ برای امروز چیزی برنامه‌ریزی نشده. یه آیتم از نقشه‌ی راه رو «برنامه‌ریزی‌شده» کن.</p>`);
  }
  parts.push(`<footer>${faNum(m.improvement.openCount)} آیتم باز در نقشه‌ی راه · /roadmap</footer>`);
  return parts.join("");
}
