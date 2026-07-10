"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

const EVENTS_PAGE_SIZE = 10;

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
  checkMentioned: boolean;
  intervalMinutes: number;
  mode: "interval" | "notify";
  lastNotifyAt: string | null;
  pendingFetchAt: string | null;
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
  checkMentioned: boolean;
};

// The owner asked for ONLY four options on Instagram polling:
// 3h / 6h / 12h / 24h, all anchored to Asia/Tehran peak hours.
//
// Hard rule from the operator: intervals SHORTER than 12 hours
// (3h, 6h) must NEVER run during the very-late-night quiet window
// of 02:00–08:00 Tehran. The schedules below respect that — the
// earliest sub-12h trigger is 09:00, and the latest is 22:00.
//
//   3h  → ساعت‌های ۹، ۱۲، ۱۵، ۱۸، ۲۱ تهران (۵ بار)
//   6h  → ساعت‌های ۱۰، ۱۶، ۲۲ تهران (۳ بار)
//   12h → ساعت‌های ۱۰، ۲۲ تهران (۲ بار)
//   24h → ساعت ۱۹ تهران (۱ بار)
//
// Must stay in sync with dueMonitoredAccounts in lib/db.ts.
const INTERVAL_OPTIONS = [180, 360, 720, 1440] as const;

const TEHRAN_TRIGGER_HOURS: Record<number, number[]> = {
  180: [9, 12, 15, 18, 21],
  360: [10, 16, 22],
  720: [10, 22],
  1440: [19],
};

function intervalLabel(m: number): string {
  if (m < 60) return `${m} دقیقه`;
  if (m === 60) return "۱ ساعت";
  if (m === 1440) return "۲۴ ساعت (روزانه)";
  if (m % 60 === 0) return `${m / 60} ساعت`;
  return `${m} دقیقه`;
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
    intervalMinutes: 720,
    checkStories: true,
    checkPosts: false,
    checkReels: false,
    checkProfile: false,
    checkMentioned: false,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
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
        // Initial events page is 10 — even if /api/monitored hands us
        // more on the first call, only show the head and let the
        // scroll loader bring the rest in.
        const head = (j.events ?? []).slice(0, EVENTS_PAGE_SIZE);
        setEvents(head);
        setEventsHasMore((j.events ?? []).length >= EVENTS_PAGE_SIZE);
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

  type Usage = {
    configured?: boolean;
    balanceUsd?: number | null;
    rateLimitPerSec?: number | null;
  };
  type BudgetState = {
    spentUsd: number;
    approvedUsd: number;
    budgetUsd: number;
    stepUsd: number;
    costPerCallUsd: number;
    needsApproval: boolean;
    budgetExceeded: boolean;
    nextThresholdUsd: number;
  };
  type Bucket = { at: string; calls: number; costUsd: number };
  type Window = { calls: number; costUsd: number };
  type Summary = {
    lastHour: Window;
    today: Window;
    last7d: Window;
    last30d: Window;
    allTime: Window;
  };
  type HikerCall = {
    id: number;
    calledAt: string;
    endpoint: string;
    costUsd: number;
    accountId: number | null;
  };
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageOutOfCredits, setUsageOutOfCredits] = useState<{
    message: string;
    billingUrl: string;
  } | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [keyPrefix, setKeyPrefix] = useState<string | null>(null);
  const [keySource, setKeySource] = useState<"tenant" | "db" | "env" | null>(null);
  const [keyName, setKeyName] = useState<string | null>(null);
  type Diagnose = {
    keyPrefix: string | null;
    keyLoaded: boolean;
    keySource: "tenant" | "db" | "env" | null;
    keyName: string | null;
    probes: Array<{
      path: string;
      ok: boolean;
      transient?: boolean;
      status: number;
      body: string;
      attempts?: number;
    }>;
  };
  const [diagnose, setDiagnose] = useState<Diagnose | null>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyNameInput, setKeyNameInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [budget, setBudget] = useState<BudgetState | null>(null);
  const [budgetSummary, setBudgetSummary] = useState<Summary | null>(null);
  const [budgetHourly, setBudgetHourly] = useState<Bucket[]>([]);
  const [budgetDaily, setBudgetDaily] = useState<Bucket[]>([]);
  const [budgetWeekly, setBudgetWeekly] = useState<Bucket[]>([]);
  const [budgetMonthly, setBudgetMonthly] = useState<Bucket[]>([]);
  const [budgetRecent, setBudgetRecent] = useState<HikerCall[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [approving, setApproving] = useState(false);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    setUsageOutOfCredits(null);
    try {
      const r = await fetch("/api/monitored/usage");
      const j = (await r.json().catch(() => ({}))) as {
        configured?: boolean;
        error?: string;
        outOfCredits?: boolean;
        message?: string;
        billingUrl?: string;
        balanceUsd?: number | null;
        rateLimitPerSec?: number | null;
        keyPrefix?: string | null;
        keySource?: "tenant" | "db" | "env" | null;
        keyName?: string | null;
      };
      if (j.keyPrefix !== undefined) setKeyPrefix(j.keyPrefix);
      if (j.keySource !== undefined) setKeySource(j.keySource ?? null);
      if (j.keyName !== undefined) setKeyName(j.keyName ?? null);
      if (r.status === 402 && j.outOfCredits) {
        setUsageOutOfCredits({
          message: j.message ?? "Insufficient credits",
          billingUrl: j.billingUrl ?? "https://hikerapi.com/billing",
        });
      } else if (!r.ok) {
        setUsageError(j.error ?? `${r.status}`);
      } else {
        setUsage({
          configured: j.configured,
          balanceUsd: j.balanceUsd ?? null,
          rateLimitPerSec: j.rateLimitPerSec ?? null,
        });
      }
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const runDiagnose = useCallback(async () => {
    setDiagnoseLoading(true);
    try {
      const r = await fetch("/api/monitored/usage/diagnose");
      if (r.ok) {
        const j = (await r.json()) as Diagnose;
        setDiagnose(j);
        if (j.keyPrefix !== undefined) setKeyPrefix(j.keyPrefix);
        if (j.keySource !== undefined) setKeySource(j.keySource ?? null);
        if (j.keyName !== undefined) setKeyName(j.keyName ?? null);
        // If any probe came back 2xx (or was clearly transient and
        // not "key broken"), clear the stale 402 banner — the key
        // itself is fine.
        if (j.probes.some((p) => p.ok || p.transient)) {
          setUsageOutOfCredits(null);
          setUsageError(null);
          await loadUsage();
        }
      }
    } finally {
      setDiagnoseLoading(false);
    }
  }, [loadUsage]);

  async function saveKey() {
    setSavingKey(true);
    try {
      const r = await fetch("/api/monitored/usage/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput.trim(), name: keyNameInput.trim() }),
      });
      if (r.ok) {
        setKeyInput("");
        setKeyDialog(false);
        setUsageOutOfCredits(null);
        setUsageError(null);
        await loadUsage();
        await runDiagnose();
      } else {
        alert("خطا در ذخیره کلید");
      }
    } finally {
      setSavingKey(false);
    }
  }

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const r = await fetch("/api/monitored/budget");
      if (!r.ok) return;
      const j = (await r.json()) as {
        state: BudgetState;
        summary: Summary;
        hourly: Bucket[];
        daily: Bucket[];
        weekly: Bucket[];
        monthly: Bucket[];
        recent: HikerCall[];
      };
      setBudget(j.state);
      setBudgetSummary(j.summary);
      setBudgetHourly(j.hourly);
      setBudgetDaily(j.daily);
      setBudgetWeekly(j.weekly);
      setBudgetMonthly(j.monthly);
      setBudgetRecent(j.recent);
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  async function approveNext(opts?: {
    absolute?: number;
    extendBudget?: boolean;
    budgetUsd?: number;
  }) {
    setApproving(true);
    try {
      const body: Record<string, unknown> = {};
      if (opts?.absolute != null) body.approvedUsd = opts.absolute;
      if (opts?.extendBudget) body.extendBudget = true;
      if (opts?.budgetUsd != null) body.budgetUsd = opts.budgetUsd;
      const r = await fetch("/api/monitored/budget/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const j = (await r.json()) as { state: BudgetState };
        setBudget(j.state);
        const note =
          j.state.budgetUsd !== budget?.budgetUsd
            ? `✅ تخصیص $${j.state.approvedUsd.toFixed(2)} · سقف به $${j.state.budgetUsd.toFixed(2)} رسید`
            : `✅ تخصیص تا $${j.state.approvedUsd.toFixed(2)}`;
        setImportMsg(note);
        setTimeout(() => setImportMsg(null), 5000);
        await loadBudget();
      } else {
        alert("خطا در تایید");
      }
    } finally {
      setApproving(false);
    }
  }

  const [refreshing, setRefreshing] = useState<Set<number>>(new Set());
  const [refreshDialog, setRefreshDialog] = useState<{
    accountId: number;
    username: string;
    stories: boolean;
    posts: boolean;
    reels: boolean;
    mentioned: boolean;
    countStories: number;
    countPosts: number;
    countReels: number;
    countMentioned: number;
  } | null>(null);

  function openRefreshDialog(a: Account) {
    setRefreshDialog({
      accountId: a.id,
      username: a.username,
      stories: a.checkStories || true,
      posts: a.checkPosts,
      reels: a.checkReels,
      mentioned: a.checkMentioned,
      countStories: 3,
      countPosts: 3,
      countReels: 3,
      countMentioned: 3,
    });
  }

  async function runRefresh() {
    if (!refreshDialog) return;
    const d = refreshDialog;
    setRefreshDialog(null);
    setRefreshing((s) => new Set(s).add(d.accountId));
    try {
      const r = await fetch(`/api/monitored/${d.accountId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stories: d.stories,
          posts: d.posts,
          reels: d.reels,
          mentioned: d.mentioned,
          countStories: d.countStories,
          countPosts: d.countPosts,
          countReels: d.countReels,
          countMentioned: d.countMentioned,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        detected?: number;
        forwarded?: number;
        errors?: string[];
        error?: string;
        outOfCredits?: boolean;
        billingUrl?: string;
      };
      if (r.status === 402 && j.outOfCredits) {
        setUsageOutOfCredits({
          message: j.error ?? "Insufficient credits",
          billingUrl: j.billingUrl ?? "https://hikerapi.com/billing",
        });
      } else if (!r.ok) {
        alert(`خطا: ${j.error ?? r.status}`);
      } else if (j.forwarded && j.forwarded > 0) {
        setImportMsg(`${j.forwarded} مورد جدید forward شد`);
        setTimeout(() => setImportMsg(null), 6000);
      } else if (j.errors && j.errors.length > 0) {
        const first = j.errors[0]!;
        // Transient IG failures already retried internally — show as
        // a soft toast, not a blocking alert.
        if (/transient/i.test(first)) {
          setImportMsg(`⏳ Instagram جواب نداد، cron بعدی دوباره تلاش می‌کنه`);
          setTimeout(() => setImportMsg(null), 6000);
        } else {
          alert(`خطا: ${first}`);
        }
      } else {
        setImportMsg("چیز جدیدی نبود (همه قبلاً forward شدن)");
        setTimeout(() => setImportMsg(null), 4000);
      }
      await load();
      await loadBudget();
    } finally {
      setRefreshing((s) => {
        const next = new Set(s);
        next.delete(d.accountId);
        return next;
      });
    }
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
          outOfCredits?: boolean;
          billingUrl?: string;
        };
        setNewUsername("");
        if (j.outOfCredits) {
          setUsageOutOfCredits({
            message: j.errors?.[0] ?? "Insufficient credits",
            billingUrl: j.billingUrl ?? "https://hikerapi.com/billing",
          });
          setImportMsg(`@${u} اضافه شد ولی کردیت HikerAPI تموم شده — بالا شارژ کن`);
        } else if (j.forwarded && j.forwarded > 0) {
          setImportMsg(`@${u} اضافه شد + ${j.forwarded} مورد forward شد`);
        } else if (j.errors && j.errors.length > 0) {
          setImportMsg(`@${u} اضافه شد ولی خطا: ${j.errors[0]}`);
        } else {
          setImportMsg(`@${u} اضافه شد`);
        }
        setTimeout(() => setImportMsg(null), 8000);
        await load();
        await loadBudget();
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
        outOfCredits?: boolean;
        billingUrl?: string;
        errors?: string[];
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
        if (j.outOfCredits) {
          setUsageOutOfCredits({
            message: j.errors?.[0] ?? "Insufficient credits",
            billingUrl: j.billingUrl ?? "https://hikerapi.com/billing",
          });
          msg += " · ⚠️ کردیت HikerAPI تموم شد";
        }
        setImportMsg(msg);
        await load();
        await loadBudget();
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
        monitorDefaultCheckMentioned: String(merged.checkMentioned),
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
        title="📸 پایش اینستاگرام"
        subtitle="استوری / پست / ریلز اکانت‌های public اینستاگرام رو دانلود و توی کانال storage پست می‌کنه."
      />

      <Card
        className={`mb-3 !p-3 ${
          usageOutOfCredits
            ? "!border-amber-600 !bg-amber-900/20"
            : ""
        }`}
      >
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="text-sm font-medium">
            {usageOutOfCredits ? "💸 HikerAPI پاسخ ۴۰۲ می‌ده" : "💳 مصرف HikerAPI"}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {keyPrefix ? (
              <span
                dir="ltr"
                className="text-[10px] text-[var(--color-text-dim)] font-mono"
                title="کلیدی که سرور الان داره استفاده می‌کنه"
              >
                {keyName ? `${keyName} ` : ""}key: {keyPrefix}
                {keySource && (
                  <span
                    className={`mx-1 px-1 rounded ${
                      keySource === "db"
                        ? "bg-emerald-900/40 text-emerald-300"
                        : "bg-blue-900/40 text-blue-300"
                    }`}
                  >
                    {keySource}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[10px] text-red-300">
                ⚠️ کلیدی ست نشده
              </span>
            )}
            <button
              onClick={() => {
                setKeyInput("");
                setKeyNameInput(keyName ?? "");
                setKeyDialog(true);
              }}
              title="کلید HikerAPI رو از همینجا ست کن — بدون redeploy"
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              🔑 کلید
            </button>
            <button
              onClick={runDiagnose}
              disabled={diagnoseLoading}
              title="هر سه probe رو raw اجرا می‌کنه + اگه یکی OK بود banner ۴۰۲ رو پاک می‌کنه"
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {diagnoseLoading ? "…" : "🩺 تشخیص"}
            </button>
            <button
              onClick={loadUsage}
              disabled={usageLoading}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {usageLoading ? "…" : "🔄"}
            </button>
          </div>
        </div>
        {usageOutOfCredits ? (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] text-amber-200">
              HikerAPI روی probe (مثل <span dir="ltr">/v1/auth/me</span>) خطای
              ۴۰۲ <code>InsufficientFunds</code> برمی‌گردونه. این
              <strong> همیشه </strong>
              یعنی Balance صفره — گاهی فقط یعنی Plan فعال نداری حتی اگه Balance
              مثبته. اول 🩺 «تشخیص» بزن، اگه یکی از probeها 2xx شد
              این banner پاک می‌شه. اگه واقعاً همه ۴۰۲ بودن، توی dashboard هم
              Plan رو فعال کن + هم Balance رو شارژ کن.
            </div>
            <div
              dir="ltr"
              className="text-[10px] text-amber-300/70 break-all font-mono"
            >
              {usageOutOfCredits.message}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={usageOutOfCredits.billingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-md bg-amber-500 text-black font-medium hover:bg-amber-400"
              >
                💳 hikerapi.com/billing →
              </a>
              <a
                href="https://hikerapi.com/profile"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-md border border-amber-700 text-amber-200 hover:bg-amber-900/40"
              >
                ⚙️ فعال‌سازی Plan
              </a>
            </div>
          </div>
        ) : usageError ? (
          <div className="text-[11px] text-red-300 break-all">
            {usageError}
          </div>
        ) : usage?.configured ? (
          <div className="flex items-center gap-4 flex-wrap text-[12px]">
            {usage.balanceUsd != null ? (
              <span>
                <span className="text-[var(--color-text-dim)]">💰 موجودی:</span>{" "}
                <strong className="text-emerald-300 tabular-nums">
                  ${usage.balanceUsd.toFixed(2)}
                </strong>
                <span className="text-[10px] text-[var(--color-text-dim)] mr-1">
                  (از /sys/balance)
                </span>
              </span>
            ) : (
              <span className="text-emerald-300">
                ✅ کلید فعاله (موجودی برگشت نخورد)
              </span>
            )}
            {usage.rateLimitPerSec != null && (
              <span>
                <span className="text-[var(--color-text-dim)]">نرخ:</span>{" "}
                <strong className="tabular-nums">
                  {usage.rateLimitPerSec}/sec
                </strong>
              </span>
            )}
            <span className="text-[10px] text-[var(--color-text-dim)]">
              · هزینه‌ی $ تخمینی از کارت بودجه پایین
            </span>
          </div>
        ) : (
          <div className="text-[11px] text-red-300">
            ⚠️ کلید HikerAPI ست نشده — 🔑 «کلید» رو بزن.
          </div>
        )}
        {diagnose && (
          <div className="mt-3 pt-2 border-t border-[var(--color-border)]">
            <div className="text-[11px] font-medium mb-1">
              🩺 نتایج تشخیص
            </div>
            <div className="text-[10px] mb-2">
              <span className="text-[var(--color-text-dim)]">کلید لود شده:</span>{" "}
              <span dir="ltr" className="font-mono">
                {diagnose.keyLoaded
                  ? diagnose.keyPrefix ?? "(loaded)"
                  : "❌ env nis لود نشده"}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {diagnose.probes.map((p) => {
                const tone = p.ok
                  ? "border-emerald-700 bg-emerald-900/20"
                  : p.transient
                    ? "border-amber-700 bg-amber-900/20"
                    : "border-red-700 bg-red-900/20";
                const icon = p.ok ? "✓" : p.transient ? "⏳" : "✗";
                const iconColor = p.ok
                  ? "text-emerald-400"
                  : p.transient
                    ? "text-amber-300"
                    : "text-red-400";
                return (
                  <div
                    key={p.path}
                    dir="ltr"
                    className={`text-[10px] p-1.5 rounded-md border ${tone}`}
                  >
                    <div className="flex items-center gap-2 font-mono">
                      <span className={iconColor}>
                        {icon} {p.status || "?"}
                      </span>
                      <span className="font-medium">{p.path}</span>
                      {p.attempts && p.attempts > 1 && (
                        <span className="text-[var(--color-text-dim)]">
                          ({p.attempts} attempts)
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-[var(--color-text-dim)] mt-0.5 break-all font-mono">
                      {p.body}
                    </div>
                  </div>
                );
              })}
            </div>
            {diagnose.probes.some((p) => p.transient) && (
              <div className="text-[10px] text-amber-200 mt-2 leading-relaxed" dir="rtl">
                ⏳ Instagram خودش الان جواب نمی‌ده ({"InstagramServerError"}) —
                به کلید یا حساب تو ربطی نداره. cron بعدی دوباره تلاش می‌کنه. اگه
                چند بار پشت سر هم اتفاق افتاد، چند دقیقه صبر کن و دوباره
                «🩺 تشخیص» بزن.
              </div>
            )}
            <div className="text-[9px] text-[var(--color-text-dim)] mt-2" dir="rtl">
              نکته: اگه کلیدی که اینجا می‌بینی همون کلید درستی نیست که توی
              hikerapi dashboard داری، یعنی Vercel env یا redeploy نشده یا کلید
              قدیمیه. کلید رو از 🔑 «کلید» همینجا می‌تونی ست کنی.
            </div>
          </div>
        )}
      </Card>

      <Card
        className={`mb-3 !p-3 ${
          budget?.budgetExceeded
            ? "!border-red-700 !bg-red-900/20"
            : budget?.needsApproval
              ? "!border-amber-600 !bg-amber-900/20"
              : ""
        }`}
      >
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="text-sm font-medium">
            {budget?.budgetExceeded
              ? "🛑 سقف بودجه HikerAPI تمام شد"
              : budget?.needsApproval
                ? "⏸ نیاز به تایید برای ادامه‌ی هزینه"
                : "💵 بودجه HikerAPI (لاجیکال)"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBudgetDialog(true)}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              ⚙️ تنظیمات
            </button>
            <button
              onClick={loadBudget}
              disabled={budgetLoading}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {budgetLoading ? "…" : "🔄"}
            </button>
          </div>
        </div>
        {budget ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              <span>
                <span className="text-[var(--color-text-dim)]">خرج‌شده:</span>{" "}
                <strong>${budget.spentUsd.toFixed(4)}</strong>
              </span>
              <span>
                <span className="text-[var(--color-text-dim)]">مجاز تا:</span>{" "}
                <strong>${budget.approvedUsd.toFixed(2)}</strong>
              </span>
              <span>
                <span className="text-[var(--color-text-dim)]">سقف کلی:</span>{" "}
                <strong>${budget.budgetUsd.toFixed(2)}</strong>
              </span>
              <span className="text-[var(--color-text-dim)]">
                · checkpoint هر ${budget.stepUsd.toFixed(2)}
              </span>
            </div>
            {budgetSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px] mt-1">
                {(
                  [
                    ["⏰ ساعت اخیر", budgetSummary.lastHour],
                    ["📅 ۲۴ ساعت", budgetSummary.today],
                    ["🗓 ۷ روز", budgetSummary.last7d],
                    ["🗓 ۳۰ روز", budgetSummary.last30d],
                    ["Σ کل", budgetSummary.allTime],
                  ] as const
                ).map(([label, w]) => (
                  <div
                    key={label}
                    className="flex flex-col p-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                  >
                    <span className="text-[var(--color-text-dim)]">{label}</span>
                    <span className="font-semibold tabular-nums">
                      ${w.costUsd.toFixed(4)}
                    </span>
                    <span className="text-[var(--color-text-dim)]">
                      {w.calls.toLocaleString()} call
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden relative">
              <div
                className="absolute inset-y-0 left-0 bg-emerald-600/60"
                style={{
                  width: `${Math.min(
                    100,
                    (budget.approvedUsd / budget.budgetUsd) * 100,
                  )}%`,
                }}
                title={`مجاز: $${budget.approvedUsd.toFixed(2)}`}
              />
              <div
                className={`absolute inset-y-0 left-0 ${
                  budget.budgetExceeded
                    ? "bg-red-500"
                    : budget.needsApproval
                      ? "bg-amber-500"
                      : "bg-[var(--color-accent)]"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    (budget.spentUsd / budget.budgetUsd) * 100,
                  )}%`,
                }}
                title={`خرج: $${budget.spentUsd.toFixed(2)}`}
              />
            </div>
            {(budget.needsApproval || budget.budgetExceeded) && (
              <div className="text-[11px] text-amber-200">
                {budget.budgetExceeded
                  ? `سقف کل $${budget.budgetUsd.toFixed(2)} پر شد. cron متوقفه — با دکمه «+$10 + سقف» یه slice دیگه باز کن.`
                  : `خرج رسید به سقف مجاز $${budget.approvedUsd.toFixed(2)}. تا تخصیص ندی، cron و refresh ۴۰۲ می‌گیرن.`}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-[var(--color-text-dim)]">
                ⚡ تخصیص پیش‌فرض:
              </span>
              {/* Single +step button — always available, even before
                  spend hits the cap, so the owner can pre-allocate. */}
              <button
                onClick={() => approveNext()}
                disabled={
                  approving ||
                  budget.approvedUsd + 0.0001 >= budget.budgetUsd
                }
                className="text-[11px] px-2.5 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-40"
                title={`الان مجاز تا $${budget.approvedUsd.toFixed(2)} — بزن می‌ره +$${budget.stepUsd.toFixed(2)}`}
              >
                + ${budget.stepUsd.toFixed(2)} تخصیص
              </button>
              {/* Quick multi-step jumps. We compute targets in
                  multiples of step from current approved up to the
                  current cap. Hidden once we hit the cap. */}
              {(() => {
                const jumps: number[] = [];
                for (
                  let n = 2;
                  n <= 5 &&
                  budget.approvedUsd + budget.stepUsd * n <= budget.budgetUsd + 0.0001;
                  n++
                ) {
                  jumps.push(n);
                }
                return jumps.map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      approveNext({
                        absolute: Math.min(
                          budget.budgetUsd,
                          budget.approvedUsd + budget.stepUsd * n,
                        ),
                      })
                    }
                    disabled={approving}
                    className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
                    title={`بپر تا $${(budget.approvedUsd + budget.stepUsd * n).toFixed(2)}`}
                  >
                    +{n}×
                  </button>
                ));
              })()}
              {/* Jump straight to cap. */}
              {budget.approvedUsd + 0.0001 < budget.budgetUsd && (
                <button
                  onClick={() =>
                    approveNext({ absolute: budget.budgetUsd })
                  }
                  disabled={approving}
                  className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
                  title={`تا سقف کل $${budget.budgetUsd.toFixed(2)}`}
                >
                  ⬆ سقف
                </button>
              )}
              {/* Extend cap by step and approve it in one click —
                  rolls $50 → $60 → $70 … without leaving the page. */}
              <button
                onClick={() =>
                  approveNext({
                    extendBudget: true,
                    absolute: budget.budgetUsd + budget.stepUsd,
                  })
                }
                disabled={approving}
                className="text-[11px] px-2.5 py-1 rounded-md border border-amber-600 bg-amber-500/15 text-amber-200 hover:bg-amber-500/30"
                title={`سقف رو $${budget.stepUsd.toFixed(2)} بالا ببر + تخصیص رو هم تا اونجا ببر`}
              >
                🔓 +${budget.stepUsd.toFixed(2)} + سقف
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-[var(--color-text-dim)]">…</div>
        )}
      </Card>

      <MonthlyEstimateCard accounts={accounts} />

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
              ["checkMentioned", "🏷 mentioned"],
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
            پاک کردن
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
                ["checkMentioned", "🏷 mentioned"],
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
        <Card>در حال بارگذاری…</Card>
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
                    onClick={() => openRefreshDialog(a)}
                    disabled={refreshing.has(a.id)}
                    title="فقط چیزایی رو که می‌خوای انتخاب کن و دوباره بگیر"
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
                  >
                    {refreshing.has(a.id) ? "…" : "🔄"}
                  </button>
                  <button
                    onClick={() => remove(a.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-red-900/40"
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
                      ["checkMentioned", "🏷 mentioned", a.checkMentioned],
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
                    value={a.mode === "notify" ? "notify" : String(a.intervalMinutes)}
                    onChange={(e) => {
                      if (e.target.value === "notify") {
                        patch(a.id, { mode: "notify" });
                      } else {
                        patch(a.id, {
                          mode: "interval",
                          intervalMinutes: Number(e.target.value),
                        });
                      }
                    }}
                    className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5"
                  >
                    {INTERVAL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {intervalLabel(m)}
                      </option>
                    ))}
                    <option value="notify">🔔 notify</option>
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

      <RecentEventsCard
        events={events}
        hasMore={eventsHasMore}
        loadingMore={eventsLoadingMore}
        onLoadMore={async () => {
          if (eventsLoadingMore || !eventsHasMore) return;
          setEventsLoadingMore(true);
          try {
            const r = await fetch(
              `/api/monitored/events?limit=${EVENTS_PAGE_SIZE}&offset=${events.length}`,
            );
            if (r.ok) {
              const j = (await r.json()) as { events: Event[] };
              if (j.events.length === 0) {
                setEventsHasMore(false);
              } else {
                setEvents((cur) => {
                  const seen = new Set(cur.map((e) => e.id));
                  const fresh = j.events.filter((e) => !seen.has(e.id));
                  return [...cur, ...fresh];
                });
                if (j.events.length < EVENTS_PAGE_SIZE) {
                  setEventsHasMore(false);
                }
              }
            }
          } finally {
            setEventsLoadingMore(false);
          }
        }}
      />

      {refreshDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
          onClick={() => setRefreshDialog(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 sm:p-5 w-full max-w-md my-4 max-h-[92vh] overflow-y-auto"
          >
            <h2 className="text-base font-semibold mb-1">
              🔄 دوباره گرفتن @{refreshDialog.username}
            </h2>
            <p className="text-xs text-[var(--color-text-dim)] mb-4">
              کدوم‌ها رو می‌خوای + چند تای آخر هر کدوم
            </p>
            <div className="flex flex-col gap-2 mb-4 text-sm">
              {(
                [
                  ["stories", "📸 Stories", "countStories"],
                  ["posts", "🖼 Posts", "countPosts"],
                  ["reels", "🎬 Reels", "countReels"],
                  ["mentioned", "🏷 Mentioned (در پست‌های دیگران تگ شده)", "countMentioned"],
                ] as const
              ).map(([flag, label, countKey]) => (
                <div
                  key={flag}
                  className="flex items-center gap-2 p-2 rounded-md border border-[var(--color-border)]"
                >
                  <input
                    type="checkbox"
                    checked={refreshDialog[flag]}
                    onChange={(e) =>
                      setRefreshDialog({
                        ...refreshDialog,
                        [flag]: e.target.checked,
                      })
                    }
                  />
                  <label className="flex-1 cursor-pointer">{label}</label>
                  <span className="text-[var(--color-text-dim)] text-xs">
                    تعداد:
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    disabled={!refreshDialog[flag]}
                    value={refreshDialog[countKey]}
                    onChange={(e) =>
                      setRefreshDialog({
                        ...refreshDialog,
                        [countKey]: Math.max(
                          1,
                          Math.min(20, Number(e.target.value) || 3),
                        ),
                      })
                    }
                    className="w-16 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRefreshDialog(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                لغو
              </button>
              <button
                onClick={runRefresh}
                disabled={
                  !refreshDialog.stories &&
                  !refreshDialog.posts &&
                  !refreshDialog.reels &&
                  !refreshDialog.mentioned
                }
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90"
              >
                بگیر
              </button>
            </div>
          </div>
        </div>
      )}

      {keyDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
          onClick={() => setKeyDialog(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 sm:p-5 w-full max-w-md my-4 max-h-[92vh] overflow-y-auto"
          >
            <h2 className="text-base font-semibold mb-1">
              🔑 کلید HikerAPI
            </h2>
            <p className="text-xs text-[var(--color-text-dim)] mb-3">
              کلید رو اینجا ست کن. توی DB ذخیره می‌شه (با redact) و بر env var
              ترجیح داده می‌شه. خالی بذار تا fallback به env.
              {keyPrefix && (
                <>
                  <br />
                  <span dir="ltr" className="font-mono">
                    فعلاً: {keyName ? `[${keyName}] ` : ""}
                    {keyPrefix} ({keySource})
                  </span>
                </>
              )}
            </p>
            <label className="block text-[11px] text-[var(--color-text-dim)] mb-1">
              کلید جدید
            </label>
            <input
              dir="ltr"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="x-access-key"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-sm font-mono mb-3"
            />
            <label className="block text-[11px] text-[var(--color-text-dim)] mb-1">
              نام (اختیاری — مثل smmr)
            </label>
            <input
              dir="ltr"
              type="text"
              value={keyNameInput}
              onChange={(e) => setKeyNameInput(e.target.value)}
              placeholder="smmr"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-sm mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={async () => {
                  setKeyInput("");
                  setKeyNameInput("");
                  await fetch("/api/monitored/usage/key", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: "", name: "" }),
                  });
                  setKeyDialog(false);
                  await loadUsage();
                  await runDiagnose();
                }}
                className="text-xs px-3 py-1.5 rounded-md border border-red-700 text-red-300 hover:bg-red-900/30"
                title="override رو پاک کن، fallback به env"
              >
                🗑 پاک کردن override
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setKeyDialog(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                لغو
              </button>
              <button
                onClick={saveKey}
                disabled={savingKey || !keyInput.trim()}
                className="text-xs px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
              >
                {savingKey ? "ذخیره…" : "💾 ذخیره"}
              </button>
            </div>
          </div>
        </div>
      )}

      {budgetDialog && budget && (
        <BudgetSettingsDialog
          budget={budget}
          summary={budgetSummary}
          hourly={budgetHourly}
          daily={budgetDaily}
          weekly={budgetWeekly}
          monthly={budgetMonthly}
          recent={budgetRecent}
          onClose={() => setBudgetDialog(false)}
          onSaved={async () => {
            await loadBudget();
          }}
          onApproveAbsolute={(v) => approveNext({ absolute: v })}
        />
      )}
    </Shell>
  );
}

function BudgetSettingsDialog(props: {
  budget: {
    spentUsd: number;
    approvedUsd: number;
    budgetUsd: number;
    stepUsd: number;
    costPerCallUsd: number;
    needsApproval: boolean;
    budgetExceeded: boolean;
    nextThresholdUsd: number;
  };
  summary: {
    lastHour: { calls: number; costUsd: number };
    today: { calls: number; costUsd: number };
    last7d: { calls: number; costUsd: number };
    last30d: { calls: number; costUsd: number };
    allTime: { calls: number; costUsd: number };
  } | null;
  hourly: Array<{ at: string; calls: number; costUsd: number }>;
  daily: Array<{ at: string; calls: number; costUsd: number }>;
  weekly: Array<{ at: string; calls: number; costUsd: number }>;
  monthly: Array<{ at: string; calls: number; costUsd: number }>;
  recent: Array<{
    id: number;
    calledAt: string;
    endpoint: string;
    costUsd: number;
    accountId: number | null;
  }>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onApproveAbsolute: (v: number) => Promise<void>;
}) {
  const {
    budget,
    summary,
    hourly,
    daily,
    weekly,
    monthly,
    recent,
    onClose,
    onSaved,
    onApproveAbsolute,
  } = props;
  const [budgetUsd, setBudgetUsd] = useState(String(budget.budgetUsd));
  const [stepUsd, setStepUsd] = useState(String(budget.stepUsd));
  const [costPerCallUsd, setCostPerCallUsd] = useState(
    String(budget.costPerCallUsd),
  );
  const [optimize, setOptimize] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/settings");
      if (r.ok) {
        const j = (await r.json()) as {
          values?: Record<string, string>;
        };
        const v = j.values?.hikerOptimizeChangeDetection;
        if (v != null) {
          setOptimize(v.toLowerCase() !== "false");
        }
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      // budget + step are per-tenant now (Commit 2 moved them out of
      // global settings into the tenants table). Route them through
      // the approve endpoint, which already knows how to write them.
      const budgetNum = Number(budgetUsd);
      const stepNum = Number(stepUsd);
      if (Number.isFinite(budgetNum) || Number.isFinite(stepNum)) {
        await fetch("/api/monitored/budget/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            budgetUsd: Number.isFinite(budgetNum) ? budgetNum : undefined,
            stepUsd: Number.isFinite(stepNum) ? stepNum : undefined,
            // Don't bump approved — just adjust caps + step. Pass
            // current approved through unchanged.
            approvedUsd: budget.approvedUsd,
          }),
        });
      }
      // cost per call + optimize toggle are still global estimates,
      // shared across tenants.
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hikerCostPerCallUsd: costPerCallUsd,
          hikerOptimizeChangeDetection: String(optimize),
        }),
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  const maxHourly = Math.max(0.001, ...hourly.map((b) => b.costUsd));
  const maxDaily = Math.max(0.001, ...daily.map((b) => b.costUsd));
  const maxWeekly = Math.max(0.001, ...weekly.map((b) => b.costUsd));
  const maxMonthly = Math.max(0.001, ...monthly.map((b) => b.costUsd));

  // Projections from observed rates: extrapolate the 24h spend out to
  // a month, and the 7-day spend out to a month, so the owner can
  // eyeball "at this rate how long does \$50 last".
  const projDailyToMonth = summary
    ? summary.today.costUsd * 30
    : null;
  const projWeeklyToMonth = summary
    ? (summary.last7d.costUsd / 7) * 30
    : null;
  const daysToBudget = (() => {
    if (!summary || !budget) return null;
    const ratePerDay = summary.last7d.costUsd / 7;
    if (ratePerDay <= 0) return null;
    const remaining = budget.budgetUsd - budget.spentUsd;
    if (remaining <= 0) return 0;
    return remaining / ratePerDay;
  })();

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start sm:items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 sm:p-5 w-full max-w-2xl my-4 sm:my-8 max-h-[94vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <h2 className="text-base font-semibold">⚙️ تنظیمات بودجه HikerAPI</h2>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="text-lg leading-none text-[var(--color-text-dim)] hover:text-white px-2 -mt-1"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-dim)] mb-4">
          HikerAPI خودش $ نشون نمی‌ده — ما هر call رو با هزینه تخمینی محلی جمع
          می‌زنیم. سقف کل + هر چند $ یه‌بار از تو می‌پرسه ادامه بدیم یا نه.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              سقف کلی ($)
            </span>
            <input
              type="number"
              step="0.01"
              value={budgetUsd}
              onChange={(e) => setBudgetUsd(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              فاصله‌ی تایید ($)
            </span>
            <input
              type="number"
              step="0.01"
              value={stepUsd}
              onChange={(e) => setStepUsd(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-[var(--color-text-dim)]">
              هزینه fallback / call ($)
            </span>
            <input
              type="number"
              step="0.0001"
              value={costPerCallUsd}
              onChange={(e) => setCostPerCallUsd(e.target.value)}
              className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={optimize}
            onChange={(e) => setOptimize(e.target.checked)}
          />
          <span>
            🎯 optimize تشخیص: قبل از fetch پست‌ها، فقط user-info ارزون می‌گیره
            (~$0.001). اگه media_count عوض نشده، fetch پست/ریلز/منشن رو
            <strong> اصلاً </strong>
            نمی‌زنه. (ذخیره‌ی ۷۵-۹۰٪)
          </span>
        </label>

        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => onApproveAbsolute(Number(budgetUsd))}
            className="text-xs px-3 py-1.5 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
            title="تا سقف کلی auto-approve کن"
          >
            ✅ تایید کل سقف
          </button>
          <button
            onClick={() => onApproveAbsolute(budget.spentUsd)}
            className="text-xs px-3 py-1.5 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30"
            title="مجاز رو به همین خرج فعلی برگردون = pause فوری"
          >
            ⏸ pause الان
          </button>
          <div className="hidden sm:block flex-1" />
          <button
            onClick={save}
            disabled={saving}
            className="text-xs px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {saving ? "ذخیره…" : "💾 ذخیره"}
          </button>
        </div>

        {summary && (
          <div className="mb-4 p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
            <div className="text-xs font-medium mb-2">📊 خلاصه دقیق</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="text-[var(--color-text-dim)]">
                  <tr className="text-right">
                    <th className="font-normal py-1">بازه</th>
                    <th className="font-normal py-1">تعداد call</th>
                    <th className="font-normal py-1">هزینه</th>
                    <th className="font-normal py-1">میانگین / call</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["⏰ ۱ ساعت اخیر", summary.lastHour],
                      ["📅 ۲۴ ساعت اخیر", summary.today],
                      ["🗓 ۷ روز اخیر", summary.last7d],
                      ["🗓 ۳۰ روز اخیر", summary.last30d],
                      ["Σ همه‌ی زمان", summary.allTime],
                    ] as const
                  ).map(([label, w]) => (
                    <tr
                      key={label}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="py-1">{label}</td>
                      <td className="py-1">{w.calls.toLocaleString()}</td>
                      <td className="py-1 font-semibold">
                        ${w.costUsd.toFixed(4)}
                      </td>
                      <td className="py-1 text-[var(--color-text-dim)]">
                        {w.calls > 0
                          ? `$${(w.costUsd / w.calls).toFixed(5)}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(projDailyToMonth != null || projWeeklyToMonth != null) && (
              <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)] flex flex-col gap-0.5">
                <div>
                  📈 پیش‌بینی ماهانه (با نرخ ۲۴ ساعت اخیر):{" "}
                  <strong className="text-[var(--color-text)]">
                    ${(projDailyToMonth ?? 0).toFixed(2)}
                  </strong>
                </div>
                <div>
                  📈 پیش‌بینی ماهانه (با نرخ ۷ روز اخیر):{" "}
                  <strong className="text-[var(--color-text)]">
                    ${(projWeeklyToMonth ?? 0).toFixed(2)}
                  </strong>
                </div>
                {daysToBudget != null && Number.isFinite(daysToBudget) && (
                  <div>
                    ⏳ با این نرخ، باقیمانده‌ی ${budget
                      ? (budget.budgetUsd - budget.spentUsd).toFixed(2)
                      : "—"}{" "}
                    کافیه برای{" "}
                    <strong className="text-[var(--color-text)]">
                      {daysToBudget < 1
                        ? `${Math.round(daysToBudget * 24)} ساعت`
                        : daysToBudget > 365
                          ? "بیش از یک سال"
                          : `${Math.round(daysToBudget)} روز`}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mb-4">
          <div className="text-xs font-medium mb-1">
            ⏰ ساعتی (۲۴ ساعت اخیر)
          </div>
          {hourly.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              هنوز callی ثبت نشده
            </div>
          ) : (
            <div className="flex items-end gap-0.5 h-16">
              {hourly.map((b) => (
                <div
                  key={b.at}
                  title={`${new Date(b.at).toLocaleString()} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                  className="flex-1 bg-[var(--color-accent)]/70 rounded-t-sm min-h-[2px] hover:bg-[var(--color-accent)]"
                  style={{
                    height: `${Math.max(4, (b.costUsd / maxHourly) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="text-xs font-medium mb-1">
            📅 روزانه (۱۴ روز اخیر)
          </div>
          {daily.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              هنوز callی ثبت نشده
            </div>
          ) : (
            <div className="flex items-end gap-1 h-16">
              {daily.map((b) => (
                <div
                  key={b.at}
                  title={`${new Date(b.at).toLocaleDateString()} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                  className="flex-1 bg-[var(--color-accent)]/70 rounded-t-sm min-h-[2px] hover:bg-[var(--color-accent)]"
                  style={{
                    height: `${Math.max(4, (b.costUsd / maxDaily) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="text-xs font-medium mb-1">
            🗓 هفتگی (۱۲ هفته اخیر)
          </div>
          {weekly.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              هنوز callی ثبت نشده
            </div>
          ) : (
            <div className="flex items-end gap-1 h-16">
              {weekly.map((b) => (
                <div
                  key={b.at}
                  title={`هفته‌ی ${new Date(b.at).toLocaleDateString()} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                  className="flex-1 bg-emerald-600/70 rounded-t-sm min-h-[2px] hover:bg-emerald-500"
                  style={{
                    height: `${Math.max(4, (b.costUsd / maxWeekly) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="text-xs font-medium mb-1">
            🗓 ماهانه (۶ ماه اخیر)
          </div>
          {monthly.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              هنوز callی ثبت نشده
            </div>
          ) : (
            <div className="flex items-end gap-1.5 h-16">
              {monthly.map((b) => (
                <div
                  key={b.at}
                  title={`${new Date(b.at).toLocaleDateString()} · ${b.calls} call · $${b.costUsd.toFixed(4)}`}
                  className="flex-1 bg-amber-500/70 rounded-t-sm min-h-[2px] hover:bg-amber-400"
                  style={{
                    height: `${Math.max(4, (b.costUsd / maxMonthly) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-2">
          <div className="text-xs font-medium mb-1">
            📜 آخرین call‌ها (۲۰ آخر)
          </div>
          {recent.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              خالی
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
              {recent.map((c) => (
                <div
                  key={c.id}
                  className="text-[10px] flex items-center gap-2 py-0.5 border-b border-[var(--color-border)]"
                >
                  <span className="text-[var(--color-text-dim)] w-24 shrink-0">
                    {new Date(c.calledAt).toLocaleString()}
                  </span>
                  <span dir="ltr" className="flex-1 truncate font-mono">
                    {c.endpoint}
                  </span>
                  <span className="text-[var(--color-text-dim)]">
                    ${c.costUsd.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// HikerAPI per-call prices we use today, in USD. These mirror the
// authoritative table in lib/hikerapi-budget.ts; if that file changes
// these need to bump too.
const HIKER_USD = {
  userByUsername: 0.001,
  stories: 0.003,
  posts: 0.012,
  reels: 0.012,
  mentions: 0.012,
} as const;

// HikerAPI plan tiers (best estimate — confirm against your contract).
// Used only to color/explain the projected monthly cost; the cron
// itself never references these.
const PLAN_TIERS = [
  { id: "basic", label: "Basic", monthly: 30 },
  { id: "pro", label: "Pro", monthly: 100 },
  { id: "ultra", label: "Ultra", monthly: 300 },
] as const;

// Probability that each "expensive feed" call is actually made when
// optimize_change_detection is on (i.e. the account's media_count
// changed since last check). 25% is a reasonable upper bound for the
// kinds of accounts the operator follows; real numbers will be lower.
const CHANGE_DETECTION_HIT_RATE = 0.25;

function MonthlyEstimateCard({ accounts }: { accounts: Account[] }) {
  const [optimizeOn, setOptimizeOn] = useState(true);
  const [pickedPlan, setPickedPlan] = useState<(typeof PLAN_TIERS)[number]["id"]>("ultra");

  // Cost per single tick of one account, before any optimization.
  function costPerTick(a: Account): number {
    if (!a.enabled) return 0;
    // The user-by-username lookup is always paid (it's the cheap
    // baseline call that decides whether to go further).
    let cost = HIKER_USD.userByUsername;
    if (a.checkStories) cost += HIKER_USD.stories;
    // Posts / reels / mentions are gated by optimize_change_detection
    // when it's on — multiply by the hit-rate to estimate average cost.
    const heavyHitRate = optimizeOn ? CHANGE_DETECTION_HIT_RATE : 1;
    if (a.checkPosts) cost += HIKER_USD.posts * heavyHitRate;
    if (a.checkReels) cost += HIKER_USD.reels * heavyHitRate;
    if (a.checkMentioned) cost += HIKER_USD.mentions * heavyHitRate;
    return cost;
  }

  // Ticks per month is the number of Tehran peak-hour triggers per
  // day * 30. For intervals without a curated schedule fall back to
  // the old "wall-clock / interval" estimate. This matches the gate
  // applied in lib/db.ts dueMonitoredAccounts.
  //
  // For notify-mode accounts we compute the WORST CASE: a 3-hour
  // cooldown caps fetches at 8 per day → 240 per month. Actual
  // spending is usually much lower (only when the external notify
  // service actually fires), but the estimate has to fit the user-
  // visible "worst case" guarantee.
  function ticksPerMonth(intervalMinutes: number, mode?: string): number {
    if (mode === "notify") return 8 * 30;
    // 3-hour floor — anything shorter is a stale row the migration
    // missed, treat it as the 3h schedule so the dashboard doesn't
    // show the legacy cost regime.
    const m = Math.max(180, intervalMinutes);
    const hours = TEHRAN_TRIGGER_HOURS[m];
    if (hours && hours.length > 0) return hours.length * 30;
    return m > 0 ? (30 * 24 * 60) / m : 0;
  }

  const perAccountMonthly = accounts.map((a) => {
    const ticks = ticksPerMonth(a.intervalMinutes, a.mode);
    const monthly = costPerTick(a) * ticks;
    return { account: a, ticks, monthly };
  });
  const totalMonthly = perAccountMonthly.reduce((s, r) => s + r.monthly, 0);
  const enabledCount = accounts.filter((a) => a.enabled).length;
  const plan = PLAN_TIERS.find((p) => p.id === pickedPlan) ?? PLAN_TIERS[2];
  const overspend = totalMonthly > plan.monthly;
  const percentOfPlan = plan.monthly > 0 ? (totalMonthly / plan.monthly) * 100 : 0;

  // Group by bucket. Notify-mode accounts get their own row
  // (worst-case cap). Interval-mode accounts bucket by their
  // intervalMinutes — pulled from the actual data so accounts on
  // legacy values (15 / 30 / 60 min) still appear in the breakdown.
  type Row = { key: string; label: string; count: number; cost: number };
  const enabledAccounts = accounts.filter((a) => a.enabled);
  const notifyAccounts = enabledAccounts.filter((a) => a.mode === "notify");
  const intervalAccounts = enabledAccounts.filter((a) => a.mode !== "notify");
  const intervalSet = new Set<number>(
    intervalAccounts.map((a) => a.intervalMinutes),
  );
  const intervalBreakdown: Row[] = [];
  if (notifyAccounts.length > 0) {
    const cost = notifyAccounts.reduce(
      (s, a) => s + costPerTick(a) * ticksPerMonth(a.intervalMinutes, "notify"),
      0,
    );
    intervalBreakdown.push({
      key: "notify",
      label: "🔔 notify (سقف ۸ بار/روز با cooldown ۳h)",
      count: notifyAccounts.length,
      cost,
    });
  }
  for (const minutes of Array.from(intervalSet).sort((a, b) => a - b)) {
    const inGroup = intervalAccounts.filter(
      (a) => a.intervalMinutes === minutes,
    );
    const cost = inGroup.reduce(
      (s, a) => s + costPerTick(a) * ticksPerMonth(minutes),
      0,
    );
    intervalBreakdown.push({
      key: `i:${minutes}`,
      label: intervalLabel(minutes),
      count: inGroup.length,
      cost,
    });
  }

  return (
    <Card className="mb-3 !p-3">
     <div dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-sm font-medium">📈 تخمین هزینه‌ی ماهانه HikerAPI</div>
        <label className="text-[10px] flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={optimizeOn}
            onChange={(e) => setOptimizeOn(e.target.checked)}
          />
          optimize_change_detection
        </label>
      </div>
      <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
        تخمین بر اساس interval هر اکانت و kind های روشن. با{" "}
        <code>optimize_change_detection</code> فرض می‌گیریم فقط{" "}
        {Math.round(CHANGE_DETECTION_HIT_RATE * 100)}٪ از تیک‌ها posts/reels/mentions
        می‌خونن (وقتی media_count تغییر کرده). بدون اون، هر تیک کامل خونده می‌شه.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
        <div className="bg-[var(--color-surface-2)] rounded-md p-2">
          <div className="text-[10px] text-[var(--color-text-dim)]">اکانت‌های فعال</div>
          <div className="text-xl font-semibold mt-1">{enabledCount}</div>
        </div>
        <div className="bg-[var(--color-surface-2)] rounded-md p-2">
          <div className="text-[10px] text-[var(--color-text-dim)]">تخمین ماهانه</div>
          <div
            className={`text-xl font-semibold mt-1 ${overspend ? "text-red-300" : "text-emerald-300"}`}
          >
            ${totalMonthly.toFixed(2)}
          </div>
        </div>
        <div className="bg-[var(--color-surface-2)] rounded-md p-2">
          <div className="text-[10px] text-[var(--color-text-dim)]">
            ٪ پلن {plan.label}
          </div>
          <div
            className={`text-xl font-semibold mt-1 ${overspend ? "text-red-300" : ""}`}
          >
            {percentOfPlan.toFixed(0)}٪
          </div>
        </div>
      </div>

      <div className="flex gap-1 flex-wrap mb-3">
        {PLAN_TIERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPickedPlan(p.id)}
            className={`text-[11px] px-2 py-1 rounded-md border ${
              pickedPlan === p.id
                ? "bg-[var(--color-accent)] text-white border-transparent"
                : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {p.label} (${p.monthly}/mo)
          </button>
        ))}
      </div>

      {intervalBreakdown.length > 0 && (
        <div className="border-t border-[var(--color-border)] pt-2 mt-1">
          <div className="text-[10px] text-[var(--color-text-dim)] mb-1.5">
            تفکیک بر اساس interval (همه ساعت‌ها به وقت تهران)
            <div className="mt-0.5">
              🌙 ساعت ۲ تا ۸ صبح هیچ بررسی‌ای انجام نمی‌شه (intervals کمتر از ۱۲h
              فقط از ۹ صبح تا حدود ۲۲ شب اجرا می‌شن).
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {intervalBreakdown.map((row) => {
              const minutes = row.key.startsWith("i:")
                ? Number(row.key.slice(2))
                : null;
              const hours =
                minutes != null ? TEHRAN_TRIGGER_HOURS[minutes] : undefined;
              const slots = hours
                ? hours.map((h) => `${h}:۰۰`).join("، ")
                : null;
              return (
                <div
                  key={row.key}
                  className="flex items-start justify-between text-[11px] gap-3"
                >
                  <span className="min-w-0">
                    {row.label}{" "}
                    <span className="text-[var(--color-text-dim)]">
                      · {row.count} اکانت
                    </span>
                    {slots && (
                      <span className="block text-[10px] text-[var(--color-text-dim)] mt-0.5">
                        ساعت‌های اجرا: {slots}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums shrink-0">
                    ${row.cost.toFixed(2)}/ماه
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {overspend && (
        <div className="mt-2 text-[11px] text-red-300">
          ⚠️ تخمین بیشتر از پلن {plan.label} ($${plan.monthly}/mo) هست. interval بیشتری
          بزن یا چند اکانت رو خاموش کن.
        </div>
      )}
     </div>
    </Card>
  );
}

function RecentEventsCard({
  events,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: Event[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  // IntersectionObserver wired to a sentinel at the bottom of the
  // list. When the sentinel enters the viewport we call onLoadMore;
  // the parent debounces its own state so a second hit is ignored
  // until the first fetch is done.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && hasMore && !loadingMore) {
            onLoadMore();
          }
        }
      },
      { rootMargin: "120px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (events.length === 0) return null;
  return (
    <Card>
      <div className="text-sm font-medium mb-2">📬 رویدادهای اخیر</div>
      <div className="flex flex-col gap-1">
        {events.map((e) => (
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
      {(hasMore || loadingMore) && (
        <div
          ref={sentinelRef}
          className="text-center text-[10px] text-[var(--color-text-dim)] py-2 mt-1"
        >
          {loadingMore ? "..." : ""}
        </div>
      )}
    </Card>
  );
}
