import { hasDb, sql } from "@/lib/db";
import { FEATURES, type FeatureState, type FeatureUsage } from "@/lib/features-meta";

// One list of every dashboard feature and how much it is really used, measured from its own data (rows
// created in the last 7 / 30 days, last activity). It feeds the Settings hub (live status on each row),
// the weekly "dormant features" review and the daily routine — so a feature nobody uses, or that silently
// stopped producing, is visible instead of rotting. Counts only; no content.
/** How each feature is measured: table + timestamp column the activity is counted on (no column = configuration only). */
type Spec = { table: string; col?: string; where?: string; extra?: string };
const SPECS: Record<string, Spec> = {
  "music": { table: "music_tracks", col: "created_at", where: "status = 'ready'" },
  "messages": { table: "messages_log", col: "created_at" },
  "urgent": { table: "messages_log", col: "created_at", where: "urgent", extra: "SELECT 'رسیدگی‌شده: ' || COUNT(*) FILTER (WHERE handled_at IS NOT NULL) || ' از ' || COUNT(*) AS x FROM messages_log WHERE urgent AND created_at > NOW() - INTERVAL '30 days'" },
  "chats": { table: "chat_rules" },
  "reminders": { table: "extracted_items", col: "created_at", where: "kind IN ('reminder','task','event','deadline')", extra: "SELECT 'انجام‌شده: ' || COUNT(*) FILTER (WHERE done_at IS NOT NULL) || ' از ' || COUNT(*) AS x FROM extracted_items WHERE kind IN ('reminder','task','event','deadline')" },
  "notes": { table: "chat_notes", col: "created_at", where: "archived_at IS NULL" },
  "otp": { table: "sms_dedup", col: "last_seen_at" },
  "rules": { table: "message_rule_matches", col: "matched_at" },
  "note-watch": { table: "note_watch_matches", col: "created_at", extra: "SELECT 'تأییدشده: ' || COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) || ' · غلط: ' || COUNT(*) FILTER (WHERE reported_wrong_at IS NOT NULL) AS x FROM note_watch_matches" },
  "profiles": { table: "chat_profiles" },
  "functions": { table: "chat_function_roles" },
  "knowledge": { table: "knowledge_entries" },
  "ask": { table: "ask_queries", col: "created_at" },
  "follow-up": { table: "chat_profiles", where: "follow_up_enabled" },
  "sms-hook": { table: "sms_webhooks", col: "last_used_at" },
  "sms-block": { table: "sms_block_rules", col: "last_hit_at" },
  "code-feeds": { table: "code_feeds", col: "last_access_at" },
  "emails": { table: "emails", col: "created_at" },
  "relays": { table: "secretary_message_links", col: "created_at" },
  "monitored": { table: "monitor_events", col: "detected_at" },
  "site-monitors": { table: "site_monitors", col: "last_run_at" },
  "link-dl": { table: "link_download_jobs", col: "created_at" },
  "media-routing": { table: "media_routing_log", col: "created_at" },
  "groups": { table: "group_analytics", col: "created_at" },
  "group-summaries": { table: "group_summaries", col: "created_at" },
  "settings": { table: "settings" },
  "roadmap": { table: "improvement_items", col: "updated_at" },
  "costs": { table: "ai_usage", col: "created_at" },
  "audit": { table: "system_errors", col: "created_at" },
  "health": { table: "business_connections" },
  "debug-log": { table: "telegram_debug_log", col: "received_at" },
};

function stateOf(def: Spec, total: number, n7: number, n30: number): FeatureState {
  if (total === 0) return "empty";
  if (!def.col) return "configured"; // configuration only: set up, but there is no activity to measure
  if (n7 > 0) return "active";
  if (n30 > 0) return "quiet";
  return "dormant";
}

let cache: { at: number; rows: FeatureUsage[] } | null = null;

/** Usage of every feature (cached 60 s). Each feature is measured on its own, so one failing table never hides the rest. */
export async function featureUsage(force = false): Promise<FeatureUsage[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.rows;
  if (!hasDb()) return [];
  const q = sql() as unknown as { query: (t: string, p?: unknown[]) => Promise<Array<Record<string, unknown>>> };
  const rows = await Promise.all(FEATURES.map(async (meta): Promise<FeatureUsage> => {
    const f = SPECS[meta.id]!;
    // table / col / where come from the constant list above, never from a request
    const w = f.where ? `WHERE ${f.where}` : "";
    const act = f.col
      ? `, COUNT(*) FILTER (WHERE ${f.col} > NOW() - INTERVAL '7 days')::int AS n7, COUNT(*) FILTER (WHERE ${f.col} > NOW() - INTERVAL '30 days')::int AS n30, MAX(${f.col})::text AS last`
      : `, 0 AS n7, 0 AS n30, NULL AS last`;
    try {
      const r = (await q.query(`SELECT COUNT(*)::int AS total${act} FROM ${f.table} ${w}`))[0] ?? {};
      const total = Number(r.total ?? 0), n7 = Number(r.n7 ?? 0), n30 = Number(r.n30 ?? 0);
      let extra: string | undefined;
      if (f.extra) extra = String(((await q.query(f.extra).catch(() => [] as Array<Record<string, unknown>>))[0] ?? {}).x ?? "") || undefined;
      return { id: meta.id, total, n7, n30, last: r.last ? String(r.last) : null, state: stateOf(f, total, n7, n30), extra };
    } catch (e) {
      return { id: meta.id, total: 0, n7: 0, n30: 0, last: null, state: "empty", error: e instanceof Error ? e.message.slice(0, 120) : "error" };
    }
  }));
  cache = { at: Date.now(), rows };
  return rows;
}

/** Share of features in each state. The percentage covers only features whose activity can be measured. */
export function usageSummary(rows: FeatureUsage[]): { total: number; measurable: number; active: number; quiet: number; dormant: number; empty: number; configured: number; usedPct: number } {
  const c = { active: 0, quiet: 0, dormant: 0, empty: 0, configured: 0 };
  for (const r of rows) c[r.state]++;
  const measurable = c.active + c.quiet + c.dormant + c.empty;
  return { total: rows.length, measurable, ...c, usedPct: measurable ? Math.round(((c.active + c.quiet) / measurable) * 100) : 0 };
}
