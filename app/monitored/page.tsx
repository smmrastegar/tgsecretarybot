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

type ChatBrief = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

type Defaults = {
  intervalMinutes: number;
  checkStories: boolean;
  checkPosts: boolean;
  checkReels: boolean;
  checkProfile: boolean;
};

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120, 240, 480, 1440] as const;

function intervalLabel(m: number): string {
  if (m < 60) return `${m} دقیقه`;
  if (m === 60) return "۱ ساعت";
  if (m === 1440) return "۲۴ ساعت";
  return `${m / 60} ساعت`;
}

function chatLabel(c: ChatBrief): string {
  return (
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.nickname ||
    c.chatTitle ||
    `chat ${c.chatId}`
  );
}

export default function MonitoredPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [storageChats, setStorageChats] = useState<ChatBrief[]>([]);
  const [downloaderChats, setDownloaderChats] = useState<ChatBrief[]>([]);
  const [targetChatId, setTargetChatId] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({
    intervalMinutes: 30,
    checkStories: true,
    checkPosts: false,
    checkReels: false,
    checkProfile: false,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/monitored");
      if (r.ok) {
        const j = (await r.json()) as {
          accounts: Account[];
          events: Event[];
          storageChats: ChatBrief[];
          downloaderChats: ChatBrief[];
          targetChatId: number | null;
          defaults: Defaults;
        };
        setAccounts(j.accounts);
        setEvents(j.events);
        setStorageChats(j.storageChats);
        setDownloaderChats(j.downloaderChats);
        setTargetChatId(j.targetChatId);
        setDefaults(j.defaults);
        setSelected(new Set());
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
    setImportMsg(null);
    try {
      const r = await fetch("/api/monitored", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          detected?: number;
          forwarded?: number;
          errors?: string[];
        };
        setNewUsername("");
        if (j.forwarded && j.forwarded > 0) {
          setImportMsg(`@${u} اضافه شد + ${j.forwarded} مورد forward شد`);
        } else if (j.errors && j.errors.length > 0) {
          setImportMsg(`@${u} اضافه شد ولی خطا: ${j.errors[0]}`);
        } else {
          setImportMsg(`@${u} اضافه شد`);
        }
        setTimeout(() => setImportMsg(null), 8000);
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
        const jx = j as typeof j & {
          immediatelyProcessed?: number;
          detected?: number;
          forwarded?: number;
        };
        let msg = `${jx.inserted ?? 0} اضافه شد · ${jx.updated ?? 0} آپدیت شد`;
        if (jx.immediatelyProcessed && jx.immediatelyProcessed > 0) {
          msg += ` · ${jx.immediatelyProcessed} فوراً پردازش شد (${jx.forwarded ?? 0} forward)`;
        }
        setImportMsg(msg);
        await load();
      }
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setTimeout(() => setImportMsg(null), 8000);
    }
  }

  async function saveDefaults(next: Partial<Defaults>) {
    const merged = { ...defaults, ...next };
    setDefaults(merged);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorDefaultIntervalMinutes: String(merged.intervalMinutes),
        monitorDefaultCheckStories: String(merged.checkStories),
        monitorDefaultCheckPosts: String(merged.checkPosts),
        monitorDefaultCheckReels: String(merged.checkReels),
        monitorDefaultCheckProfile: String(merged.checkProfile),
      }),
    });
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? accounts.filter((a) => a.username.toLowerCase().includes(q))
    : accounts;

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((a) => a.id)));
  }

  async function runBulk(
    op: "update" | "delete",
    patch?: Record<string, unknown>,
  ) {
    if (selected.size === 0) return;
    if (op === "delete" && !confirm(`${selected.size} اکانت حذف بشن؟`)) return;
    setBulking(true);
    try {
      const r = await fetch("/api/monitored/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected], patch }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`خطا: ${j.error ?? r.status}`);
      } else {
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  return (
    <Shell>
      <PageTitle
        title="📸 Instagram Monitor"
        subtitle="استوری / پست / ریلز اکانت‌های public اینستاگرام رو دانلود و توی کانال storage پست می‌کنه."
      />

      <Card className="mb-3 !p-3">
        <div className="text-sm font-medium mb-2">📦 کانال‌های Storage</div>
        {storageChats.length === 0 && downloaderChats.length === 0 ? (
          <div className="text-[11px] text-red-300">
            ⚠️ هیچ کانالی با role=storage ست نشده. برو /chats و یه کانال رو role
            «📦 Storage» بده.
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-[11px]">
            {storageChats.map((c) => (
              <div
                key={c.chatId}
                className="flex items-center gap-2 p-1.5 border border-[var(--color-border)] rounded-md"
              >
                <Badge tone="info">📦</Badge>
                <a
                  href={`/chats/${c.chatId}`}
                  className="font-medium hover:underline"
                >
                  {chatLabel(c)}
                </a>
                {targetChatId === c.chatId && (
                  <Badge tone="success">✓ فعال</Badge>
                )}
              </div>
            ))}
            {storageChats.length === 0 &&
              downloaderChats.map((c) => (
                <div
                  key={c.chatId}
                  className="flex items-center gap-2 p-1.5 border border-[var(--color-border)] rounded-md"
                >
                  <Badge tone="info">📥</Badge>
                  <a
                    href={`/chats/${c.chatId}`}
                    className="font-medium hover:underline"
                  >
                    {chatLabel(c)}
                  </a>
                  {targetChatId === c.chatId && (
                    <Badge tone="warn">fallback</Badge>
                  )}
                </div>
              ))}
            <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
              اولین storage chat به‌عنوان مقصد استفاده می‌شه. اگه storage نباشه،
              اولین downloader fallback می‌شه.
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-3 !p-3">
        <div className="text-sm font-medium mb-2">⚙️ پیش‌فرض اکانت‌های جدید</div>
        <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
          وقتی اکانت جدید اضافه می‌کنی (دستی یا CSV)، با این پیش‌فرض‌ها ساخته می‌شه.
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          {(
            [
              ["checkStories", "📸 stories"],
              ["checkPosts", "🖼 posts"],
              ["checkReels", "🎬 reels"],
              ["checkProfile", "👤 profile"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={defaults[key]}
                onChange={(e) => saveDefaults({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <span className="text-[var(--color-text-dim)]">هر</span>
          <select
            value={defaults.intervalMinutes}
            onChange={(e) =>
              saveDefaults({ intervalMinutes: Number(e.target.value) })
            }
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
          >
            {INTERVAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {intervalLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="mb-3 !p-3">
        <div className="text-sm font-medium mb-2">➕ اضافه کردن اکانت</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            dir="ltr"
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addManual();
            }}
            placeholder="username اینستاگرام (مثل ali_chaychi_)"
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm flex-1 min-w-[200px]"
          />
          <button
            onClick={addManual}
            disabled={adding || !newUsername.trim()}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {adding ? "در حال افزودن…" : "+ افزودن"}
          </button>
          <span className="text-[var(--color-text-dim)] text-[10px]">یا</span>
          <label className="px-3 py-2 rounded-md border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-surface-2)] text-xs">
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
            {importing ? "آپلود…" : "📤 آپلود CSV"}
          </label>
        </div>
        {importMsg && (
          <div className="text-[11px] mt-2 text-emerald-400">{importMsg}</div>
        )}
      </Card>

      <Card className="mb-3 !p-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <input
            dir="auto"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجو در username…"
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 flex-1 min-w-[140px]"
          />
          <button
            onClick={selectAllFiltered}
            disabled={filtered.length === 0}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            انتخاب همه ({filtered.length})
          </button>
          <button
            onClick={() => {
              const errs = filtered
                .filter((a) => a.lastError)
                .map((a) => a.id);
              setSelected(new Set(errs));
            }}
            disabled={
              filtered.filter((a) => a.lastError).length === 0
            }
            className="px-2 py-1 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
            title="فقط اکانت‌هایی که خطا دارن انتخاب کن"
          >
            ⚠️ خطاها ({filtered.filter((a) => a.lastError).length})
          </button>
          <button
            onClick={async () => {
              const errs = filtered
                .filter((a) => a.lastError)
                .map((a) => a.id);
              if (errs.length === 0) return;
              if (!confirm(`${errs.length} اکانت خطاخورده ریست بشه؟`))
                return;
              setBulking(true);
              try {
                const r = await fetch("/api/monitored/bulk", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    op: "update",
                    ids: errs,
                    patch: { resetError: true },
                  }),
                });
                if (!r.ok) {
                  const j = (await r.json().catch(() => ({}))) as {
                    error?: string;
                  };
                  alert(`خطا: ${j.error ?? r.status}`);
                } else {
                  await load();
                }
              } finally {
                setBulking(false);
              }
            }}
            disabled={
              bulking ||
              filtered.filter((a) => a.lastError).length === 0
            }
            className="px-2 py-1 rounded-md border border-amber-700 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50 disabled:opacity-50"
            title="همه‌ی اکانت‌های خطاخورده رو با یک کلیک ریست کن"
          >
            🔁 ریست همه‌ی خطاها
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
          >
            Clear
          </button>
          <span className="text-[var(--color-text-dim)]">
            {selected.size} انتخاب شده
          </span>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] mt-2 pt-2 border-t border-[var(--color-border)]">
            <button
              onClick={() => runBulk("update", { enabled: true })}
              disabled={bulking}
              className="px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
            >
              ▶ روشن کردن همه
            </button>
            <button
              onClick={() => runBulk("update", { enabled: false })}
              disabled={bulking}
              className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              ⏸ خاموش کردن همه
            </button>
            <select
              disabled={bulking}
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                void runBulk("update", { intervalMinutes: Number(v) });
                e.currentTarget.value = "";
              }}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-1"
            >
              <option value="">⏱ ست interval…</option>
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {intervalLabel(m)}
                </option>
              ))}
            </select>
            {(
              [
                ["checkStories", "📸 stories"],
                ["checkPosts", "🖼 posts"],
                ["checkReels", "🎬 reels"],
                ["checkProfile", "👤 profile"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1">
                <button
                  onClick={() => runBulk("update", { [key]: true })}
                  disabled={bulking}
                  className="px-1.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                >
                  + {label}
                </button>
                <button
                  onClick={() => runBulk("update", { [key]: false })}
                  disabled={bulking}
                  className="px-1.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                  title={`${label} خاموش`}
                >
                  −
                </button>
              </div>
            ))}
            <button
              onClick={() => runBulk("update", { resetError: true })}
              disabled={bulking}
              className="px-2 py-1 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30"
              title="last_error رو پاک می‌کنه و forceفها چک می‌کنه"
            >
              🔁 ریست خطاها
            </button>
            <button
              onClick={() => runBulk("delete")}
              disabled={bulking}
              className="px-2 py-1 rounded-md border border-red-800 text-red-300 hover:bg-red-900/30"
            >
              🗑 حذف همه
            </button>
          </div>
        )}
      </Card>

      {loading ? (
        <Card>Loading…</Card>
      ) : accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">
            اکانتی نیست. بالا یکی اضافه کن یا CSV آپلود کن.
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
                className={`text-xs p-2 rounded-md border ${
                  selected.has(a.id)
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/40"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggleSelect(a.id)}
                    title="انتخاب برای bulk"
                  />
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
                  {a.lastError && <Badge tone="danger">خطا</Badge>}
                  {a.lastError && (
                    <button
                      onClick={() => patch(a.id, { resetError: true })}
                      title="ریست خطا و چک فوری توی cron بعدی"
                      className="text-[10px] px-1.5 py-0.5 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30"
                    >
                      🔁
                    </button>
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
                    <label
                      key={key}
                      className="flex items-center gap-1 cursor-pointer"
                    >
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
                  <span className="text-[var(--color-text-dim)]">هر</span>
                  <select
                    value={a.intervalMinutes}
                    onChange={(e) =>
                      patch(a.id, { intervalMinutes: Number(e.target.value) })
                    }
                    className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
                  >
                    {INTERVAL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {intervalLabel(m)}
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
