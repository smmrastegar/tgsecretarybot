"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

const MODE_LABELS: Record<ChatMode, string> = {
  off: "Off",
  secretary: "Secretary",
  auto_reply: "Auto-reply",
  friendly_reply: "Friendly auto-reply (AI)",
  ai_chat: "AI chat (full)",
  ai_listen: "AI listen (silent, summarises)",
};

type Relationship =
  | "close_friend"
  | "friend"
  | "work_acquaintance"
  | "employer"
  | "formal"
  | "suspicious"
  | "stranger";

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  close_friend: "دوست خیلی صمیمی",
  friend: "دوست معمولی",
  work_acquaintance: "آشنای کاری",
  employer: "کارفرما",
  formal: "رودروایسی",
  suspicious: "آدم مشکوک",
  stranger: "آدم ناشناس",
};

const RELATIONSHIP_TONES: Record<
  Relationship,
  "neutral" | "success" | "warn" | "danger" | "info"
> = {
  close_friend: "success",
  friend: "info",
  work_acquaintance: "neutral",
  employer: "warn",
  formal: "neutral",
  suspicious: "danger",
  stranger: "neutral",
};

type Message = {
  id: number;
  createdAt: string;
  senderName: string;
  senderUsername: string | null;
  senderId: number | null;
  messageText: string;
  importance: number;
  urgent: boolean;
  alerted: boolean;
  autoReplied: boolean;
  mediaKind: string | null;
  transcript: string | null;
  fromOwner: boolean;
};

type Rule = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  notes: string | null;
  mode: ChatMode;
  modeChangedAt: string;
  secretaryUserId: number | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: Relationship | null;
  graceSkippedAt: string | null;
  updatedAt: string;
};

type GraceInfo = {
  minutes: number;
  lastOwnerSentAt: string | null;
};

type Stats = {
  priorCount: number;
  urgentCount: number;
  lastSeen: string | null;
  firstSeen: string | null;
};

type ThreadMsg = {
  id: number;
  createdAt: string;
  senderName: string;
  messageText: string;
  transcript: string | null;
  mediaDescription: string | null;
  mediaKind: string | null;
  mediaFileId: string | null;
  importance: number;
  urgent: boolean;
  fromOwner: boolean;
};

type ThreadGroup = {
  threadNo: number;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  senders: string[];
  messages: ThreadMsg[];
};

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const chatId = Number(params.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [grace, setGrace] = useState<GraceInfo | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [secretaries, setSecretaries] = useState<
    { userId: number; name: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [saving, setSaving] = useState(false);

  // Personal-info form (firstName / lastName / nickname / relationship).
  // Kept in a local draft so the owner can type freely; only commits on Save.
  type Personal = {
    firstName: string;
    lastName: string;
    nickname: string;
    relationship: Relationship | "";
  };
  const blankPersonal: Personal = {
    firstName: "",
    lastName: "",
    nickname: "",
    relationship: "",
  };
  const [personal, setPersonal] = useState<Personal>(blankPersonal);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [personalSaved, setPersonalSaved] = useState(false);

  const [threads, setThreads] = useState<ThreadGroup[] | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadGap, setThreadGap] = useState(5);
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(
    new Set(),
  );
  const [summaries, setSummaries] = useState<Record<number, string>>({});
  const [summarizing, setSummarizing] = useState<Set<number>>(new Set());

  const loadThreads = useCallback(
    async (gap: number) => {
      if (!Number.isFinite(chatId)) return;
      setThreadsLoading(true);
      try {
        const r = await fetch(
          `/api/chats/${chatId}/threads?gap=${gap}&limit=500`,
        );
        if (r.ok) {
          const j = (await r.json()) as { threads: ThreadGroup[] };
          setThreads(j.threads);
        }
      } finally {
        setThreadsLoading(false);
      }
    },
    [chatId],
  );

  async function summarizeThread(threadNo: number) {
    if (summarizing.has(threadNo) || summaries[threadNo]) return;
    setSummarizing((prev) => new Set(prev).add(threadNo));
    try {
      const r = await fetch(`/api/chats/${chatId}/threads/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadNo, gapMinutes: threadGap }),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          summary?: { summary?: string; topics?: string[]; actionItems?: string[] };
        };
        const parts: string[] = [];
        if (j.summary?.summary) parts.push(j.summary.summary);
        if (j.summary?.topics?.length)
          parts.push(`موضوعات: ${j.summary.topics.join(" · ")}`);
        if (j.summary?.actionItems?.length)
          parts.push(`Action items:\n• ${j.summary.actionItems.join("\n• ")}`);
        setSummaries((prev) => ({
          ...prev,
          [threadNo]: parts.join("\n\n") || "(no summary)",
        }));
      }
    } finally {
      setSummarizing((prev) => {
        const next = new Set(prev);
        next.delete(threadNo);
        return next;
      });
    }
  }

  const PAGE = 10;

  const load = useCallback(async () => {
    if (!Number.isFinite(chatId)) return;
    setLoading(true);
    const r = await fetch(`/api/chats/${chatId}?limit=${PAGE}&offset=0`);
    if (!r.ok) {
      setLoading(false);
      return;
    }
    const j = (await r.json()) as {
      rule: Rule | null;
      messages: Message[];
      stats: Stats;
      hasMore: boolean;
      grace?: GraceInfo;
    };
    setRule(j.rule);
    setMessages(j.messages);
    setStats(j.stats);
    setHasMore(j.hasMore);
    setGrace(j.grace ?? null);
    // Rehydrate the personal form so the inputs reflect what's persisted.
    setPersonal({
      firstName: j.rule?.firstName ?? "",
      lastName: j.rule?.lastName ?? "",
      nickname: j.rule?.nickname ?? "",
      relationship: j.rule?.relationship ?? "",
    });
    setPersonalDirty(false);
    setLoading(false);
  }, [chatId]);

  async function savePersonal() {
    setSaving(true);
    await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: rule?.chatType ?? "private",
        chatTitle: rule?.chatTitle ?? null,
        vip: rule?.vip ?? false,
        muted: rule?.muted ?? false,
        customReply: rule?.customReply ?? null,
        notes: rule?.notes ?? null,
        mode: rule?.mode ?? "off",
        secretaryUserId: rule?.secretaryUserId ?? null,
        firstName: personal.firstName.trim() || null,
        lastName: personal.lastName.trim() || null,
        nickname: personal.nickname.trim() || null,
        relationship: personal.relationship || null,
      }),
    });
    setSaving(false);
    setPersonalDirty(false);
    setPersonalSaved(true);
    setTimeout(() => setPersonalSaved(false), 2000);
    load();
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(
        `/api/chats/${chatId}?limit=${PAGE}&offset=${messages.length}`,
      );
      if (!r.ok) return;
      const j = (await r.json()) as {
        messages: Message[];
        hasMore: boolean;
      };
      setMessages((prev) => [...prev, ...j.messages]);
      setHasMore(j.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/secretaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.secretaries && setSecretaries(d.secretaries))
      .catch(() => {});
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function skipGrace() {
    setSaving(true);
    await fetch(`/api/chats/${chatId}/skip-grace`, { method: "POST" });
    setSaving(false);
    load();
  }

  async function patchRule(patch: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/chats/${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: rule?.chatType ?? "private",
        chatTitle: rule?.chatTitle ?? null,
        vip: rule?.vip ?? false,
        muted: rule?.muted ?? false,
        customReply: rule?.customReply ?? null,
        notes: rule?.notes ?? null,
        mode: rule?.mode ?? "off",
        secretaryUserId: rule?.secretaryUserId ?? null,
        firstName: rule?.firstName ?? null,
        lastName: rule?.lastName ?? null,
        nickname: rule?.nickname ?? null,
        relationship: rule?.relationship ?? null,
        ...patch,
      }),
    });
    setSaving(false);
    load();
  }

  const headPerson = messages.find((m) => m.senderId !== null && m.senderName);
  const customFull = [rule?.firstName, rule?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const personName =
    (customFull.length > 0 ? customFull : null) ??
    rule?.chatTitle ??
    headPerson?.senderName ??
    (chatId ? `chat ${chatId}` : "—");
  const personHandle = headPerson?.senderUsername;
  const personId = headPerson?.senderId ?? chatId;
  const updatePersonal = (patch: Partial<Personal>) => {
    setPersonal((p) => ({ ...p, ...patch }));
    setPersonalDirty(true);
  };

  return (
    <Shell>
      <div className="mb-3">
        <Link
          href="/chats"
          className="text-xs text-[var(--color-text-dim)] hover:text-white"
        >
          ← Chats
        </Link>
      </div>

      {loading ? (
        <Card>Loading…</Card>
      ) : (
        <>
          {/* Hero: person header */}
          <Card className="mb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xl font-semibold truncate" dir="auto">
                  {personName}
                  {rule?.nickname && (
                    <span className="ml-2 text-base font-normal text-[var(--color-text-dim)]">
                      ({rule.nickname})
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--color-text-dim)] mt-1 flex flex-wrap items-center gap-2">
                  {personHandle && <span>@{personHandle}</span>}
                  <span>id {personId}</span>
                  <span>· {chatTypeLabel(rule?.chatType ?? "private")}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 items-center">
                  {rule?.vip && <Badge tone="warn">⭐ VIP</Badge>}
                  {rule?.muted && <Badge tone="neutral">🔕 muted</Badge>}
                  {rule?.customReply && (
                    <Badge tone="info">custom reply</Badge>
                  )}
                  {stats && stats.priorCount > 0 && (
                    <Badge tone="neutral">
                      {stats.priorCount} messages
                    </Badge>
                  )}
                  {stats && stats.urgentCount > 0 && (
                    <Badge tone="danger">{stats.urgentCount}× urgent</Badge>
                  )}
                  {stats?.firstSeen && (
                    <Badge tone="neutral">
                      since {relTime(stats.firstSeen)}
                    </Badge>
                  )}
                </div>
                {rule?.notes && (
                  <div className="mt-3 text-sm text-[var(--color-text-dim)]">
                    📝 {rule.notes}
                  </div>
                )}

                {rule?.relationship && (
                  <div className="mt-3">
                    <Badge tone={RELATIONSHIP_TONES[rule.relationship]}>
                      {RELATIONSHIP_LABELS[rule.relationship]}
                    </Badge>
                  </div>
                )}

                <div className="mt-4 max-w-lg border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-2)]/40">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
                    Personal info (used by AI to adjust tone)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        First name
                      </label>
                      <input
                        dir="auto"
                        type="text"
                        disabled={saving}
                        value={personal.firstName}
                        onChange={(e) =>
                          updatePersonal({ firstName: e.target.value })
                        }
                        placeholder="—"
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        Last name
                      </label>
                      <input
                        dir="auto"
                        type="text"
                        disabled={saving}
                        value={personal.lastName}
                        onChange={(e) =>
                          updatePersonal({ lastName: e.target.value })
                        }
                        placeholder="—"
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        Nickname (اسم خودمونی که صداش می‌کنیم)
                      </label>
                      <input
                        dir="auto"
                        type="text"
                        disabled={saving}
                        value={personal.nickname}
                        onChange={(e) =>
                          updatePersonal({ nickname: e.target.value })
                        }
                        placeholder="مثلاً موتی / دادا"
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        Relationship
                      </label>
                      <select
                        disabled={saving}
                        value={personal.relationship}
                        onChange={(e) =>
                          updatePersonal({
                            relationship: e.target.value as
                              | Relationship
                              | "",
                          })
                        }
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      >
                        <option value="">— ست نشده —</option>
                        {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map(
                          (r) => (
                            <option key={r} value={r}>
                              {RELATIONSHIP_LABELS[r]}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={savePersonal}
                      disabled={saving || !personalDirty}
                      className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-40 hover:opacity-90"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    {personalDirty && (
                      <span className="text-[10px] text-amber-400">
                        unsaved changes
                      </span>
                    )}
                    {personalSaved && !personalDirty && (
                      <span className="text-[10px] text-emerald-400">
                        ✓ saved
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {(() => {
              const currentMode = rule?.mode ?? "off";
              if (currentMode === "off" || rule?.vip) return null;
              const last = grace?.lastOwnerSentAt
                ? new Date(grace.lastOwnerSentAt).getTime()
                : null;
              const skipped = rule?.graceSkippedAt
                ? new Date(rule.graceSkippedAt).getTime()
                : null;
              const graceMs = (grace?.minutes ?? 0) * 60_000;
              if (!last || graceMs <= 0) return null;
              const dismissed = skipped !== null && skipped > last;
              if (dismissed) return null;
              const endsAt = last + graceMs;
              const remainingMs = endsAt - nowTick;
              if (remainingMs <= 0) return null;
              const remainingMin = Math.max(1, Math.ceil(remainingMs / 60_000));
              return (
                <div className="mt-4 p-3 rounded-lg border border-amber-700/50 bg-amber-900/20 flex items-center gap-3 flex-wrap">
                  <div className="text-sm text-amber-200 flex-1 min-w-0">
                    ⏸ بات تا {remainingMin} دقیقه دیگه ساکته (شما{" "}
                    {relTime(grace!.lastOwnerSentAt!)} توی این چت پیام دادی).
                    Mode "{MODE_LABELS[currentMode]}" بعد از این پنجره خودش
                    دوباره فعال میشه.
                  </div>
                  <button
                    onClick={skipGrace}
                    disabled={saving}
                    className="text-xs px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                  >
                    ▶ Resume bot now
                  </button>
                </div>
              );
            })()}

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <label className="text-xs text-[var(--color-text-dim)]">
                Mode:
              </label>
              <select
                disabled={saving}
                value={rule?.mode ?? "off"}
                onChange={(e) =>
                  patchRule({ mode: e.target.value as ChatMode })
                }
                className="text-xs px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
              >
                {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              {rule?.modeChangedAt && (
                <span className="text-[10px] text-[var(--color-text-dim)]">
                  switched {relTime(rule.modeChangedAt)}
                </span>
              )}
              <button
                disabled={saving}
                onClick={() => patchRule({ vip: !(rule?.vip ?? false) })}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  rule?.vip
                    ? "border-amber-700 bg-amber-900/40 text-amber-200"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {rule?.vip ? "★ VIP on" : "Mark VIP"}
              </button>
              <button
                disabled={saving}
                onClick={() => patchRule({ muted: !(rule?.muted ?? false) })}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  rule?.muted
                    ? "border-[var(--color-border)] bg-[var(--color-surface-2)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {rule?.muted ? "🔕 muted" : "Mute"}
              </button>
            </div>

            {rule?.mode === "secretary" && secretaries.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-[var(--color-text-dim)]">
                    Forward to:
                  </span>
                  <select
                    disabled={saving}
                    value={String(rule?.secretaryUserId ?? "")}
                    onChange={(e) =>
                      patchRule({
                        secretaryUserId: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                  >
                    <option value="">
                      Default ({secretaries[0]?.name ?? "—"})
                    </option>
                    {secretaries.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {rule?.secretaryUserId && (
                    <span className="text-[10px] text-[var(--color-text-dim)]">
                      override active
                    </span>
                  )}
                </div>
              )}
          </Card>

          <PageTitle
            title="Threads"
            subtitle="هر فاصله‌ی سکوتِ بیشتر از چند دقیقه یه thread جدید درست می‌کنه. خلاصه‌ی هر کدوم رو با AI بگیر."
            actions={
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-[var(--color-text-dim)]">
                  gap
                </label>
                <select
                  value={threadGap}
                  onChange={(e) => {
                    const g = Number(e.target.value);
                    setThreadGap(g);
                    void loadThreads(g);
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                >
                  <option value="2">۲ دقیقه</option>
                  <option value="5">۵ دقیقه</option>
                  <option value="15">۱۵ دقیقه</option>
                  <option value="60">۱ ساعت</option>
                </select>
                <button
                  onClick={() => loadThreads(threadGap)}
                  disabled={threadsLoading}
                  className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  {threadsLoading
                    ? "Loading…"
                    : threads
                      ? "Refresh"
                      : "Load threads"}
                </button>
              </div>
            }
          />

          {!threads && !threadsLoading && (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                هنوز thread‌ها لود نشدن. روی «Load threads» بزن.
              </p>
            </Card>
          )}
          {threads && threads.length === 0 && (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                پیامی در این چت نیست.
              </p>
            </Card>
          )}
          {threads && threads.length > 0 && (
            <div className="flex flex-col gap-2 mb-6">
              {threads.map((t) => {
                const expanded = expandedThreads.has(t.threadNo);
                const started = new Date(t.startedAt);
                const ended = new Date(t.endedAt);
                const durationMs =
                  ended.getTime() - started.getTime();
                const durationMin = Math.round(durationMs / 60000);
                return (
                  <Card key={t.threadNo} className="!p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {started.toLocaleString()}{" "}
                          <span className="text-[var(--color-text-dim)]">
                            → {relTime(t.endedAt)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                          {t.messageCount} پیام · {durationMin}m ·{" "}
                          {t.senders.join("، ")}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => summarizeThread(t.threadNo)}
                          disabled={
                            summarizing.has(t.threadNo) ||
                            Boolean(summaries[t.threadNo])
                          }
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                        >
                          {summarizing.has(t.threadNo)
                            ? "Summarising…"
                            : summaries[t.threadNo]
                              ? "✓ Summary"
                              : "Summarise"}
                        </button>
                        <button
                          onClick={() =>
                            setExpandedThreads((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.threadNo))
                                next.delete(t.threadNo);
                              else next.add(t.threadNo);
                              return next;
                            })
                          }
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                        >
                          {expanded ? "بستن" : "نمایش"}
                        </button>
                      </div>
                    </div>
                    {summaries[t.threadNo] && (
                      <div
                        dir="auto"
                        className="mt-2 text-xs whitespace-pre-wrap bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2"
                      >
                        {summaries[t.threadNo]}
                      </div>
                    )}
                    {expanded && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {t.messages.map((m) => (
                          <div
                            key={m.id}
                            className={`text-xs p-2 rounded-md border ${
                              m.fromOwner
                                ? "border-blue-900/40 bg-blue-900/10"
                                : "border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                            }`}
                          >
                            <div className="flex justify-between gap-2 text-[10px] text-[var(--color-text-dim)]">
                              <span>
                                {m.fromOwner ? "you" : m.senderName}
                                {m.urgent && (
                                  <Badge tone="danger">urgent</Badge>
                                )}
                              </span>
                              <span>{relTime(m.createdAt)}</span>
                            </div>
                            <div
                              dir="auto"
                              className="mt-1 whitespace-pre-wrap break-words"
                            >
                              {m.mediaKind && (
                                <span className="text-[var(--color-text-dim)]">
                                  [{m.mediaKind}]{" "}
                                </span>
                              )}
                              {m.transcript
                                ? m.transcript
                                : m.mediaDescription
                                  ? m.mediaDescription
                                  : m.messageText || "(no text)"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <PageTitle title="Conversation" />

          {messages.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-text-dim)]">
                No messages logged for this chat yet.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {[...messages].reverse().map((m) => {
                const mine = m.fromOwner;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-1 max-w-[90%] min-w-0 ${
                      mine ? "self-end items-end" : "self-start items-start"
                    }`}
                  >
                    <div className="text-[10px] text-[var(--color-text-dim)] px-1">
                      {mine ? "You" : m.senderName} · {relTime(m.createdAt)}
                    </div>
                    <div
                      dir="auto"
                      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      className={`p-3 rounded-2xl text-sm whitespace-pre-wrap max-w-full ${
                        mine
                          ? "bg-[var(--color-accent)] text-white rounded-br-md"
                          : "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-bl-md"
                      }`}
                    >
                      {m.messageText}
                      {m.transcript && (
                        <div
                          dir="auto"
                          className="mt-2 pt-2 border-t border-white/10 text-[12px]"
                        >
                          <span className="opacity-70 text-[10px] uppercase">
                            transcript
                          </span>
                          <div
                            dir="auto"
                            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                            className="mt-1 whitespace-pre-wrap"
                          >
                            {truncate(m.transcript, 400)}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap text-[10px] px-1">
                      {m.urgent && <Badge tone="danger">urgent</Badge>}
                      {m.alerted && <Badge tone="warn">alert</Badge>}
                      {m.autoReplied && <Badge tone="info">replied</Badge>}
                      {m.mediaKind && (
                        <Badge tone="neutral">{m.mediaKind}</Badge>
                      )}
                      {!mine && (
                        <span className="text-[var(--color-text-dim)]">
                          imp {m.importance}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="self-center text-xs px-4 py-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 mt-3"
                >
                  {loadingMore ? "Loading…" : "Load 10 more older messages"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
