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

export default function MonitoredPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

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

  async function toggleEnabled(id: number, enabled: boolean) {
    await fetch(`/api/monitored/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function remove(id: number) {
    if (!confirm("این اکانت حذف بشه؟")) return;
    await fetch(`/api/monitored/${id}`, { method: "DELETE" });
    await load();
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
      if (!r.ok) {
        setImportMsg(`خطا: ${j.error ?? r.status}`);
      } else {
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
  const filteredAccounts = q
    ? accounts.filter((a) => a.username.toLowerCase().includes(q))
    : accounts;

  return (
    <Shell>
      <PageTitle
        title="📸 Instagram Stories Monitor"
        subtitle="هر چند دقیقه چک می‌کنه ببینه این اکانت‌ها استوری جدید گذاشتن یا نه. اگه گذاشتن، لینک رو به اولین چتی که نقشش downloader هست می‌فرسته."
      />

      <Card className="mb-3 !p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <label className="px-3 py-1.5 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white cursor-pointer hover:opacity-90">
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
            {importing ? "در حال آپلود…" : "📤 آپلود CSV"}
          </label>
          <span className="text-[var(--color-text-dim)]">
            ستون‌های مورد انتظار: id, type, param, url, created_at, topic_id
          </span>
          <input
            dir="auto"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در username…"
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
            اکانتی ست نشده. CSV رو آپلود کن تا اضافه شه.
          </p>
        </Card>
      ) : (
        <Card className="mb-4">
          <div className="text-xs text-[var(--color-text-dim)] mb-2">
            {filteredAccounts.length} از {accounts.length} اکانت
          </div>
          <div className="flex flex-col gap-1">
            {filteredAccounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 text-xs p-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={(e) => toggleEnabled(a.id, e.target.checked)}
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
                <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">
                  {a.lastCheckedAt ? `چک: ${relTime(a.lastCheckedAt)}` : "هنوز چک نشده"}
                </span>
                {a.lastStoryAt && (
                  <Badge tone="info">آخرین استوری: {relTime(a.lastStoryAt)}</Badge>
                )}
                {a.lastError && (
                  <Badge tone="danger" >خطا</Badge>
                )}
                <button
                  onClick={() => remove(a.id)}
                  className="text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-red-900/40"
                >
                  🗑
                </button>
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
