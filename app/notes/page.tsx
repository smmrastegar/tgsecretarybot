"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";
import WatchlistPanel from "@/components/WatchlistPanel";

type SummaryRow = {
  chatId: number;
  total: number;
  byKind: Record<string, number>;
  lastNoteAt: string;
};

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

type Tab = "notes" | "concepts" | "settings";

export default function NotesPage() {
  const [tab, setTabState] = useState<Tab>("notes");

  // Persist the active tab in localStorage so a refresh stays put.
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("notes.tab", next);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("notes.tab");
    if (stored === "notes" || stored === "concepts" || stored === "settings") {
      setTabState(stored);
    }
  }, []);

  return (
    <Shell>
      <PageTitle
        title="📒 Notes"
        subtitle="نکات استخراج‌شده + مفاهیم Watchlist + تنظیمات پیشرفته‌ی همه‌ی پیام‌ها."
      />
      <div className="flex gap-2 mb-4 flex-wrap" role="tablist">
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
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md border ${
        active
          ? "bg-[var(--color-accent)] text-white border-transparent"
          : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      {label}
    </button>
  );
}

function NotesViewerTab() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [openChat, setOpenChat] = useState<number | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notes");
      if (r.ok) {
        const j = (await r.json()) as { summary: SummaryRow[] };
        setSummary(j.summary);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotes = useCallback(async () => {
    if (openChat == null) return;
    setNotesLoading(true);
    try {
      const params = new URLSearchParams({ chatId: String(openChat) });
      if (kindFilter) params.set("kind", kindFilter);
      const r = await fetch(`/api/notes?${params.toString()}`);
      if (r.ok) {
        const j = (await r.json()) as { notes: Note[] };
        setNotes(j.notes);
      }
    } finally {
      setNotesLoading(false);
    }
  }, [openChat, kindFilter]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  async function deleteNote(id: number) {
    if (!confirm("این note حذف بشه؟")) return;
    const r = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (r.ok) {
      await loadNotes();
      await loadSummary();
    }
  }

  const kinds = useMemo(() => {
    const out = new Set<string>();
    for (const row of summary) for (const k of Object.keys(row.byKind)) out.add(k);
    return Array.from(out).sort();
  }, [summary]);

  if (loading) return <Card>Loading…</Card>;
  if (summary.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-text-dim)]">
          هنوز note ای ثبت نشده. می‌تونی توی تب «مفاهیم Watchlist» یه concept
          تعریف کنی، یا توی صفحه‌ی هر چت گزینه‌ی «📒 auto-extract notes» رو
          روشن کنی.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-3">
        <div className="text-xs text-[var(--color-text-dim)] mb-2">
          {summary.length} چت · {summary.reduce((a, s) => a + s.total, 0)}{" "}
          note مجموعاً
        </div>
        <div className="flex flex-col gap-1.5">
          {summary.map((row) => (
            <button
              key={row.chatId}
              onClick={() =>
                setOpenChat(openChat === row.chatId ? null : row.chatId)
              }
              className={`text-right p-2 rounded-md border transition-colors ${
                openChat === row.chatId
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <Link
                  href={`/chats/${row.chatId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium hover:underline"
                >
                  chat {row.chatId}
                </Link>
                <div className="flex items-center gap-1 flex-wrap">
                  {Object.entries(row.byKind).map(([k, n]) => (
                    <Badge key={k} tone="info">
                      {KIND_EMOJI[k] ?? "📝"} {k} · {n}
                    </Badge>
                  ))}
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    {relTime(row.lastNoteAt)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {openChat != null && (
        <Card>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="text-sm font-medium">📒 Notes · chat {openChat}</div>
            <div className="flex items-center gap-2">
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
              >
                <option value="">همه</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_EMOJI[k] ?? "📝"} {k}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setOpenChat(null)}
                className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                ✕
              </button>
            </div>
          </div>
          {notesLoading ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">…</div>
          ) : notes.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              note ای نیست
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {notes.map((n) => {
                const gmaps = (n.metadata?.gmaps as string | undefined) ?? null;
                const url = (n.metadata?.url as string | undefined) ?? null;
                return (
                  <div
                    key={n.id}
                    className="text-xs p-2 rounded-md border border-[var(--color-border)]"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge tone="info">
                        {KIND_EMOJI[n.kind] ?? "📝"} {n.kind}
                      </Badge>
                      {n.title && (
                        <span className="font-medium">{n.title}</span>
                      )}
                      <span className="text-[10px] text-[var(--color-text-dim)] mr-auto">
                        {relTime(n.createdAt)}
                        {n.senderName ? ` · ${n.senderName}` : ""}
                      </span>
                      <button
                        onClick={() => deleteNote(n.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
                      >
                        🗑
                      </button>
                    </div>
                    <div
                      dir="auto"
                      className="whitespace-pre-wrap break-words"
                    >
                      {n.content}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px]">
                      {gmaps && (
                        <a
                          href={gmaps}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline"
                        >
                          🗺 Google Maps
                        </a>
                      )}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline break-all"
                        >
                          {url}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
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
  const [archiveDays, setArchiveDays] = useState(60);
  const [maintMsg, setMaintMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notes-settings");
      if (r.ok) {
        const j = (await r.json()) as { settings: NotesSettings };
        setS(j.settings);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Partial<NotesSettings>) => {
    setS((cur) => (cur ? { ...cur, ...patch } : cur));
    await fetch("/api/notes-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
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
      setMaintMsg(`${j.archived} note قدیمی‌تر از ${j.days} روز archive شد.`);
    } else {
      setMaintMsg("خطا در اجرا");
    }
  };

  if (loading || !s) return <Card>Loading…</Card>;

  const asBool = (v: string) => v.toLowerCase() !== "false" && v !== "";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="text-sm font-medium mb-3">🕵️ AI Watchlist</div>
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
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">🧹 نگهداری</div>
        <NumberRow
          label="archive خودکار note های قدیمی‌تر از (روز)"
          help="0 یعنی هرگز archive نکن. اگه عددی بذاری، یه sweep خودکار به‌مرور note ها رو archive می‌کنه."
          value={s.notesAutoArchiveDays}
          onChange={(v) => save({ notesAutoArchiveDays: v })}
          min={0}
          max={3650}
        />
        <div className="border-t border-[var(--color-border)] mt-3 pt-3">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">
            پاک‌سازی دستی الان — هر note مهم‌تر از این تعداد روز archive می‌شه.
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="number"
              value={archiveDays}
              onChange={(e) => setArchiveDays(Number(e.target.value) || 0)}
              min={1}
              max={3650}
              className="w-24 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
            />
            <span className="text-[10px] text-[var(--color-text-dim)]">روز</span>
            <button
              onClick={runMaint}
              className="text-xs px-3 py-1 rounded-md bg-[var(--color-accent)] text-white"
            >
              پاک‌سازی الان
            </button>
            {maintMsg && (
              <span className="text-[11px] text-[var(--color-text-dim)]">
                {maintMsg}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">📨 خلاصه‌ی روزانه</div>
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
      </Card>
    </div>
  );
}

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
    <label className="flex items-start gap-3 cursor-pointer py-2 border-b border-[var(--color-border)] last:border-0">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {help && (
          <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
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
    <div className="flex items-start gap-3 py-2 border-b border-[var(--color-border)] last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {help && (
          <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
            {help}
          </div>
        )}
      </div>
      <input
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        onBlur={(e) => {
          if (e.target.value !== value) onChange(e.target.value);
        }}
        className="w-24 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
      />
    </div>
  );
}
