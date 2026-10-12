"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { PageTitle, Badge } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import Section, { Pill } from "@/components/ui/Section";
import { confirmDialog } from "@/components/ui/Dialogs";
import { relTime } from "@/lib/format";

type Item = {
  id: number;
  messageId: number | null;
  tgMessageId: number | null;
  chatId: number | null;
  chatTitle: string | null;
  senderName: string | null;
  kind: string;
  priority: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  location: string | null;
  participants: string[] | null;
  sourceText: string | null;
  doneAt: string | null;
  createdAt: string;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

// These three were rendering their raw English keys as button labels in an
// otherwise Persian UI.
const FILTER_LABEL: Record<"upcoming" | "all" | "done", string> = {
  upcoming: "پیشِ‌رو",
  all: "همه",
  done: "انجام‌شده",
};

const PRIORITY_LABEL: Record<
  string,
  { label: string; tone: "danger" | "warn" | "neutral" | "info" }
> = {
  urgent: { label: "🔴 فوری", tone: "danger" },
  high: { label: "🟠 مهم", tone: "warn" },
  normal: { label: "عادی", tone: "neutral" },
  low: { label: "کم", tone: "info" },
};

function googleCalendarUrl(it: Item): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", it.title);
  if (it.dueAt) {
    // Google Calendar uses YYYYMMDDTHHmmssZ format. Default duration 1 hour
    // when we have a start time.
    const start = new Date(it.dueAt);
    if (!Number.isNaN(start.getTime())) {
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const fmt = (d: Date) =>
        d
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "");
      params.set("dates", `${fmt(start)}/${fmt(end)}`);
    }
  }
  const details: string[] = [];
  if (it.description) details.push(it.description);
  if (it.senderName) details.push(`از: ${it.senderName}`);
  if (it.sourceText) details.push(`\nمتن اصلی:\n${it.sourceText}`);
  if (details.length > 0) params.set("details", details.join("\n"));
  if (it.location) params.set("location", it.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const KIND_LABEL: Record<
  string,
  { label: string; tone: "info" | "warn" | "success" | "danger" | "neutral" }
> = {
  event: { label: "📅 رویداد", tone: "info" },
  task: { label: "✅ کار", tone: "warn" },
  reminder: { label: "🔔 یادآوری", tone: "warn" },
  deadline: { label: "⏳ ددلاین", tone: "danger" },
  decision: { label: "🗳 تصمیم", tone: "neutral" },
  note: { label: "📝 نکته", tone: "neutral" },
};

function fmtDue(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
}

function dueChip(s: string | null): { text: string; tone: "danger" | "warn" | "neutral" } | null {
  if (!s) return null;
  const d = new Date(s);
  const ms = d.getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  const days = ms / 86_400_000;
  if (days < 0) return { text: days > -1 ? "عقب‌افتاده" : `${fa(Math.floor(-days))} روز عقب‌افتاده`, tone: "danger" };
  if (days < 1) return { text: "امروز", tone: "warn" };
  if (days < 2) return { text: "فردا", tone: "warn" };
  if (days < 7) return { text: `${fa(Math.ceil(days))} روز دیگه`, tone: "neutral" };
  return null;
}

// Triage buckets, derived on the client from dueAt/doneAt (the API only filters upcoming/all/done).
type GroupId = "overdue" | "today" | "soon" | "none" | "done";
const GROUPS: Array<{ id: GroupId; icon: string; title: string; hint: string }> = [
  { id: "overdue", icon: "⚠️", title: "عقب‌افتاده", hint: "موعدشان گذشته" },
  { id: "today", icon: "📍", title: "امروز", hint: "تا پایان امروز" },
  { id: "soon", icon: "🗓", title: "پیش‌رو", hint: "موعد بعد از امروز" },
  { id: "none", icon: "🕳", title: "بدون تاریخ", hint: "موعدی ندارند" },
  { id: "done", icon: "✅", title: "انجام‌شده", hint: "بسته‌شده‌ها" },
];

function groupOf(it: Item): GroupId {
  if (it.doneAt) return "done";
  if (!it.dueAt) return "none";
  const t = new Date(it.dueAt).getTime();
  if (Number.isNaN(t)) return "none";
  if (t < Date.now()) return "overdue";
  const eod = new Date();
  eod.setHours(23, 59, 59, 999);
  return t <= eod.getTime() ? "today" : "soon";
}

const BULK_KIND_OPTIONS = [
  "event",
  "task",
  "reminder",
  "deadline",
  "decision",
  "note",
  "action",
] as const;

type View = "upcoming" | "all" | "done";
type Prio = "all" | "urgent" | "high" | "normal" | "low";

const CHIP = "min-h-10 px-3 rounded-full border text-xs font-medium";
const chipOn = "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white";
const chipOff = "border-[var(--color-border)] text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)]";

export default function RemindersPage() {
  const [filter, setFilter] = useState<View>("upcoming");
  const [priorityFilter, setPriorityFilter] = useState<Prio>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [moreBulk, setMoreBulk] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupId | "all">("all");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: number; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) =>
    setter((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // silent = background refresh after an action: keep the list on screen instead of blanking it.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/reminders?filter=${filter}&priority=${priorityFilter}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { items: Item[] };
        setItems(j.items);
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [filter, priorityFilter],
  );

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const m: Record<GroupId, Item[]> = { overdue: [], today: [], soon: [], none: [], done: [] };
    for (const it of items) m[groupOf(it)].push(it);
    return m;
    // `load` replaces `items`, which is when "now" is worth re-evaluating
  }, [items]);

  const kindsPresent = useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);

  const needle = q.trim().toLowerCase();
  const visibleByGroup = useMemo(() => {
    const keep = (it: Item) => {
      if (kindFilter && it.kind !== kindFilter) return false;
      if (!needle) return true;
      return `${it.title} ${it.description ?? ""} ${it.senderName ?? ""} ${it.chatTitle ?? ""} ${it.location ?? ""}`.toLowerCase().includes(needle);
    };
    const m = {} as Record<GroupId, Item[]>;
    for (const g of GROUPS) m[g.id] = grouped[g.id].filter(keep);
    return m;
  }, [grouped, needle, kindFilter]);

  const shownGroups = GROUPS.filter((g) => (groupFilter === "all" || groupFilter === g.id) && visibleByGroup[g.id].length > 0);
  const visibleItems = shownGroups.flatMap((g) => visibleByGroup[g.id]);
  // Bulk actions only ever touch what is on screen, never a selection hidden by a filter.
  const picked = visibleItems.filter((it) => selected.has(it.id));
  const filtersActive = Boolean(needle || kindFilter || groupFilter !== "all");

  const selectIds = (ids: number[]) => setSelected((s) => new Set([...s, ...ids]));
  const clearFilters = () => {
    setQ("");
    setKindFilter(null);
    setGroupFilter("all");
  };

  async function runBulk(op: "done" | "undone" | "delete" | "set_kind", kind?: string) {
    if (picked.length === 0) return;
    if (op === "delete") {
      if (!(await confirmDialog(`حذف ${fa(picked.length)} مورد؟`, { danger: true, confirmLabel: "حذف" }))) return;
    }
    setBulking(true);
    try {
      const r = await fetch("/api/reminders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: picked.map((i) => i.id), kind }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(`عملیات شکست خورد: ${j.error ?? r.status}`);
      } else {
        setMoreBulk(false);
        await load(true);
      }
    } finally {
      setBulking(false);
    }
  }

  async function setDone(it: Pick<Item, "id" | "title">, done: boolean) {
    const r = await fetch(`/api/reminders/${it.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    }).catch(() => null);
    if (!r?.ok) {
      setError("ثبت تغییر انجام نشد");
      return;
    }
    setError(null);
    // Optimistic: the row leaves the current view straight away, then a quiet reload back-fills it.
    const leaves = (filter === "upcoming" && done) || (filter === "done" && !done);
    setItems((cur) =>
      leaves ? cur.filter((x) => x.id !== it.id) : cur.map((x) => (x.id === it.id ? { ...x, doneAt: done ? new Date().toISOString() : null } : x)),
    );
    setSelected((s) => {
      const n = new Set(s);
      n.delete(it.id);
      return n;
    });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (done) {
      setUndo({ id: it.id, title: it.title });
      undoTimer.current = setTimeout(() => setUndo(null), 7000);
    } else setUndo(null);
    void load(true);
  }

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const counts = { all: items.length, ...Object.fromEntries(GROUPS.map((g) => [g.id, grouped[g.id].length])) } as Record<GroupId | "all", number>;
  const firstOpen = new Set(shownGroups.slice(0, 2).map((g) => g.id));

  return (
    <Shell>
      <div className="md:max-w-3xl md:mx-auto">
        <PageTitle
          title="کارها"
          subtitle="کارها، رویدادها، یادآوری‌ها و نکته‌هایی که از پیام‌ها استخراج شده. ریمایندر فقط یک نوع از actionهاست."
        />

        <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div role="tablist" aria-label="نمایش" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--color-surface-2)]">
            {(["upcoming", "all", "done"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-10 rounded-lg text-sm font-medium ${filter === f ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-dim)]"}`}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>

          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو در عنوان، توضیح و فرستنده…"
            aria-label="جستجو در کارها"
            className="mt-3 w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-4"
          />

          {!loading && items.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <button type="button" onClick={() => setGroupFilter("all")} className={`${CHIP} ${groupFilter === "all" ? chipOn : chipOff}`}>
                همه <span className="opacity-70">{fa(counts.all)}</span>
              </button>
              {GROUPS.map((g) =>
                counts[g.id] === 0 ? null : (
                  <button key={g.id} type="button" onClick={() => setGroupFilter(g.id)} className={`${CHIP} ${groupFilter === g.id ? chipOn : chipOff}`}>
                    {g.icon} {g.title} <span className="opacity-70">{fa(counts[g.id])}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        <Section
          icon="🎚"
          title="فیلتر اولویت و نوع"
          summary={priorityFilter === "all" && !kindFilter ? "همه‌ی اولویت‌ها و نوع‌ها" : "فیلتر فعال است"}
          badge={priorityFilter !== "all" || kindFilter ? <Pill tone="warn">فعال</Pill> : undefined}
        >
          <label className="block text-xs text-[var(--color-text-dim)] mb-1.5" htmlFor="rem-prio">اولویت</label>
          <select
            id="rem-prio"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as Prio)}
            className="w-full min-h-11 text-sm px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]"
          >
            <option value="all">همه‌ی اولویت‌ها</option>
            <option value="urgent">🔴 فوری</option>
            <option value="high">🟠 مهم</option>
            <option value="normal">عادی</option>
            <option value="low">کم</option>
          </select>
          {kindsPresent.length > 1 && (
            <>
              <div className="text-xs text-[var(--color-text-dim)] mt-4 mb-1.5">نوع</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                <button type="button" onClick={() => setKindFilter(null)} className={`${CHIP} ${kindFilter == null ? chipOn : chipOff}`}>
                  همه
                </button>
                {kindsPresent.map((k) => (
                  <button key={k} type="button" onClick={() => setKindFilter(kindFilter === k ? null : k)} className={`${CHIP} ${kindFilter === k ? chipOn : chipOff}`}>
                    {(KIND_LABEL[k] ?? { label: k }).label}
                  </button>
                ))}
              </div>
            </>
          )}
        </Section>

        {error && (
          <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-center">
            <p className="text-sm text-rose-200 leading-6">خطا: {error}</p>
            <div className="mt-2 flex">
              <button type="button" onClick={() => load()} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100">تلاش دوباره</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
        ) : items.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="🔔"
              title="هنوز چیزی نیست"
              hint="روی هر پیامی توی «همه‌ی پیام‌ها» یا «فوری» دکمه‌ی «🧠 استخراج» رو بزن تا AI تاریخ‌ها، کارها و یادآوری‌ها رو ازش بیرون بکشه."
              action={<Link href="/messages" className="min-h-10 inline-flex items-center px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm">رفتن به پیام‌ها</Link>}
            />
          )
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
              <span className="flex-1 min-w-0 text-center text-xs text-[var(--color-text-dim)]">
                {fa(visibleItems.length)} مورد نمایش، {fa(picked.length)} انتخاب‌شده
              </span>
              <button
                type="button"
                onClick={() => selectIds(visibleItems.map((i) => i.id))}
                disabled={bulking || visibleItems.length === 0}
                className="min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs disabled:opacity-50"
              >
                انتخاب همه ({fa(visibleItems.length)})
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={bulking || picked.length === 0}
                className="min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs disabled:opacity-50"
              >
                پاک کردن
              </button>
            </div>

            {items.length >= 100 && (
              <p className="mb-3 px-2 text-center text-xs leading-6 text-[var(--color-text-dim)]">
                فقط ۱۰۰ مورد اول نمایش داده می‌شود؛ با «انجام شد» یا حذف، موردهای بعدی جای آن‌ها می‌آیند.
              </p>
            )}

            {shownGroups.length === 0 ? (
              <EmptyState
                icon="🔍"
                title="چیزی پیدا نشد"
                hint="با این جستجو یا فیلتر موردی نیست."
                action={filtersActive ? <button type="button" onClick={clearFilters} className="min-h-10 px-4 rounded-xl border border-[var(--color-border)] text-sm">پاک کردن فیلترها</button> : undefined}
              />
            ) : (
              shownGroups.map((g) => {
                const list = visibleByGroup[g.id];
                const allPicked = list.every((i) => selected.has(i.id));
                return (
                  <Section
                    key={`${g.id}-${groupFilter}-${filter}`}
                    icon={g.icon}
                    title={g.title}
                    summary={g.hint}
                    badge={<Pill tone={g.id === "overdue" ? "bad" : g.id === "today" ? "warn" : g.id === "done" ? "ok" : "neutral"}>{fa(list.length)}</Pill>}
                    defaultOpen={groupFilter !== "all" || firstOpen.has(g.id)}
                  >
                    <div className="flex pb-3">
                      <button
                        type="button"
                        onClick={() => (allPicked ? setSelected((s) => new Set([...s].filter((id) => !list.some((i) => i.id === id)))) : selectIds(list.map((i) => i.id)))}
                        disabled={bulking}
                        className="min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs disabled:opacity-50"
                      >
                        {allPicked ? "لغو انتخاب این گروه" : `انتخاب این گروه (${fa(list.length)})`}
                      </button>
                    </div>
                    <ul className="-mx-4 -mb-4 border-t border-[var(--color-border)]">
                      {list.map((it) => (
                        <ReminderRow
                          key={it.id}
                          it={it}
                          checked={selected.has(it.id)}
                          open={expanded.has(it.id)}
                          onCheck={() => toggleIn(setSelected, it.id)}
                          onOpen={() => toggleIn(setExpanded, it.id)}
                          onDone={() => setDone(it, !it.doneAt)}
                        />
                      ))}
                    </ul>
                  </Section>
                );
              })
            )}
          </>
        )}

        {/* Sticks above the mobile tab bar while there is something to act on. */}
        {(picked.length > 0 || undo) && (
          <div className="sticky bottom-[4.75rem] md:bottom-4 z-20 mt-3 flex flex-col gap-2">
            {undo && (
              <div className="rounded-2xl border border-emerald-500/40 bg-[var(--color-surface)] px-3 py-2 shadow-xl flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-center text-xs" dir="auto">✓ انجام شد: {undo.title}</span>
                <button
                  type="button"
                  onClick={() => void setDone(undo, false)}
                  className="shrink-0 min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs"
                >
                  بازگردانی
                </button>
              </div>
            )}
            {picked.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-accent)]/60 bg-[var(--color-surface)] p-2.5 shadow-xl text-center">
                <div className="text-xs mb-2 text-[var(--color-text-dim)]">{fa(picked.length)} انتخاب‌شده</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runBulk("done")}
                    disabled={bulking}
                    className="min-h-11 px-4 rounded-xl bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
                  >
                    ✓ انجام شد
                  </button>
                  <button
                    type="button"
                    onClick={() => runBulk("delete")}
                    disabled={bulking}
                    className="min-h-11 px-4 rounded-xl border border-red-800 text-red-300 text-sm disabled:opacity-50"
                  >
                    🗑 حذف
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoreBulk((v) => !v)}
                    aria-expanded={moreBulk}
                    className="min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm"
                  >
                    بیشتر {moreBulk ? "▴" : "▾"}
                  </button>
                </div>
                {moreBulk && (
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => runBulk("undone")}
                      disabled={bulking}
                      className="min-h-11 rounded-xl border border-[var(--color-border)] text-sm disabled:opacity-50"
                    >
                      برگرداندن به انجام‌نشده
                    </button>
                    <select
                      disabled={bulking}
                      aria-label="تغییر نوع"
                      onChange={(e) => {
                        const k = e.target.value;
                        if (!k) return;
                        void runBulk("set_kind", k);
                        e.currentTarget.value = "";
                      }}
                      className="min-h-11 w-full text-sm px-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] disabled:opacity-50"
                      defaultValue=""
                    >
                      <option value="">تغییر نوع به…</option>
                      {BULK_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

// One triage row: tick on the start side, tap the text to expand, big round "done" on the left.
function ReminderRow({ it, checked, open, onCheck, onOpen, onDone }: {
  it: Item; checked: boolean; open: boolean; onCheck: () => void; onOpen: () => void; onDone: () => void;
}) {
  const kindInfo = KIND_LABEL[it.kind] ?? KIND_LABEL.note!;
  const due = dueChip(it.dueAt);
  const prio = it.priority && it.priority !== "normal" ? (PRIORITY_LABEL[it.priority] ?? PRIORITY_LABEL.normal!) : null;
  const dueText = fmtDue(it.dueAt);
  return (
    <li className={`border-b last:border-b-0 border-[var(--color-border)] ${checked ? "bg-[var(--color-accent)]/10" : ""}`}>
      <div className="flex items-stretch">
        <label className="grid place-items-center w-12 shrink-0 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`انتخاب: ${it.title}`} />
        </label>
        <button type="button" onClick={onOpen} aria-expanded={open} className="min-w-0 flex-1 min-h-16 py-3 text-center">
          <span className="flex items-center justify-center gap-1.5 flex-wrap">
            <Badge tone={kindInfo.tone}>{kindInfo.label}</Badge>
            {prio && <Badge tone={prio.tone}>{prio.label}</Badge>}
            {due && <Badge tone={due.tone}>{due.text}</Badge>}
            {it.doneAt && <Badge tone="success">انجام‌شده</Badge>}
          </span>
          <span dir="auto" className={`mt-1.5 block text-sm font-medium leading-6 break-words ${open ? "" : "line-clamp-2"}`}>{it.title}</span>
          <span className="mt-1 block text-xs text-[var(--color-text-dim)]">
            {dueText ? `🗓 ${dueText}` : relTime(it.createdAt)}
          </span>
        </button>
        <div className="grid place-items-center w-14 shrink-0">
          <button
            type="button"
            onClick={onDone}
            aria-label={it.doneAt ? "برگرداندن به انجام‌نشده" : "انجام شد"}
            title={it.doneAt ? "برگرداندن به انجام‌نشده" : "انجام شد"}
            className={`w-11 h-11 rounded-full border text-lg grid place-items-center ${
              it.doneAt
                ? "border-[var(--color-border)] text-[var(--color-text-dim)] active:bg-[var(--color-surface-2)]"
                : "border-emerald-600 text-emerald-300 active:bg-emerald-900/40"
            }`}
          >
            {it.doneAt ? "↩" : "✓"}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 text-center">
          {it.description && <p dir="auto" className="text-sm leading-7 text-[var(--color-text-dim)] break-words">{it.description}</p>}
          <div className="mt-2 text-xs text-[var(--color-text-dim)] leading-6 flex flex-col gap-0.5">
            {it.location && <span>📍 {it.location}</span>}
            {it.participants && it.participants.length > 0 && <span>👥 {it.participants.join(", ")}</span>}
            {it.chatId && it.senderName && <span>از {it.senderName}</span>}
            <span>{relTime(it.createdAt)}</span>
          </div>
          {it.sourceText && (
            <div dir="auto" className="mt-3 p-3 rounded-xl bg-[var(--color-surface-2)] text-xs leading-6 whitespace-pre-wrap break-words border border-[var(--color-border)]">
              {it.sourceText}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {it.chatId && (
              <Link href={`/chats/${it.chatId}`} className="min-h-10 inline-flex items-center px-3 rounded-xl border border-[var(--color-border)] text-xs">
                باز کردن چت
              </Link>
            )}
            <a
              href={googleCalendarUrl(it)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-10 inline-flex items-center px-3 rounded-xl border border-[var(--color-border)] text-xs"
              title="باز کردن رویداد ازپیش‌پرشده‌ی Google Calendar در تب جدید"
            >
              📅 افزودن به Google Calendar
            </a>
          </div>
        </div>
      )}
    </li>
  );
}
