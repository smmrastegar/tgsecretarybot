"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import AccountCard from "@/components/monitored/AccountCard";
import { AddAccountSection, DefaultsSection, StorageSection } from "@/components/monitored/ConfigSections";
import BudgetSection from "@/components/monitored/BudgetSection";
import BudgetSettingsSheet from "@/components/monitored/BudgetSettingsSheet";
import BulkBar from "@/components/monitored/BulkBar";
import EventsFeed from "@/components/monitored/EventsFeed";
import MonthlyEstimate from "@/components/monitored/MonthlyEstimate";
import { KeySheet, RefreshSheet } from "@/components/monitored/Sheets";
import SummaryStrip from "@/components/monitored/SummaryStrip";
import UsageSection from "@/components/monitored/UsageSection";
import {
  BTN,
  BTN_AMBER,
  BTN_PRIMARY,
  Banner,
  FIELD,
  FilterChip,
  fa,
  type Account,
  type Bucket,
  type BudgetState,
  type ChatBrief,
  type Defaults,
  type Diagnose,
  type HikerCall,
  type MonitorEvent,
  type OutOfCredits,
  type RefreshDraft,
  type Summary,
  type Usage,
} from "@/components/monitored/shared";

const EVENTS_PAGE_SIZE = 10;
// Accounts are drawn in pages so a long list stays light on a phone.
const ACCOUNTS_PAGE_SIZE = 30;

type StatusFilter = "all" | "on" | "off" | "error" | "new";

const STATUS_FILTERS: ReadonlyArray<readonly [StatusFilter, string]> = [
  ["all", "همه"],
  ["on", "فعال"],
  ["off", "خاموش"],
  ["error", "⚠️ خطادار"],
  ["new", "چک‌نشده"],
];

function matchStatus(a: Account, f: StatusFilter): boolean {
  if (f === "on") return a.enabled;
  if (f === "off") return !a.enabled;
  if (f === "error") return Boolean(a.lastError);
  if (f === "new") return !a.lastCheckedAt;
  return true;
}

// How many of the loaded events were detected within the last `hours`.
function eventsWithin(events: MonitorEvent[], hours: number): number {
  const since = Date.now() - hours * 3600 * 1000;
  return events.filter((e) => new Date(e.detectedAt).getTime() >= since).length;
}

export default function MonitoredPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
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
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [shownState, setShownState] = useState<{ key: string; n: number }>({
    key: "",
    n: ACCOUNTS_PAGE_SIZE,
  });
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
  const [importing, setImporting] = useState(false);
  // Success / progress toast (auto-clears) and error toast (stays until dismissed). These replace the old
  // native alert() calls.
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  // Section open state. null = automatic (the add form is open while there is no account yet).
  const [addOpen, setAddOpen] = useState<boolean | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const cfgRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch("/api/monitored");
      if (r.ok) {
        const j = (await r.json()) as {
          accounts: Account[];
          events: MonitorEvent[];
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
        setLoaded(true);
      } else {
        setLoadErr(`HTTP ${r.status}`);
      }
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err));
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
    if (!(await confirmDialog("این اکانت حذف بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
    await fetch(`/api/monitored/${id}`, { method: "DELETE" });
    await load();
  }

  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageOutOfCredits, setUsageOutOfCredits] = useState<OutOfCredits | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [keyPrefix, setKeyPrefix] = useState<string | null>(null);
  const [keySource, setKeySource] = useState<"tenant" | "db" | "env" | null>(null);
  const [keyName, setKeyName] = useState<string | null>(null);
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
  const [budgetFailed, setBudgetFailed] = useState(false);
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
        setErrMsg("خطا در ذخیره کلید");
      }
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKeyOverride() {
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
  }

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const loadBudget = useCallback(async () => {
    setBudgetLoading(true);
    setBudgetFailed(false);
    try {
      const r = await fetch("/api/monitored/budget");
      if (!r.ok) {
        setBudgetFailed(true);
        return;
      }
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
    } catch {
      setBudgetFailed(true);
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  async function approveNext(opts?: { absolute?: number; extendBudget?: boolean; budgetUsd?: number }) {
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
            ? `✅ تخصیص $${fa(j.state.approvedUsd.toFixed(2))} · سقف به $${fa(j.state.budgetUsd.toFixed(2))} رسید`
            : `✅ تخصیص تا $${fa(j.state.approvedUsd.toFixed(2))}`;
        setImportMsg(note);
        setTimeout(() => setImportMsg(null), 5000);
        await loadBudget();
      } else {
        setErrMsg("خطا در تایید");
      }
    } finally {
      setApproving(false);
    }
  }

  const [refreshing, setRefreshing] = useState<Set<number>>(new Set());
  const [refreshDialog, setRefreshDialog] = useState<RefreshDraft | null>(null);

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
        setErrMsg(`خطا: ${j.error ?? r.status}`);
      } else if (j.forwarded && j.forwarded > 0) {
        setImportMsg(`${fa(j.forwarded)} مورد جدید forward شد`);
        setTimeout(() => setImportMsg(null), 6000);
      } else if (j.errors && j.errors.length > 0) {
        const first = j.errors[0]!;
        // Transient IG failures already retried internally — show as
        // a soft toast, not a blocking alert.
        if (/transient/i.test(first)) {
          setImportMsg(`⏳ Instagram جواب نداد، cron بعدی دوباره تلاش می‌کنه`);
          setTimeout(() => setImportMsg(null), 6000);
        } else {
          setErrMsg(`خطا: ${first}`);
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
          setImportMsg(`@${u} اضافه شد + ${fa(j.forwarded)} مورد forward شد`);
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
        setErrMsg(j.error ?? "خطا");
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
        let msg = `${fa(jx.inserted ?? 0)} اضافه شد · ${fa(jx.updated ?? 0)} آپدیت شد`;
        if (jx.immediatelyProcessed && jx.immediatelyProcessed > 0) {
          msg += ` · ${fa(jx.immediatelyProcessed)} فوراً پردازش شد (${fa(jx.forwarded ?? 0)} forward)`;
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
  const searched = q ? accounts.filter((a) => a.username.toLowerCase().includes(q)) : accounts;
  const filtered = searched.filter((a) => matchStatus(a, statusFilter));
  const filteredErrors = filtered.filter((a) => a.lastError);
  const listKey = `${q}|${statusFilter}`;
  const shown = shownState.key === listKey ? shownState.n : ACCOUNTS_PAGE_SIZE;
  const visible = filtered.slice(0, shown);

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((a) => a.id)));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function runBulk(op: "update" | "delete", patch?: Record<string, unknown>) {
    if (selected.size === 0) return;
    if (
      op === "delete" &&
      !(await confirmDialog(`${fa(selected.size)} اکانت حذف بشن؟`, { danger: true, confirmLabel: "حذف" }))
    )
      return;
    setBulking(true);
    try {
      const r = await fetch("/api/monitored/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ids: [...selected], patch }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErrMsg(`خطا: ${j.error ?? r.status}`);
      } else {
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  async function resetAllErrors() {
    const errs = filteredErrors.map((a) => a.id);
    if (errs.length === 0) return;
    if (!(await confirmDialog(`${fa(errs.length)} اکانت خطاخورده ریست بشه؟`, { confirmLabel: "ریست" }))) return;
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
        setErrMsg(`خطا: ${j.error ?? r.status}`);
      } else {
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  async function loadMoreEvents() {
    if (eventsLoadingMore || !eventsHasMore) return;
    setEventsLoadingMore(true);
    try {
      const r = await fetch(`/api/monitored/events?limit=${EVENTS_PAGE_SIZE}&offset=${events.length}`);
      if (r.ok) {
        const j = (await r.json()) as { events: MonitorEvent[] };
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
  }

  // ---- derived view state -------------------------------------------------------------------------------
  const errorCount = accounts.filter((a) => a.lastError).length;
  const enabledCount = accounts.filter((a) => a.enabled).length;
  const eventsDay = eventsWithin(events, 24);
  const noStorage = loaded && storageChats.length === 0 && downloaderChats.length === 0;
  const keyMissing = Boolean(usage && !usage.configured && !usageError && !usageOutOfCredits);
  const problems =
    (usageOutOfCredits ? 1 : 0) +
    (keyMissing ? 1 : 0) +
    (budget?.budgetExceeded || budget?.needsApproval ? 1 : 0) +
    (noStorage ? 1 : 0);
  const addIsOpen = addOpen ?? (loaded && !loadErr && accounts.length === 0);

  // Opens the cost/settings panel (and one of its sections) and scrolls it into view.
  function openCfg(which: "usage" | "budget") {
    setCfgOpen(true);
    if (which === "usage") setUsageOpen(true);
    else setBudgetOpen(true);
    setTimeout(() => cfgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  return (
    <Shell>
      <PageTitle
        title="📸 پایش اینستاگرام"
        subtitle="استوری / پست / ریلز اکانت‌های public اینستاگرام رو دانلود و توی کانال storage پست می‌کنه."
      />

      {(importMsg || errMsg) && (
        <div className="fixed inset-x-3 top-[4.25rem] md:top-4 md:inset-x-auto md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 z-[80] flex flex-col gap-2">
          {errMsg && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-2xl border border-rose-400/50 bg-[var(--color-surface)] px-4 py-3 text-sm text-rose-200 text-center shadow-2xl"
            >
              <span className="flex-1 leading-6 [overflow-wrap:anywhere]">{errMsg}</span>
              <button
                type="button"
                onClick={() => setErrMsg(null)}
                className="min-h-10 px-3 rounded-xl border border-rose-400/40 text-xs"
              >
                بستن
              </button>
            </div>
          )}
          {importMsg && (
            <div
              role="status"
              className="rounded-2xl border border-emerald-500/40 bg-[var(--color-surface)] px-4 py-3 text-sm text-emerald-300 text-center leading-6 shadow-2xl [overflow-wrap:anywhere]"
            >
              {importMsg}
            </div>
          )}
        </div>
      )}

      <SummaryStrip
        loading={loading && !loaded}
        total={accounts.length}
        enabled={enabledCount}
        eventsDay={eventsDay}
        eventsMore={eventsHasMore && eventsDay === events.length}
        errors={errorCount}
        budget={budget}
      />

      {usageOutOfCredits && (
        <Banner
          tone="bad"
          action={
            <button type="button" onClick={() => openCfg("usage")} className={`${BTN} shrink-0`}>
              جزئیات
            </button>
          }
        >
          💸 HikerAPI پاسخ ۴۰۲ می‌ده (اعتبار یا Plan)
        </Banner>
      )}
      {keyMissing && (
        <Banner
          tone="warn"
          action={
            <button
              type="button"
              onClick={() => {
                setKeyInput("");
                setKeyNameInput(keyName ?? "");
                setKeyDialog(true);
              }}
              className={`${BTN} shrink-0`}
            >
              🔑 کلید
            </button>
          }
        >
          ⚠️ کلید HikerAPI ست نشده
        </Banner>
      )}
      {budget?.budgetExceeded ? (
        <Banner
          tone="bad"
          action={
            <button type="button" onClick={() => openCfg("budget")} className={`${BTN} shrink-0`}>
              جزئیات
            </button>
          }
        >
          🛑 سقف بودجه HikerAPI تمام شد
        </Banner>
      ) : (
        budget?.needsApproval && (
          <Banner
            tone="warn"
            action={
              <button type="button" onClick={() => openCfg("budget")} className={`${BTN} shrink-0`}>
                جزئیات
              </button>
            }
          >
            ⏸ نیاز به تایید برای ادامه‌ی هزینه
          </Banner>
        )
      )}
      {noStorage && (
        <Banner
          tone="warn"
          action={
            <Link href="/chats" className={`${BTN} shrink-0`}>
              رفتن به چت‌ها
            </Link>
          }
        >
          ⚠️ هیچ کانال Storage ست نشده
        </Banner>
      )}

      <div ref={cfgRef} className="scroll-mt-20">
        <Section
          icon="💳"
          title="هزینه و تنظیمات"
          summary="کلید HikerAPI · بودجه · تخمین هزینه · کانال · پیش‌فرض‌ها"
          badge={problems > 0 ? <Pill tone="warn">{fa(problems)}</Pill> : undefined}
          open={cfgOpen}
          onOpenChange={setCfgOpen}
        >
          <div className="flex flex-col gap-3">
            <UsageSection
              usage={usage}
              usageError={usageError}
              outOfCredits={usageOutOfCredits}
              loading={usageLoading}
              keyPrefix={keyPrefix}
              keySource={keySource}
              keyName={keyName}
              diagnose={diagnose}
              diagnoseLoading={diagnoseLoading}
              open={usageOpen}
              onOpenChange={setUsageOpen}
              onOpenKey={() => {
                setKeyInput("");
                setKeyNameInput(keyName ?? "");
                setKeyDialog(true);
              }}
              onDiagnose={runDiagnose}
              onRefresh={loadUsage}
            />
            <BudgetSection
              budget={budget}
              summary={budgetSummary}
              loading={budgetLoading}
              failed={budgetFailed}
              approving={approving}
              open={budgetOpen}
              onOpenChange={setBudgetOpen}
              onSettings={() => setBudgetDialog(true)}
              onRefresh={loadBudget}
              onApprove={(o) => void approveNext(o)}
            />
            <MonthlyEstimate accounts={accounts} />
            <StorageSection storageChats={storageChats} downloaderChats={downloaderChats} targetChatId={targetChatId} />
            <DefaultsSection defaults={defaults} onSave={(n) => void saveDefaults(n)} />
          </div>
        </Section>
      </div>

      <AddAccountSection
        value={newUsername}
        adding={adding}
        importing={importing}
        open={addIsOpen}
        onOpenChange={setAddOpen}
        onChange={setNewUsername}
        onAdd={() => void addManual()}
        onImport={(f) => void importFile(f)}
      />

      {accounts.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <input
              dir="auto"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در username…"
              aria-label="جستجوی اکانت"
              className={`${FIELD} flex-1 min-w-0 !px-4`}
            />
            <button
              type="button"
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              className={`shrink-0 ${BTN} ${selectMode ? "!bg-[var(--color-accent)] !border-[var(--color-accent)] text-white" : ""}`}
            >
              {selectMode ? "✕ پایان" : "☑ انتخاب"}
            </button>
          </div>

          <div className="-mx-4 px-4 mb-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-2 w-max">
              {STATUS_FILTERS.map(([k, label]) => (
                <FilterChip key={k} active={statusFilter === k} onClick={() => setStatusFilter(k)}>
                  {label} {fa(searched.filter((a) => matchStatus(a, k)).length)}
                </FilterChip>
              ))}
            </div>
          </div>

          {selectMode && (
            <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
              <div className="text-xs text-[var(--color-text-dim)]">
                اکانت‌های مورد نظر رو علامت بزن، بعد عملیات گروهی رو بزن.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={selectAllFiltered} disabled={filtered.length === 0} className={BTN}>
                  انتخاب همه ({fa(filtered.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set(filteredErrors.map((a) => a.id)))}
                  disabled={filteredErrors.length === 0}
                  className={BTN_AMBER}
                  title="فقط اکانت‌هایی که خطا دارن انتخاب کن"
                >
                  ⚠️ خطاها ({fa(filteredErrors.length)})
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={selected.size === 0}
                  className={BTN}
                >
                  پاک کردن
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {loadErr && accounts.length > 0 && (
        <Banner
          tone="bad"
          action={
            <button type="button" onClick={() => void load()} className={`${BTN} shrink-0`}>
              تلاش دوباره
            </button>
          }
        >
          بارگذاری دوباره‌ی فهرست انجام نشد: {loadErr}
        </Banner>
      )}

      {loadErr && accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری اکانت‌ها: {loadErr}</p>
          <div className="mt-3 flex">
            <button type="button" onClick={() => void load()} className={BTN_PRIMARY}>
              تلاش دوباره
            </button>
          </div>
        </Card>
      ) : loading && accounts.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : accounts.length === 0 ? (
        <EmptyState icon="📸" title="اکانتی نیست." hint="بالا یک username اینستاگرام بنویس یا فایل CSV آپلود کن." />
      ) : (
        <>
          <div className="text-xs text-center text-[var(--color-text-dim)] mb-2">
            {fa(filtered.length)} از {fa(accounts.length)} اکانت
          </div>

          {filteredErrors.length > 0 && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
              <span className="flex-1 text-center leading-6">{fa(filteredErrors.length)} اکانت خطا دارن</span>
              <button
                type="button"
                onClick={() => void resetAllErrors()}
                disabled={bulking}
                className={`${BTN_AMBER} shrink-0`}
                title="همه‌ی اکانت‌های خطاخورده رو با یک کلیک ریست کن"
              >
                🔁 ریست همه‌ی خطاها
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="هیچ اکانتی با این فیلتر مطابقت نداره."
              hint="جستجو یا فیلتر رو عوض کن."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                  className={BTN}
                >
                  پاک کردن فیلترها
                </button>
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  selectMode={selectMode}
                  selected={selected.has(a.id)}
                  refreshing={refreshing.has(a.id)}
                  onToggleSelect={toggleSelect}
                  onRefresh={openRefreshDialog}
                  onPatch={patch}
                  onRemove={remove}
                />
              ))}
            </div>
          )}

          {filtered.length > visible.length && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setShownState({ key: listKey, n: shown + ACCOUNTS_PAGE_SIZE })}
                className={BTN}
              >
                نمایش بیشتر ({fa(filtered.length - visible.length)} اکانت دیگر)
              </button>
            </div>
          )}

          {selectMode && selected.size > 0 && <BulkBar count={selected.size} bulking={bulking} onRun={runBulk} />}
        </>
      )}

      {!(loadErr && events.length === 0) && (
        <div className="mt-8">
          <EventsFeed
            events={events}
            hasMore={eventsHasMore}
            loadingMore={eventsLoadingMore}
            onLoadMore={() => void loadMoreEvents()}
          />
        </div>
      )}

      {refreshDialog && (
        <RefreshSheet
          draft={refreshDialog}
          onChange={setRefreshDialog}
          onClose={() => setRefreshDialog(null)}
          onRun={() => void runRefresh()}
        />
      )}

      {keyDialog && (
        <KeySheet
          keyPrefix={keyPrefix}
          keyName={keyName}
          keySource={keySource}
          keyInput={keyInput}
          keyNameInput={keyNameInput}
          saving={savingKey}
          onKeyInput={setKeyInput}
          onKeyNameInput={setKeyNameInput}
          onClose={() => setKeyDialog(false)}
          onSave={() => void saveKey()}
          onClear={() => void clearKeyOverride()}
        />
      )}

      {budgetDialog && budget && (
        <BudgetSettingsSheet
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
