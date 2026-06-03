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
  checkMentioned: boolean;
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
  checkMentioned: boolean;
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
    checkMentioned: false,
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

  type Usage = {
    plan?: string | null;
    creditsUsed?: number | null;
    creditsLimit?: number | null;
    creditsRemaining?: number | null;
    resetsAt?: string | null;
    expiresAt?: string | null;
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
  const [keySource, setKeySource] = useState<"db" | "env" | null>(null);
  const [keyName, setKeyName] = useState<string | null>(null);
  type Diagnose = {
    keyPrefix: string | null;
    keyLoaded: boolean;
    keySource: "db" | "env" | null;
    keyName: string | null;
    probes: Array<{
      path: string;
      ok: boolean;
      status: number;
      body: string;
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
        usage?: Usage;
        error?: string;
        outOfCredits?: boolean;
        message?: string;
        billingUrl?: string;
        keyPrefix?: string | null;
        keySource?: "db" | "env" | null;
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
        setUsage(j.usage ?? null);
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
        // If any probe came back 2xx, the key is fine — clear the
        // stale out-of-credits banner so the UI stops yelling.
        if (j.probes.some((p) => p.ok)) {
          setUsageOutOfCredits(null);
          setUsageError(null);
          // Re-pull usage too so we render whatever the live probe got.
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

  async function approveNext(absolute?: number) {
    setApproving(true);
    try {
      const r = await fetch("/api/monitored/budget/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          absolute != null ? { approvedUsd: absolute } : {},
        ),
      });
      if (r.ok) {
        const j = (await r.json()) as { state: BudgetState };
        setBudget(j.state);
        setImportMsg(
          `✅ تا $${j.state.approvedUsd.toFixed(2)} مجاز شد`,
        );
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
        alert(`خطا: ${j.errors[0]}`);
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
        title="📸 Instagram Monitor"
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
            {usageOutOfCredits ? "💸 HikerAPI پاسخ ۴۰۲ می‌ده" : "💳 HikerAPI usage"}
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
        ) : usage ? (
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            {usage.plan && (
              <span>
                <span className="text-[var(--color-text-dim)]">plan:</span>{" "}
                <Badge tone="info">{usage.plan}</Badge>
              </span>
            )}
            {usage.creditsUsed != null && usage.creditsLimit != null && (
              <>
                <span>
                  <span className="text-[var(--color-text-dim)]">مصرف:</span>{" "}
                  <strong>{usage.creditsUsed.toLocaleString()}</strong>
                  {" / "}
                  {usage.creditsLimit.toLocaleString()}
                </span>
                <div className="flex-1 min-w-[120px] h-2 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--color-accent)]"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (usage.creditsUsed / usage.creditsLimit) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <span className="text-[var(--color-text-dim)]">
                  {Math.round((usage.creditsUsed / usage.creditsLimit) * 100)}%
                </span>
              </>
            )}
            {usage.creditsRemaining != null && (
              <span>
                <span className="text-[var(--color-text-dim)]">باقی:</span>{" "}
                <strong>{usage.creditsRemaining.toLocaleString()}</strong>
              </span>
            )}
            {usage.resetsAt && (
              <span className="text-[var(--color-text-dim)]">
                ریست: {new Date(usage.resetsAt).toLocaleString()}
              </span>
            )}
            {usage.expiresAt && (
              <span className="text-[var(--color-text-dim)]">
                انقضا: {new Date(usage.expiresAt).toLocaleString()}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-[var(--color-text-dim)]">
            …
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
              {diagnose.probes.map((p) => (
                <div
                  key={p.path}
                  dir="ltr"
                  className={`text-[10px] p-1.5 rounded-md border ${
                    p.ok
                      ? "border-emerald-700 bg-emerald-900/20"
                      : "border-red-700 bg-red-900/20"
                  }`}
                >
                  <div className="flex items-center gap-2 font-mono">
                    <span className={p.ok ? "text-emerald-400" : "text-red-400"}>
                      {p.ok ? "✓" : "✗"} {p.status || "?"}
                    </span>
                    <span className="font-medium">{p.path}</span>
                  </div>
                  <div className="text-[9px] text-[var(--color-text-dim)] mt-0.5 break-all font-mono">
                    {p.body}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-[var(--color-text-dim)] mt-2">
              نکته: اگه کلیدی که اینجا می‌بینی همون کلید درستی نیست که توی hikerapi
              dashboard داری، یعنی Vercel env یا redeploy نشده یا کلید قدیمیه. کلید
              رو توی Vercel → Settings → Environment Variables ست کن و
              redeploy کن.
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
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[11px] text-amber-200 flex-1 min-w-[200px]">
                  {budget.budgetExceeded
                    ? `سقف کل $${budget.budgetUsd.toFixed(2)} تمام شد. cron متوقفه. اگه بخوای ادامه بدی، اول سقف رو از تنظیمات بالا ببر.`
                    : `خرج رسید به سقف مجاز $${budget.approvedUsd.toFixed(2)}. تا تایید نکنی، cron و دکمه‌های refresh ۴۰۲ می‌گیرن.`}
                </div>
                {!budget.budgetExceeded && (
                  <button
                    onClick={() => approveNext()}
                    disabled={approving}
                    className="text-xs px-3 py-1.5 rounded-md bg-amber-500 text-black font-medium hover:bg-amber-400 disabled:opacity-50"
                  >
                    ✅ تایید ${budget.stepUsd.toFixed(2)} بعدی (تا $
                    {budget.nextThresholdUsd.toFixed(2)})
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-[var(--color-text-dim)]">…</div>
        )}
      </Card>

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

      {refreshDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setRefreshDialog(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-md"
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
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setKeyDialog(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-md"
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
          onApproveAbsolute={(v) => approveNext(v)}
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
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hikerBudgetUsd: budgetUsd,
          hikerApprovalStepUsd: stepUsd,
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
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-2xl my-8"
      >
        <h2 className="text-base font-semibold mb-1">⚙️ تنظیمات بودجه HikerAPI</h2>
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

        <div className="flex gap-2 mb-5">
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
          <div className="flex-1" />
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
