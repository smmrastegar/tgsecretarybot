"use client";

import type { ReactNode } from "react";
import { fa } from "@/components/chat-detail/shared";

// Types, constants and small presentational helpers shared by the Instagram monitoring page and its
// components. Nothing here talks to the network; the page owns every fetch.

export { fa };

export type Account = {
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

export type MonitorEvent = {
  id: number;
  accountId: number;
  username: string | null;
  storyUrl: string | null;
  detectedAt: string;
  forwardedAt: string | null;
  status: string;
  error: string | null;
};

export type ChatBrief = {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

export type Defaults = {
  intervalMinutes: number;
  checkStories: boolean;
  checkPosts: boolean;
  checkReels: boolean;
  checkProfile: boolean;
  checkMentioned: boolean;
};

export type Usage = {
  configured?: boolean;
  balanceUsd?: number | null;
  rateLimitPerSec?: number | null;
};

export type BudgetState = {
  spentUsd: number;
  approvedUsd: number;
  budgetUsd: number;
  stepUsd: number;
  costPerCallUsd: number;
  needsApproval: boolean;
  budgetExceeded: boolean;
  nextThresholdUsd: number;
};

export type Bucket = { at: string; calls: number; costUsd: number };
export type Window = { calls: number; costUsd: number };
export type Summary = {
  lastHour: Window;
  today: Window;
  last7d: Window;
  last30d: Window;
  allTime: Window;
};
export type HikerCall = {
  id: number;
  calledAt: string;
  endpoint: string;
  costUsd: number;
  accountId: number | null;
};

export type Diagnose = {
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

export type RefreshDraft = {
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
};

export type OutOfCredits = { message: string; billingUrl: string };

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
export const INTERVAL_OPTIONS = [180, 360, 720, 1440] as const;

export const TEHRAN_TRIGGER_HOURS: Record<number, number[]> = {
  180: [9, 12, 15, 18, 21],
  360: [10, 16, 22],
  720: [10, 22],
  1440: [19],
};

export function intervalLabel(m: number): string {
  if (m < 60) return `${fa(m)} دقیقه`;
  if (m === 60) return "۱ ساعت";
  if (m === 1440) return "۲۴ ساعت (روزانه)";
  if (m % 60 === 0) return `${fa(m / 60)} ساعت`;
  return `${fa(m)} دقیقه`;
}

export function chatLabel(c: ChatBrief): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.nickname || c.chatTitle || `chat ${c.chatId}`;
}

// The five per-account "what to fetch" switches (same keys the API patch/bulk bodies use).
export const CHECK_KINDS = [
  ["checkStories", "📸 stories"],
  ["checkPosts", "🖼 posts"],
  ["checkReels", "🎬 reels"],
  ["checkMentioned", "🏷 mentioned"],
  ["checkProfile", "👤 profile"],
] as const;

export type CheckKey = (typeof CHECK_KINDS)[number][0];

// Dollar amount in Persian digits, kept left-to-right so "$" stays in front of the number.
export function Usd({ v, d = 2 }: { v: number; d?: number }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      ${fa(v.toFixed(d))}
    </bdi>
  );
}

export const FIELD =
  "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 disabled:opacity-50";
export const SELECT = `${FIELD} text-center [text-align-last:center]`;
export const BTN =
  "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm inline-flex items-center justify-center gap-1.5 active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
export const BTN_PRIMARY =
  "min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium inline-flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50";
export const BTN_OK =
  "min-h-11 px-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
export const BTN_AMBER =
  "min-h-11 px-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
export const BTN_DANGER =
  "min-h-11 px-4 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-sm inline-flex items-center justify-center gap-1.5 hover:bg-rose-500/20 disabled:opacity-50";

// A small labelled number in a tile: used by the summary strip and the budget panels.
export function Tile({
  label,
  children,
  sub,
  tone = "neutral",
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const border = {
    neutral: "border-[var(--color-border)]",
    ok: "border-emerald-500/30",
    warn: "border-amber-500/40",
    bad: "border-rose-500/40",
  }[tone];
  const text = { neutral: "", ok: "text-emerald-300", warn: "text-amber-200", bad: "text-rose-300" }[tone];
  return (
    <div className={`rounded-2xl border ${border} bg-[var(--color-surface)] px-2 py-2.5 text-center min-w-0`}>
      <div className={`text-xl font-semibold tabular-nums leading-8 truncate ${text}`}>{children}</div>
      <div className="text-xs text-[var(--color-text-dim)] truncate">{label}</div>
      {sub != null && <div className="text-xs text-[var(--color-text-dim)] truncate tabular-nums">{sub}</div>}
    </div>
  );
}

// One horizontally-scrollable filter chip (the row scrolls instead of wrapping).
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 min-h-10 px-3.5 rounded-full border text-sm whitespace-nowrap ${
        active
          ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
          : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-dim)]"
      }`}
    >
      {children}
    </button>
  );
}

// A one-line state banner (problem / hint) with an optional action on the physical left.
export function Banner({
  tone,
  children,
  action,
}: {
  tone: "warn" | "bad" | "ok";
  children: ReactNode;
  action?: ReactNode;
}) {
  const c = {
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    bad: "border-rose-400/50 bg-rose-500/10 text-rose-100",
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  }[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`mb-3 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm text-center ${c}`}
    >
      <span className="min-w-0 flex-1 leading-6 [overflow-wrap:anywhere]">{children}</span>
      {action}
    </div>
  );
}
