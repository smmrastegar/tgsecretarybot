"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

type Account = {
  id: number;
  platform: string;
  username: string;
  url: string | null;
  enabled: boolean;
  checkStories: boolean;
  checkPosts: boolean;
  checkReels: boolean;
  checkProfile: boolean;
  intervalMinutes: number;
  instagramUserId: string | null;
  lastCheckedAt: string | null;
  lastStoryAt: string | null;
  lastError: string | null;
};

type Event = {
  id: number;
  accountId: number;
  username: string | null;
  storyUrl: string | null;
  detectedAt: string;
  forwardedAt: string | null;
  status: string;
  error: string | null;
};

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 240, 480, 1440] as const;

export default function MonitoredPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/monitored");
      if (r.ok) {
        const j = (await r.json()) as { accounts: Account[]; events: Event[] };
        setAccounts(j.accounts);
        setEvents(j.events);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: number, body: Record<string, unknown>) {
    await fetch(`/api/monitored/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  }

  async function remove(id: number) {
    if (!confirm("این اکانت حذف بشه؟")) return;
    await fetch(`/api/monitored/${id}`, { method: "DELETE" });
    await load();
  }

  async function addManual() {
    const u = newUsername.trim().replace(/^@/, "");
    if (!u) return;
    setAdding(true);
    try {
      const r = await fetch("/api/monitored", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      if (r.ok) {
        setNewUsername("");
        await load();
      } else {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(j.error ?? "خطا");
      }
    } finally {
      setAdding(false);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      const r = await fetch("/api/monitored/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const j = (await r.json()) as {
        inserted?: number;
        updated?: number;
        parsed?: number;
        valid?: number;
        error?: string;
      };
      if (!r.ok) setImportMsg(`خطا: ${j.error ?? r.status}`);
      else {
        setImportMsg(
          `${j.inserted ?? 0} اضافه شد · ${j.updated ?? 0} آپدیت شد (از ${j.parsed} ردیف، ${j.valid} معتبر)`,
        );
        await load();
      }
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setTimeout(() => setImportMsg(null), 8000);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? accounts.filter((a) => a.username.toLowerCase().includes(q))
    : accounts;

  return (
    <Shell>
      <PageTitle
        title="📸 Instagram Monitor"
        subtitle="اکانت‌های public اینستاگرام رو هر چند دقیقه چک می‌کنه. استوری / پست / ریلز جدید دانلود و توی چتی که role=storage هست پست می‌شه. برای فعال شدن، HIKER_API_KEY روی Vercel ست بشه."
      />

      <Card className="mb-3 !p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <input
            dir="ltr"
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="username اینستاگرام (بدون @)"
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs flex-1 min-w-[180px]"
          />
          <button
            onClick={addManual}
            disabled={adding || !newUsername.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {adding ? "…" : "+ افزودن"}
          </button>
          <label className="px-3 py-1.5 rounded-md border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-2)]">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.currentTarget.value = "";
              }}
              className="hidden"
            />
            {importing ? "آپلود…" : "📤 CSV"}
          </label>
          <input
            dir="auto"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو…"
            className="ml-auto bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
          />
        </div>
        {importMsg && (
          <div className="text-[11px] mt-2 text-emerald-400">{importMsg}</div>
        )}
      </Card>

      {loading ? (
        <Card>Loading…</Card>
      ) : accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            اکانتی نیست. یکی اضافه کن یا CSV آپلود کن.
          </p>
        </Card>
      ) : (
        <Card className="mb-4">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">
            {filtered.length} از {accounts.length} اکانت
          </div>
          <div className="flex flex-col gap-2">
            {filtered.map((a) => (
              <div
                key={a.id}
                className="text-xs p-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/40"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) =>
                      patch(a.id, { enabled: e.target.checked })
                    }
                    title={a.enabled ? "روشن" : "خاموش"}
                  />
                  <a
                    href={a.url ?? `https://instagram.com/${a.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline"
                  >
                    @{a.username}
                  </a>
                  {a.lastCheckedAt ? (
                    <span className="text-[10px] text-[var(--color-text-dim)]">
                      چک: {relTime(a.lastCheckedAt)}
                    </span>
                  ) : (
                    <Badge tone="neutral">هنوز چک نشده</Badge>
                  )}
                  {a.lastStoryAt && (
                    <Badge tone="info">
                      آخرین: {relTime(a.lastStoryAt)}
                    </Badge>
                  )}
                  {a.lastError && (
                    <Badge tone="danger" >خطا</Badge>
                  )}
                  <button
                    onClick={() => remove(a.id)}
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-red-900/40"
                  >
                    🗑
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]">
                  {(
                    [
                      ["checkStories", "📸 stories", a.checkStories],
                      ["checkPosts", "🖼 posts", a.checkPosts],
                      ["checkReels", "🎬 reels", a.checkReels],
                      ["checkProfile", "👤 profile", a.checkProfile],
                    ] as const
                  ).map(([key, label, value]) => (
                    <label key={key} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) =>
                          patch(a.id, { [key]: e.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <span className="text-[var(--color-text-dim)]">
                    هر
                  </span>
                  <select
                    value={a.intervalMinutes}
                    onChange={(e) =>
                      patch(a.id, {
                        intervalMinutes: Number(e.target.value),
                      })
                    }
                    className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
                  >
                    {INTERVAL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m < 60
                          ? `${m} دقیقه`
                          : m === 60
                            ? "۱ ساعت"
                            : m === 1440
                              ? "۲۴ ساعت"
                              : `${m / 60} ساعت`}
                      </option>
                    ))}
                  </select>
                  {a.lastError && (
                    <span
                      dir="auto"
                      className="text-[10px] text-red-400 truncate min-w-0"
                      title={a.lastError}
                    >
                      {a.lastError.slice(0, 80)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <div className="text-sm font-medium mb-2">📬 رویدادهای اخیر</div>
          <div className="flex flex-col gap-1">
            {events.slice(0, 50).map((e) => (
              <div
                key={e.id}
                className="text-xs flex items-center gap-2 p-1.5 border border-[var(--color-border)] rounded-md flex-wrap"
              >
                <span className="text-[var(--color-text-dim)]">
                  {relTime(e.detectedAt)}
                </span>
                <span className="font-medium">@{e.username ?? e.accountId}</span>
                {e.storyUrl && (
                  <a
                    href={e.storyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-blue-400 truncate min-w-0"
                  >
                    {e.storyUrl}
                  </a>
                )}
                <Badge
                  tone={
                    e.status === "forwarded"
                      ? "success"
                      : e.status === "error"
                        ? "danger"
                        : "info"
                  }
                >
                  {e.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  );
}
