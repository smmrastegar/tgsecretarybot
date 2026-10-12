"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import Section from "@/components/ui/Section";
import { Chip, fa, inputCls } from "@/components/rule-editor/shared";

import { relTime, truncate } from "@/lib/format";

type Rule = {
  id: number;
  name: string;
  description: string;
  forwardFormat: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  recipientCount: number;
};
type RecentMatch = {
  id: number;
  ruleId: number;
  ruleName: string;
  messageLogId: number;
  formattedText: string | null;
  forwardedTo: number[];
  matchedAt: string;
  messageText: string;
  senderName: string;
  chatId: number;
};

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [recent, setRecent] = useState<RecentMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [format, setFormat] = useState("");
  const [q, setQ] = useState("");

  const RECENT_PAGE = 10;
  const [hasMoreRecent, setHasMoreRecent] = useState(true);
  const [loadingMoreRecent, setLoadingMoreRecent] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // Only the first load shows the full-page spinner; reloads after a toggle / create refresh the list in place.
  const loadedOnce = useRef(false);
  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    setRecentError(null);
    setLoadError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/rules"),
        fetch(`/api/rules/recent-matches?limit=${RECENT_PAGE}&offset=0`),
      ]);
      if (r1.ok) {
        const j = (await r1.json()) as { rules: Rule[] };
        setRules(j.rules ?? []);
        loadedOnce.current = true;
      } else {
        setLoadError(`خطا ${r1.status} — لود rule‌ها شکست خورد`);
      }
      if (r2.ok) {
        const j = (await r2.json()) as { matches: RecentMatch[] };
        setRecent(j.matches ?? []);
        setHasMoreRecent((j.matches ?? []).length === RECENT_PAGE);
      } else {
        setRecentError("لود لیست شکست خورد — برای retry دکمه رو بزن");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreRecent = useCallback(async () => {
    if (loadingMoreRecent || !hasMoreRecent) return;
    setLoadingMoreRecent(true);
    setRecentError(null);
    try {
      const r = await fetch(
        `/api/rules/recent-matches?limit=${RECENT_PAGE}&offset=${recent.length}`,
      );
      if (!r.ok) {
        setRecentError(`خطا ${r.status} — برای retry دکمه رو بزن`);
        return;
      }
      const j = (await r.json()) as { matches: RecentMatch[] };
      setRecent((prev) => [...prev, ...(j.matches ?? [])]);
      setHasMoreRecent((j.matches ?? []).length === RECENT_PAGE);
    } catch (e) {
      setRecentError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMoreRecent(false);
    }
  }, [recent.length, hasMoreRecent, loadingMoreRecent]);

  const recentSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = recentSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRecent();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMoreRecent]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!name.trim() || !desc.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: desc,
          forwardFormat: format || undefined,
        }),
      });
      if (r.ok) {
        setName("");
        setDesc("");
        setFormat("");
        setShowCreate(false);
        load();
      }
    } finally {
      setCreating(false);
    }
  }, [name, desc, format, load]);

  const toggle = useCallback(
    async (id: number, enabled: boolean) => {
      await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      load();
    },
    [load],
  );

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? rules.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(needle)) : rules),
    [rules, needle],
  );
  const onCount = rules.filter((r) => r.enabled).length;
  const noRecipients = rules.filter((r) => r.recipientCount === 0).length;

  const createButton = (
    <button
      onClick={() => setShowCreate((v) => !v)}
      className="min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium"
    >
      {showCreate ? "بستن" : "+ rule جدید"}
    </button>
  );

  return (
    <Shell>
      <PageTitle
        title="📐 Rules"
        subtitle="قانون‌های تشخیص پیام به‌علاوه‌ی فوروارد خودکار. هر قانون رو با یه متن طبیعی توصیف کن و گیرنده‌ها رو ست کن."
        actions={createButton}
      />

      <div className="max-w-3xl">
      {showCreate && (
        <Section icon="➕" title="ساخت rule جدید" summary="اسم، توصیف و (اختیاری) format فوروارد" open onOpenChange={setShowCreate}>
          <div className="flex flex-col gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم rule (مثلاً «کدهای OTP»)"
              className={inputCls}
            />
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="توصیف: چه پیام‌هایی باید match بشن؟ (مثلاً: «پیام‌هایی که شامل یک کد تایید/OTP/verification هستن، معمولاً ۴ تا ۸ رقمی»)"
              rows={3}
              className={inputCls}
            />
            <textarea
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="(اختیاری) format فوروارد — مثلاً «فقط عدد کد رو با emoji 🔑 و علامت bold بفرست» — خالی = پیام اصلی فوروارد می‌شه"
              rows={2}
              className={inputCls}
            />
            <div className="flex gap-2">
              <button
                onClick={create}
                disabled={creating || !name.trim() || !desc.trim()}
                className="min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium disabled:opacity-50"
              >
                {creating ? "ساخت…" : "بساز"}
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="min-h-11 px-5 rounded-xl border border-[var(--color-border)] text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        </Section>
      )}

      {rules.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "همه", value: rules.length },
            { label: "فعال", value: onCount },
            { label: "بدون گیرنده", value: noRecipients },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2.5">
              <div className="text-lg font-semibold tabular-nums">{fa(s.value)}</div>
              <div className="text-xs text-[var(--color-text-dim)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {rules.length > 6 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجوی rule…"
          aria-label="جستجوی rule"
          className={`${inputCls} mb-3`}
        />
      )}

      {loading ? (
        <Card>در حال بارگذاری…</Card>
      ) : loadError && rules.length === 0 ? (
        <Card className="mb-4">
          <p className="text-sm text-red-300 leading-7">⚠ {loadError}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={load} className="min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm">تلاش دوباره</button>
          </div>
        </Card>
      ) : rules.length === 0 ? (
        <div className="mb-4">
          <EmptyState
            icon="📐"
            title="هنوز هیچ rule‌ای نساختی"
            hint="با یه توصیف طبیعی از پیام‌هایی که می‌خوای تشخیص داده بشن شروع کن، بعد گیرنده‌ها رو ست کن."
            action={!showCreate ? createButton : undefined}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="mb-4">
          <EmptyState icon="🔍" title="چیزی پیدا نشد" hint="جستجو رو عوض کن یا پاکش کن." />
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {shown.map((r) => (
            <div key={r.id} className="flex items-stretch rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <Link
                href={`/rules/${r.id}`}
                className="flex-1 min-w-0 min-h-16 px-4 py-3 text-center active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]"
              >
                <div className="text-sm font-semibold leading-6 line-clamp-2">{r.name}</div>
                <div className="mt-1.5 flex items-center justify-center gap-1.5 flex-wrap">
                  {r.enabled ? <Chip tone="ok">on</Chip> : <Chip>off</Chip>}
                  <Chip tone={r.recipientCount === 0 ? "warn" : "info"}>{fa(r.recipientCount)} گیرنده</Chip>
                  {r.forwardFormat && <Chip tone="warn">format سفارشی</Chip>}
                </div>
                <div className="mt-1.5 text-xs leading-5 text-[var(--color-text-dim)] line-clamp-2" dir="auto">
                  {r.description}
                </div>
              </Link>
              {/* enable switch: its own 56px-wide touch column so a tap never opens the rule by accident */}
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={`${r.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"} ${r.name}`}
                onClick={() => toggle(r.id, !r.enabled)}
                className="shrink-0 w-16 grid place-items-center border-s border-[var(--color-border)] active:bg-[var(--color-surface-2)]"
              >
                <span className={`relative w-11 h-6 rounded-full transition-colors ${r.enabled ? "bg-emerald-500" : "bg-[var(--color-border)]"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${r.enabled ? "left-[22px]" : "left-0.5"}`} />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold mb-3">
            🏷 پیام‌های match شده اخیر ({fa(recent.length)})
          </h2>
          <div className="flex flex-col gap-2">
            {recent.map((m) => (
              <Link
                key={m.id}
                href={`/rules/${m.ruleId}`}
                className="block min-h-14 p-3 rounded-xl bg-[var(--color-surface-2)] hover:bg-[var(--color-surface)] text-xs"
              >
                <div className="flex items-center justify-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-dim)] mb-2 flex-wrap">
                  <Chip tone="info">{truncate(m.ruleName, 40)}</Chip>
                  <span>{m.senderName}</span>
                  <span>·</span>
                  <span>{relTime(m.matchedAt)}</span>
                  <span>·</span>
                  <span>
                    {m.forwardedTo.length > 0
                      ? `→ ${fa(m.forwardedTo.length)} گیرنده`
                      : "نگه‌ داشته شده (gate)"}
                  </span>
                </div>
                {/* text-start: the message body is data, centred lines are unreadable */}
                <div
                  dir="auto"
                  style={{ unicodeBidi: "plaintext" }}
                  className="whitespace-pre-wrap break-words text-start leading-6"
                >
                  {truncate(m.formattedText ?? m.messageText, 180)}
                </div>
              </Link>
            ))}
          </div>
          {recentError ? (
            <div className="mt-3 p-3 rounded-xl bg-red-900/30 border border-red-800 text-xs text-red-200 flex flex-col items-center gap-2">
              <span className="leading-6">⚠ {recentError}</span>
              <div className="flex gap-2">
                <button
                  onClick={loadMoreRecent}
                  className="min-h-10 px-4 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs"
                >
                  🔄 دوباره امتحان کن
                </button>
              </div>
            </div>
          ) : hasMoreRecent ? (
            <div
              ref={recentSentinelRef}
              className="text-center text-xs text-[var(--color-text-dim)] py-3"
            >
              {loadingMoreRecent
                ? "⏳ در حال بارگذاری بیشتر…"
                : "اسکرول کن تا بقیه بیاد"}
            </div>
          ) : (
            recent.length > RECENT_PAGE && (
              <div className="text-center text-xs text-[var(--color-text-dim)] py-3">
                · پایان لیست ({fa(recent.length)} match) ·
              </div>
            )
          )}
        </Card>
      )}

      {/* The recent-matches feed failed on first load: say so and offer a retry (loadError covers the rules list). */}
      {recent.length === 0 && recentError && !loading && (
        <Card className="mb-4">
          <p className="text-sm text-red-200 leading-7">⚠ {recentError}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={load} className="min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm">تلاش دوباره</button>
          </div>
        </Card>
      )}
      </div>
    </Shell>
  );
}
