"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import Section, { Pill } from "@/components/ui/Section";
import { confirmDialog } from "@/components/ui/Dialogs";
import { relTime } from "@/lib/format";
import WatchlistPanel from "@/components/WatchlistPanel";

type Note = {
  id: number;
  chatId: number;
  sourceMessageId: number | null;
  kind: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  senderName: string | null;
  archivedAt: string | null;
  createdAt: string;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const KIND_EMOJI: Record<string, string> = {
  address: "🏠",
  location: "📍",
  contact: "👤",
  phone: "📞",
  url: "🔗",
  note: "📝",
  date: "📅",
  watchlist: "🕵️",
};

const CHIP = "min-h-10 px-3 rounded-full border text-xs font-medium";
const chipOn = "bg-[var(--color-accent)] text-white border-[var(--color-accent)]";
const chipOff = "bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-dim)]";
const INPUT = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-4";

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-center">
      <p className="text-sm text-rose-200 leading-6">خطا: {message}</p>
      <div className="mt-2 flex">
        <button type="button" onClick={onRetry} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100">تلاش دوباره</button>
      </div>
    </div>
  );
}

type Tab = "notes" | "concepts" | "settings";

export default function NotesPage() {
  const [tab, setTabState] = useState<Tab>("notes");

  // Persist the active tab in localStorage so a refresh stays put.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      window.localStorage.setItem("notes.tab", next);
    } catch {
      // private mode / blocked storage: the tab just isn't remembered
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("notes.tab");
      if (stored === "notes" || stored === "concepts" || stored === "settings") {
        setTabState(stored);
      }
    } catch {
      // see setTab
    }
  }, []);

  return (
    <Shell>
      <div className="md:max-w-3xl md:mx-auto">
        <PageTitle
          title="📒 یادداشت‌ها"
          subtitle="نکات استخراج‌شده + مفاهیم Watchlist + تنظیمات پیشرفته‌ی همه‌ی پیام‌ها."
        />
        <div className="grid grid-cols-3 gap-1 p-1 mb-4 rounded-xl bg-[var(--color-surface-2)]" role="tablist">
          <TabButton
            active={tab === "notes"}
            onClick={() => setTab("notes")}
            label="📚 یادداشت‌ها"
          />
          <TabButton
            active={tab === "concepts"}
            onClick={() => setTab("concepts")}
            label="🕵️ مفاهیم Watchlist"
          />
          <TabButton
            active={tab === "settings"}
            onClick={() => setTab("settings")}
            label="⚙️ تنظیمات"
          />
        </div>

        {tab === "notes" && <NotesViewerTab />}
        {tab === "concepts" && <WatchlistPanel />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </Shell>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-11 px-1 rounded-lg text-xs font-medium leading-5 ${
        active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-dim)]"
      }`}
    >
      {label}
    </button>
  );
}

function NotesViewerTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [kinds, setKinds] = useState<Array<{ kind: string; count: number }>>([]);
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chatIdFilter, setChatIdFilter] = useState("");
  const [sinceDays, setSinceDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const PAGE = 100;
  const [hasMore, setHasMore] = useState(true);

  const buildQuery = useCallback(
    (offsetOverride?: number) => {
      const p = new URLSearchParams({ view: "flat", limit: String(PAGE) });
      p.set("offset", String(offsetOverride ?? offset));
      if (activeKind) p.set("kind", activeKind);
      if (q.trim()) p.set("q", q.trim());
      if (chatIdFilter.trim()) p.set("chatId", chatIdFilter.trim());
      if (sinceDays && sinceDays > 0) p.set("days", String(sinceDays));
      return p.toString();
    },
    [activeKind, q, chatIdFilter, sinceDays, offset],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/notes?${buildQuery(0)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        notes: Note[];
        kinds: Array<{ kind: string; count: number }>;
      };
      setNotes(j.notes);
      setKinds(j.kinds ?? []);
      setHasMore(j.notes.length === PAGE);
      setOffset(j.notes.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/notes?${buildQuery(offset)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { notes: Note[] };
      setNotes((cur) => [...cur, ...j.notes]);
      setHasMore(j.notes.length === PAGE);
      setOffset((cur) => cur + j.notes.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, buildQuery, offset]);

  // Re-fetch when filters change (debounced for q).
  useEffect(() => {
    const t = setTimeout(load, q.trim() || chatIdFilter.trim() ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKind, q, chatIdFilter, sinceDays]);

  async function deleteNote(id: number) {
    if (!(await confirmDialog("این note حذف بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
    const r = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (r.ok) await load();
    else setError(`حذف نشد (HTTP ${r.status})`);
  }

  const total = kinds.reduce((a, k) => a + k.count, 0);
  const advancedOn = Boolean(chatIdFilter.trim() || sinceDays);

  return (
    <>
      <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
        <div className="flex items-center gap-2">
          <input
            type="search"
            dir="auto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 جستجو در متن / عنوان / فرستنده"
            aria-label="جستجو در یادداشت‌ها"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="بروزرسانی"
            title="بروزرسانی"
            className="shrink-0 w-11 h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            🔄
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--color-text-dim)]">
          {fa(total)} نوت کل، {fa(notes.length)} نمایش
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          <button type="button" onClick={() => setActiveKind(null)} className={`${CHIP} ${activeKind == null ? chipOn : chipOff}`}>
            همه {fa(total)}
          </button>
          {kinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => setActiveKind(k.kind)}
              className={`${CHIP} ${activeKind === k.kind ? chipOn : chipOff}`}
            >
              {KIND_EMOJI[k.kind] ?? "📝"} {k.kind} {fa(k.count)}
            </button>
          ))}
        </div>
      </div>

      <Section
        icon="🎚"
        title="فیلتر چت و بازه"
        summary="محدود کردن به یک چت یا چند روز اخیر"
        badge={advancedOn ? <Pill tone="warn">فعال</Pill> : undefined}
      >
        <div className="flex flex-col gap-2">
          <input
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={chatIdFilter}
            onChange={(e) => setChatIdFilter(e.target.value)}
            placeholder="فیلتر chat ID"
            aria-label="فیلتر chat ID"
            className={`${INPUT} text-center`}
          />
          <select
            value={sinceDays ?? ""}
            onChange={(e) =>
              setSinceDays(e.target.value === "" ? null : Number(e.target.value))
            }
            aria-label="بازه‌ی زمانی"
            className={INPUT}
          >
            <option value="">از همیشه</option>
            <option value="1">۲۴ ساعت اخیر</option>
            <option value="3">۳ روز اخیر</option>
            <option value="7">۷ روز اخیر</option>
            <option value="30">۳۰ روز اخیر</option>
            <option value="90">۹۰ روز اخیر</option>
          </select>
        </div>
      </Section>

      {error && <ErrorBox message={error} onRetry={load} />}

      {loading && notes.length === 0 ? (
        <Card>
          <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
        </Card>
      ) : notes.length === 0 ? (
        error ? null : (
          <EmptyState
            icon="📒"
            title="هیچ نوتی با این فیلتر نیست"
            hint="می‌تونی توی تب «مفاهیم Watchlist» concept تعریف کنی، یا توی هر چت «📒 auto-extract notes» رو روشن کنی."
          />
        )
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => {
            const gmaps = (n.metadata?.gmaps as string | undefined) ?? null;
            const url = (n.metadata?.url as string | undefined) ?? null;
            return (
              <Card key={n.id} className="!p-3">
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  <Badge tone="info">
                    {KIND_EMOJI[n.kind] ?? "📝"} {n.kind}
                  </Badge>
                  <span className="text-xs text-[var(--color-text-dim)]">
                    {relTime(n.createdAt)}
                    {n.senderName ? ` · ${n.senderName}` : ""}
                  </span>
                </div>
                {n.title && (
                  <div dir="auto" className="mt-2 text-sm font-medium leading-6 break-words">
                    {n.title}
                  </div>
                )}
                <div
                  dir="auto"
                  className="mt-1.5 text-sm leading-7 whitespace-pre-wrap break-words"
                >
                  {n.content}
                </div>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="mt-2 flex min-h-10 items-center justify-center text-xs text-blue-400 underline break-all"
                  >
                    {url}
                  </a>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={`/chats/${n.chatId}`}
                    className="min-h-10 inline-flex items-center px-3 rounded-xl border border-[var(--color-border)] text-xs text-[var(--color-accent)]"
                  >
                    chat {n.chatId}
                  </Link>
                  {gmaps && (
                    <a
                      href={gmaps}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-10 inline-flex items-center px-3 rounded-xl border border-[var(--color-border)] text-xs text-blue-400"
                    >
                      🗺 Google Maps
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteNote(n.id)}
                    aria-label="حذف نوت"
                    title="حذف"
                    className="min-h-10 min-w-10 px-3 rounded-xl border border-red-700 text-red-300 active:bg-red-900/30"
                  >
                    🗑
                  </button>
                </div>
              </Card>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="min-h-11 text-sm px-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
            >
              {loading ? "در حال بارگذاری…" : `📜 نمایش ${fa(PAGE)} مورد بعدی`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

type NotesSettings = {
  notesWatchlistEnabled: string;
  notesWatchlistForwardToInbox: string;
  notesWatchlistCooldownMinutes: string;
  notesWatchlistMinMessageLength: string;
  notesAutoArchiveDays: string;
  notesDailyDigestEnabled: string;
  notesDailyDigestHourUTC: string;
};

function SettingsTab() {
  const [s, setS] = useState<NotesSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiveDays, setArchiveDays] = useState(60);
  const [maintMsg, setMaintMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/notes-settings");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { settings: NotesSettings };
      setS(j.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [saveErr, setSaveErr] = useState<string | null>(null);
  const save = async (patch: Partial<NotesSettings>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    try {
      const r = await fetch("/api/notes-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSaveErr(null);
    } catch (e) {
      // the switch must not keep showing a value the server never accepted
      setSaveErr(`ذخیره نشد (${e instanceof Error ? e.message : "خطا"}) — مقدار قبلی برگشت`);
      await load();
    }
  };

  const runMaint = async () => {
    setMaintMsg(null);
    const r = await fetch("/api/notes/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: archiveDays }),
    });
    if (r.ok) {
      const j = (await r.json()) as { archived: number; days: number };
      setMaintMsg(`${fa(j.archived)} note قدیمی‌تر از ${fa(j.days)} روز archive شد.`);
    } else {
      setMaintMsg("خطا در اجرا");
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (loading || !s) return <Card>در حال بارگذاری…</Card>;

  const asBool = (v: string) => v.toLowerCase() !== "false" && v !== "";

  return (
    <div>
      {saveErr && <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 text-center">{saveErr}</div>}
      <Section icon="🕵️" title="AI Watchlist" summary={asBool(s.notesWatchlistEnabled) ? "سکنر روشن است" : "سکنر خاموش است"} defaultOpen>
        <ToggleRow
          label="فعال بودن سکنر"
          help="با خاموش شدن، هیچ پیامی برای match با مفاهیم اسکن نمی‌شه (هیچ هزینه‌ی AI هم نمی‌ره)."
          value={asBool(s.notesWatchlistEnabled)}
          onChange={(v) =>
            save({ notesWatchlistEnabled: v ? "true" : "false" })
          }
        />
        <ToggleRow
          label="ارسال match ها به کانال notes_inbox (پیش‌فرض)"
          help="می‌تونی برای یه concept خاص از تب «مفاهیم» این رو override کنی."
          value={asBool(s.notesWatchlistForwardToInbox)}
          onChange={(v) =>
            save({ notesWatchlistForwardToInbox: v ? "true" : "false" })
          }
        />
        <NumberRow
          label="cooldown (دقیقه) بین match های هم‌مفهوم از یک چت"
          help="مثلاً ۳۰ یعنی اگه یه concept توی یه چت تو ۳۰ دقیقه‌ی اخیر match شده، بار دوم رو رد می‌کنه. هر concept می‌تونه override خودش رو داشته باشه."
          value={s.notesWatchlistCooldownMinutes}
          onChange={(v) => save({ notesWatchlistCooldownMinutes: v })}
          min={0}
          max={10080}
        />
        <NumberRow
          label="حداقل طول پیام برای اسکن (کاراکتر)"
          help="پیام‌های کوتاه‌تر از این عدد اصلاً اسکن نمی‌شن. هزینه‌ی LLM رو روی «👍» و «اوکی» حروم نمی‌کنه."
          value={s.notesWatchlistMinMessageLength}
          onChange={(v) => save({ notesWatchlistMinMessageLength: v })}
          min={0}
          max={500}
        />
      </Section>

      <Section icon="🧹" title="نگهداری" summary="archive خودکار و پاک‌سازی دستی">
        <NumberRow
          label="archive خودکار note های قدیمی‌تر از (روز)"
          help="0 یعنی هرگز archive نکن. اگه عددی بذاری، یه sweep خودکار به‌مرور note ها رو archive می‌کنه."
          value={s.notesAutoArchiveDays}
          onChange={(v) => save({ notesAutoArchiveDays: v })}
          min={0}
          max={3650}
        />
        <div className="border-t border-[var(--color-border)] mt-3 pt-3">
          <div className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
            پاک‌سازی دستی الان — هر note مهم‌تر از این تعداد روز archive می‌شه.
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="number"
              inputMode="numeric"
              value={archiveDays}
              onChange={(e) => setArchiveDays(Number(e.target.value) || 0)}
              min={1}
              max={3650}
              aria-label="تعداد روز"
              className="w-24 min-h-11 text-sm text-center bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-2"
            />
            <span className="text-xs text-[var(--color-text-dim)]">روز</span>
            <button
              type="button"
              onClick={runMaint}
              className="min-h-11 text-sm px-4 rounded-xl bg-[var(--color-accent)] text-white"
            >
              پاک‌سازی الان
            </button>
          </div>
          {maintMsg && (
            <p role="status" className="mt-2 text-xs leading-6 text-[var(--color-text-dim)]">
              {maintMsg}
            </p>
          )}
        </div>
      </Section>

      <Section icon="📨" title="خلاصه‌ی روزانه" summary={asBool(s.notesDailyDigestEnabled) ? "روشن است" : "خاموش است"}>
        <ToggleRow
          label="ارسال خلاصه‌ی روزانه‌ی Watchlist به notes_inbox"
          help="هر روز یه دایجست از match های ۲۴ ساعت اخیر به notes_inbox ارسال می‌شه."
          value={asBool(s.notesDailyDigestEnabled)}
          onChange={(v) => save({ notesDailyDigestEnabled: v ? "true" : "false" })}
        />
        <NumberRow
          label="ساعت ارسال (UTC)"
          help="ساعت روزانه (0-23) به وقت UTC که خلاصه ارسال می‌شه."
          value={s.notesDailyDigestHourUTC}
          onChange={(v) => save({ notesDailyDigestHourUTC: v })}
          min={0}
          max={23}
        />
      </Section>
    </div>
  );
}

// A settings row is one tappable strip (≥56px): label + help centred, the control at the end of the row.
function ToggleRow({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer min-h-14 py-2 border-b border-[var(--color-border)] last:border-0">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-6">{label}</div>
        {help && (
          <div className="text-xs leading-5 text-[var(--color-text-dim)] mt-0.5">
            {help}
          </div>
        )}
      </div>
    </label>
  );
}

function NumberRow({
  label,
  help,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-3 min-h-14 py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-6">{label}</div>
        {help && (
          <div className="text-xs leading-5 text-[var(--color-text-dim)] mt-0.5">
            {help}
          </div>
        )}
      </div>
      <input
        type="number"
        inputMode="numeric"
        defaultValue={value}
        min={min}
        max={max}
        aria-label={label}
        onBlur={(e) => {
          if (e.target.value !== value) onChange(e.target.value);
        }}
        className="w-20 shrink-0 min-h-11 text-sm text-center bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-2"
      />
    </div>
  );
}
