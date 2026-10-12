"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { PageTitle } from "@/components/Card";
import DebugModeToggle from "@/components/DebugModeToggle";
import Section, { Pill } from "@/components/ui/Section";
import { FEATURES, FEATURE_GROUPS, type FeatureUsage } from "@/lib/features-meta";

// The hub of every tool. Rows are grouped by how often they are needed, searchable, and each one shows live
// status from its own data (how much it holds, how recently it did anything) so an unused or silently
// stalled feature is visible here instead of being forgotten.
const ADMIN = { id: "admin", group: "system" as const, emoji: "🛡", label: "مدیریت", href: "/admin", desc: "tenants، کاربران ادمین، کلیدهای API", unit: "" };

const GROUP_ICON: Record<string, string> = { daily: "⭐", ai: "🧠", channels: "📨", monitor: "🛰", system: "⚙️" };

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).getTime()) / 86_400_000);
  return d <= 0 ? "امروز" : d === 1 ? "دیروز" : `${fa(d)} روز پیش`;
};

type Resp = { features: FeatureUsage[]; summary: { measurable: number; active: number; quiet: number; dormant: number; empty: number; usedPct: number }; alerts: Array<{ id: string; text: string; href: string }> };

const DOT: Record<string, string> = { active: "bg-emerald-400", quiet: "bg-amber-400", dormant: "bg-rose-400/80", empty: "bg-[var(--color-border)]", configured: "bg-sky-400/70" };

function stat(unit: string, u: FeatureUsage | undefined): string {
  if (!u) return "";
  if (u.state === "empty") return "هنوز چیزی ندارد";
  const parts = [`${fa(u.total.toLocaleString("en-US"))} ${unit}`];
  if (u.state === "active" || u.state === "quiet") parts.push(u.n7 > 0 ? `${fa(u.n7.toLocaleString("en-US"))} در ۷ روز اخیر` : `${fa(u.n30)} در ۳۰ روز اخیر`);
  if (u.state === "dormant") parts.push(`آخرین فعالیت ${ago(u.last) ?? "مدت‌ها پیش"}`);
  if (u.extra) parts.push(u.extra.replace(/[0-9]+/g, (n) => fa(n)));
  return parts.join(" · ");
}

export default function SettingsHubPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    void fetch("/api/admin/me").then((r) => (r.ok ? r.json() : null)).then((d: { admin?: boolean } | null) => { if (!off) setIsAdmin(!!d?.admin); }).catch(() => {});
    void fetch("/api/features", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: Resp | null) => { if (!off && d) setData(d); }).catch(() => {});
    return () => { off = true; };
  }, []);

  const usage = useMemo(() => new Map((data?.features ?? []).map((f) => [f.id, f])), [data]);
  const all = useMemo(() => (isAdmin ? [...FEATURES, ADMIN] : FEATURES), [isAdmin]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((f) => `${f.label} ${f.desc} ${f.href}`.toLowerCase().includes(needle)) : all;
  const idle = shown.filter((f) => { const u = usage.get(f.id); return u && (u.state === "dormant" || u.state === "empty"); });

  const Row = ({ f }: { f: (typeof all)[number] }) => {
    const u = usage.get(f.id);
    return (
      <Link href={f.href} className="flex items-center gap-3 px-4 min-h-16 py-2.5 border-t first:border-t-0 border-[var(--color-border)] active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]">
        <span aria-hidden className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--color-surface-2)] text-xl shrink-0">{f.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{f.label}</span>
            {u && <span aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${DOT[u.state]}`} title={u.state} />}
          </span>
          <span className="block text-[11px] leading-5 text-[var(--color-text-dim)] line-clamp-2">{u ? stat(f.unit, u) || f.desc : f.desc}</span>
        </span>
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--color-text-dim)] rotate-90"><path d="m6 9 6 6 6-6" /></svg>
      </Link>
    );
  };

  return (
    <Shell>
      <PageTitle title="تنظیمات" subtitle="همهٔ ابزارها، با وضعیت زنده‌ی هرکدام" />

      {data?.alerts.map((a) => (
        <Link key={a.id} href={a.href} className="mb-3 flex items-center gap-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span aria-hidden>⚠️</span><span className="flex-1 leading-6">{a.text}</span><span aria-hidden>‹</span>
        </Link>
      ))}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی ابزار…" aria-label="جستجوی ابزار" type="search"
        className="w-full min-h-11 mb-3 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl px-4" />

      {data && !needle && (
        <div className="mb-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{fa(data.summary.usedPct)}٪</span>
            <span className="text-xs text-[var(--color-text-dim)]">قابلیت‌ها در ۳۰ روز اخیر کار کرده‌اند ({fa(data.summary.active + data.summary.quiet)} از {fa(data.summary.measurable)})</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden"><div className="h-full bg-emerald-400" style={{ width: `${data.summary.usedPct}%` }} /></div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <Pill tone="ok">{fa(data.summary.active)} فعال</Pill>
            <Pill tone="warn">{fa(data.summary.quiet)} کم‌کار</Pill>
            <Pill tone="bad">{fa(data.summary.dormant)} خوابیده</Pill>
            <Pill>{fa(data.summary.empty)} خالی</Pill>
          </div>
        </div>
      )}

      {idle.length > 0 && !needle && (
        <Section icon="💤" title="بی‌استفاده یا خوابیده" summary="تصمیم بگیر: راه‌اندازی، تعمیر یا کنار گذاشتن" badge={<Pill tone="warn">{fa(idle.length)}</Pill>}>
          <div className="-mx-4 -mb-4">{idle.map((f) => <Row key={f.id} f={f} />)}</div>
        </Section>
      )}

      {FEATURE_GROUPS.map((g) => {
        const items = shown.filter((f) => f.group === g.id);
        if (items.length === 0) return null;
        return (
          <Section key={g.id} icon={GROUP_ICON[g.id]} title={g.label} summary={g.hint} defaultOpen={g.id === "daily" || !!needle} open={needle ? true : undefined}
            badge={<Pill>{fa(items.length)}</Pill>}>
            <div className="-mx-4 -mb-4">{items.map((f) => <Row key={f.id} f={f} />)}</div>
          </Section>
        );
      })}
      {shown.length === 0 && <p className="text-sm text-[var(--color-text-dim)] px-1">چیزی پیدا نشد.</p>}

      <div className="mt-4"><DebugModeToggle /></div>
    </Shell>
  );
}
