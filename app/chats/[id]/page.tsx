"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import MediaView from "@/components/MediaView";
import ChatRulesPanel from "@/components/ChatRulesPanel";
import CopyableChatId from "@/components/CopyableChatId";
import OtpChip from "@/components/OtpChip";
import PhoneInput from "@/components/PhoneInput";
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
  | "close_family"
  | "family"
  | "close_friend"
  | "friend"
  | "work_acquaintance"
  | "employer"
  | "formal"
  | "suspicious"
  | "stranger";

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  close_family: "فامیل نزدیک",
  family: "فامیل",
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
  close_family: "success",
  family: "info",
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
  mediaDescription: string | null;
  otpCode: string | null;
  deletedAt: string | null;
  editedAt: string | null;
  editCount: number;
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
  relationshipNotes: string | null;
  talkStyleNotes: string | null;
  toneProfile: string | null;
  toneProfileAt: string | null;
  floodCooldownUntil: string | null;
  floodDeflectedAt: string | null;
  aiProcessVoice: boolean;
  aiProcessStickers: boolean;
  aiProcessGifs: boolean;
  aiProcessPhotos: boolean;
  aiProcessVideoNotes: boolean;
  aiGeneratePhoto: boolean;
  functionRole:
    | "downloader"
    | "sms_inbox"
    | "download_archive"
    | "news"
    | "summary_inbox"
    | "storage"
    | "voice_storage"
    | "video_storage"
    | "photo_storage"
    | "notes_inbox"
    | null;
  functionConfig: Record<string, unknown> | null;
  autoSummarizeEnabled: boolean;
  autoSummarizeGapMinutes: number;
  autoSummarizeSmartTiming: boolean;
  lastAutoSummaryAt: string | null;
  autoForwardVoice: boolean;
  autoForwardVideo: boolean;
  autoForwardPhoto: boolean;
  autoForwardLocation: boolean;
  autoExtractNotes: boolean;
  isBot: boolean;
  ignored: boolean;
  phoneNumber: string | null;
  graceSkippedAt: string | null;
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  profileId: number | null;
  updatedAt: string;
};

type ProfileSummary = {
  id: number;
  name: string;
  emoji: string | null;
  isDefault: boolean;
};

const FUNCTION_ROLE_LABELS: Record<string, string> = {
  downloader: "📥 Downloader bot",
  sms_inbox: "📱 SMS inbox",
  download_archive: "🗄 Download archive",
  news: "📰 News source",
  summary_inbox: "📬 Summary inbox",
  storage: "📦 Storage (Instagram media)",
  voice_storage: "🎤 Voice storage",
  video_note_storage: "🎥 Video-note storage (round bubbles)",
  video_storage: "🎬 Video storage",
  photo_storage: "🖼 Photo storage",
  notes_inbox: "📒 Notes inbox",
};
const ALL_FUNCTION_ROLES = Object.keys(FUNCTION_ROLE_LABELS) as Array<
  keyof typeof FUNCTION_ROLE_LABELS
>;

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
  otpCode: string | null;
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
  summary: {
    summary: string;
    topics: string[];
    actionItems: string[];
    createdAt: string;
    stale: boolean;
  } | null;
};

type MessageEdit = {
  id: number;
  previousText: string | null;
  previousTranscript: string | null;
  editedAt: string;
};

function fmtFollowUpDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} دقیقه`;
  }
  if (Number.isInteger(hours)) return `${hours} ساعت`;
  return `${hours} ساعت`;
}

function EditHistoryToggle({
  messageId,
  count,
  editedAt,
}: {
  messageId: number;
  count: number;
  editedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<MessageEdit[] | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (edits) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/messages/${messageId}/edits`);
      if (r.ok) {
        const j = (await r.json()) as { edits: MessageEdit[] };
        setEdits(j.edits);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-900/40 text-amber-300 border border-amber-800 hover:bg-amber-900/60"
        title={editedAt ? `last edited ${relTime(editedAt)}` : undefined}
      >
        ✎ edited ({count})
      </button>
      {open && (
        <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2 text-[11px] max-w-md">
          {loading && (
            <span className="text-[var(--color-text-dim)]">loading…</span>
          )}
          {edits && edits.length === 0 && (
            <span className="text-[var(--color-text-dim)]">no history</span>
          )}
          {edits && edits.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {edits.map((e) => (
                <div
                  key={e.id}
                  className="border-l-2 border-amber-700 pl-2"
                >
                  <div className="text-[10px] text-[var(--color-text-dim)]">
                    before {relTime(e.editedAt)}:
                  </div>
                  <div
                    dir="auto"
                    className="whitespace-pre-wrap line-through opacity-80"
                  >
                    {e.previousText || "(empty)"}
                  </div>
                  {e.previousTranscript && (
                    <div
                      dir="auto"
                      className="mt-1 text-[10px] text-[var(--color-text-dim)] line-through"
                    >
                      transcript: {e.previousTranscript}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const chatId = Number(params.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [functionRoles, setFunctionRoles] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  type Suggestion = {
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    relationship: string | null;
    relationshipNotes: string | null;
    talkStyleNotes: string | null;
    reasoning: string;
  };
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
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
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);

  useEffect(() => {
    fetch("/api/chat-profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profiles?: ProfileSummary[] } | null) => {
        if (d?.profiles) setProfiles(d.profiles);
      })
      .catch(() => {});
  }, []);

  // Personal-info form (firstName / lastName / nickname / relationship).
  // Kept in a local draft so the owner can type freely; only commits on Save.
  type Personal = {
    firstName: string;
    lastName: string;
    nickname: string;
    relationship: Relationship | "";
    relationshipNotes: string;
    talkStyleNotes: string;
    notes: string;
  };
  const blankPersonal: Personal = {
    firstName: "",
    lastName: "",
    nickname: "",
    relationship: "",
    relationshipNotes: "",
    talkStyleNotes: "",
    notes: "",
  };
  const [personal, setPersonal] = useState<Personal>(blankPersonal);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [personalSaved, setPersonalSaved] = useState(false);

  const [threads, setThreads] = useState<ThreadGroup[] | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadGap, setThreadGap] = useState(5);
  const [threadWindow, setThreadWindow] = useState<
    "recent24h" | "recent7d" | "all"
  >("recent24h");
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(
    new Set(),
  );
  const [summarizing, setSummarizing] = useState<Set<number>>(new Set());
  const [savedActions, setSavedActions] = useState<Set<string>>(new Set());

  const loadThreads = useCallback(
    async (gap: number, window: "recent24h" | "recent7d" | "all") => {
      if (!Number.isFinite(chatId)) return;
      setThreadsLoading(true);
      const sinceHours =
        window === "recent24h" ? 24 : window === "recent7d" ? 24 * 7 : 0;
      try {
        const r = await fetch(
          `/api/chats/${chatId}/threads?gap=${gap}&limit=500&sinceHours=${sinceHours}`,
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

  async function summarizeThread(threadNo: number, force = false) {
    if (summarizing.has(threadNo)) return;
    setSummarizing((prev) => new Set(prev).add(threadNo));
    try {
      const r = await fetch(`/api/chats/${chatId}/threads/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadNo,
          gapMinutes: threadGap,
          force,
        }),
      });
      if (r.ok) {
        // Reload threads so we pick up the new persisted summary +
        // stale flag rather than tracking it locally.
        await loadThreads(threadGap, threadWindow);
      }
    } finally {
      setSummarizing((prev) => {
        const next = new Set(prev);
        next.delete(threadNo);
        return next;
      });
    }
  }

  async function addActionFromSummary(threadNo: number, title: string) {
    const key = `${threadNo}::${title}`;
    if (savedActions.has(key)) return;
    const r = await fetch(`/api/chats/${chatId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind: "action" }),
    });
    if (r.ok) {
      setSavedActions((prev) => new Set(prev).add(key));
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
      functionRoles?: string[];
      messages: Message[];
      stats: Stats;
      hasMore: boolean;
      grace?: GraceInfo;
    };
    setRule(j.rule);
    setFunctionRoles(j.functionRoles ?? []);
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
      relationshipNotes: j.rule?.relationshipNotes ?? "",
      talkStyleNotes: j.rule?.talkStyleNotes ?? "",
      notes: j.rule?.notes ?? "",
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
        notes: personal.notes.trim() || null,
        mode: rule?.mode ?? "off",
        secretaryUserId: rule?.secretaryUserId ?? null,
        firstName: personal.firstName.trim() || null,
        lastName: personal.lastName.trim() || null,
        nickname: personal.nickname.trim() || null,
        relationship: personal.relationship || null,
        relationshipNotes: personal.relationshipNotes.trim() || null,
        talkStyleNotes: personal.talkStyleNotes.trim() || null,
      }),
    });
    setSaving(false);
    setPersonalDirty(false);
    setPersonalSaved(true);
    setTimeout(() => setPersonalSaved(false), 2000);
    load();
  }

  const [fineTuning, setFineTuning] = useState(false);
  const [fineTuneMsg, setFineTuneMsg] = useState<string | null>(null);

  async function runFineTune() {
    setFineTuning(true);
    setFineTuneMsg(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/fine-tune`, {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        toneProfile?: string;
        sampleCount?: number;
        error?: string;
      };
      if (!r.ok) {
        setFineTuneMsg(j.error ?? `error ${r.status}`);
      } else {
        setFineTuneMsg(
          `Tone profile updated from ${j.sampleCount ?? "?"} owner messages.`,
        );
        await load();
      }
    } catch (err) {
      setFineTuneMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setFineTuning(false);
      setTimeout(() => setFineTuneMsg(null), 4000);
    }
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

  async function patchAutomation(patch: {
    autoForwardVoice?: boolean;
    autoForwardVideo?: boolean;
    autoForwardPhoto?: boolean;
    autoForwardLocation?: boolean;
    autoExtractNotes?: boolean;
  }) {
    setSaving(true);
    try {
      await fetch(`/api/chats/${chatId}/automation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patchProfile(profileId: number | null) {
    setSaving(true);
    try {
      await fetch(`/api/chats/${chatId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function patchFollowUp(patch: {
    enabled?: boolean;
    thresholdHours?: number;
    escalateHours?: number;
  }) {
    setSaving(true);
    try {
      await fetch(`/api/chats/${chatId}/follow-up`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } finally {
      setSaving(false);
    }
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
        <button
          onClick={() => {
            // Prefer browser-history back so the operator returns to
            // wherever they came from (/follow-up / /messages /
            // /functions / etc.) instead of always landing on /chats.
            // Fall back to /chats when there's no history (direct
            // entry point, e.g. a shared link).
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/chats");
            }
          }}
          className="text-xs text-[var(--color-text-dim)] hover:text-white"
        >
          ← برگشت
        </button>
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
                  <CopyableChatId chatId={chatId} />
                  <span>
                    ·{" "}
                    {chatTypeLabel(
                      rule?.chatType && rule.chatType !== "private"
                        ? rule.chatType
                        : chatId < 0
                          ? "supergroup"
                          : "private",
                    )}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1 items-center">
                  {rule?.ignored && <Badge tone="danger">🚫 ignored</Badge>}
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

                {chatId > 0 && rule?.chatType === "private" && !rule?.isBot && (
                <div className="mt-4 max-w-lg border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-2)]/40">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)]">
                      Personal info (used by AI to adjust tone)
                    </div>
                    <button
                      onClick={async () => {
                        setSuggesting(true);
                        try {
                          const r = await fetch(
                            `/api/chats/${chatId}/suggest`,
                            { method: "POST" },
                          );
                          if (!r.ok) {
                            const j = (await r.json().catch(() => ({}))) as {
                              error?: string;
                            };
                            alert(`خطا: ${j.error ?? r.status}`);
                            return;
                          }
                          const j = (await r.json()) as {
                            suggestion: {
                              firstName: string | null;
                              lastName: string | null;
                              nickname: string | null;
                              relationship: string | null;
                              relationshipNotes: string | null;
                              talkStyleNotes: string | null;
                              reasoning: string;
                            };
                          };
                          setSuggestion(j.suggestion);
                        } finally {
                          setSuggesting(false);
                        }
                      }}
                      disabled={suggesting}
                      className="text-[10px] px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
                      title="AI پیام‌های این چت رو می‌خونه و فیلدها رو پیشنهاد می‌ده (فارسی)"
                    >
                      {suggesting ? "در حال…" : "🤖 پیشنهاد AI"}
                    </button>
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
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        شرح رابطه (آزاد) — به AI کمک می‌کنه بدونه طرف کیه
                      </label>
                      <textarea
                        dir="auto"
                        disabled={saving}
                        value={personal.relationshipNotes}
                        onChange={(e) =>
                          updatePersonal({
                            relationshipNotes: e.target.value,
                          })
                        }
                        rows={2}
                        placeholder="مثلاً: همکار قدیمی شرکت X، اعتماد کامل، با هم پروژه Y رو می‌بریم"
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        نحوه‌ی صحبت با این فرد — قواعد سفت
                      </label>
                      <textarea
                        dir="auto"
                        disabled={saving}
                        value={personal.talkStyleNotes}
                        onChange={(e) =>
                          updatePersonal({ talkStyleNotes: e.target.value })
                        }
                        rows={2}
                        placeholder="مثلاً: رسمی، بدون شوخی، همیشه «شما». یا: خودمونی، با اموجی، کوتاه."
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                        📝 Context / Notes — هر چی اینجا بنویسی، توی همه‌ی
                        تحلیل‌های بعدی این چت (classify / summarise / AI
                        reply) به prompt تزریق می‌شه و می‌مونه.
                      </label>
                      <textarea
                        dir="auto"
                        disabled={saving}
                        value={personal.notes}
                        onChange={(e) =>
                          updatePersonal({ notes: e.target.value })
                        }
                        rows={4}
                        placeholder="مثلاً: راجع به پروژه‌ی X باهاش حرف می‌زنیم، deadline دوشنبه‌ست. یا: این هفته در حال جابه‌جایی‌ام، جزئیات کاری رو موکول کن به هفته‌ی بعد."
                        className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                      />
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

                  <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium">
                          🎯 Fine-tune لحن AI روی پیام‌های قبلی شما
                        </div>
                        <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                          فقط پیام‌هایی که خودت تایپ کردی بررسی می‌شه — پیام‌های
                          AI کنار گذاشته میشن.
                          {rule?.toneProfileAt
                            ? ` آخرین تنظیم: ${relTime(rule.toneProfileAt)}`
                            : " هنوز تنظیم نشده."}
                        </div>
                      </div>
                      <button
                        onClick={runFineTune}
                        disabled={fineTuning}
                        className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      >
                        {fineTuning
                          ? "در حال تحلیل…"
                          : rule?.toneProfile
                            ? "Re-tune"
                            : "Fine-tune now"}
                      </button>
                    </div>
                    {fineTuneMsg && (
                      <div
                        className={`text-[11px] mt-2 ${
                          fineTuneMsg.toLowerCase().includes("updat")
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }`}
                      >
                        {fineTuneMsg}
                      </div>
                    )}
                    {rule?.toneProfile && (
                      <details className="mt-2">
                        <summary className="text-[11px] text-[var(--color-text-dim)] cursor-pointer">
                          نمایش tone profile فعلی
                        </summary>
                        <pre
                          dir="auto"
                          className="mt-2 text-[11px] whitespace-pre-wrap bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2"
                        >
                          {rule.toneProfile}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
                )}

                {chatId > 0 && rule?.chatType === "private" && (
                  <div className="mt-2 max-w-lg">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.isBot)}
                        disabled={saving}
                        onChange={(e) =>
                          fetch(`/api/chats/${chatId}/is-bot`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isBot: e.target.checked }),
                          }).then(() => load())
                        }
                      />
                      🤖 این چت یک bot است
                      <span className="text-[10px] text-[var(--color-text-dim)]">
                        (تشخیص خودکار بر اساس username؛ این رو علامت بزن یا
                        بردار اگه اشتباه شناسایی شده)
                      </span>
                    </label>
                  </div>
                )}

                {rule?.isBot && (
                  <div className="mt-4 max-w-lg border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-2)]/40">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
                      🤖 Bot — independent settings
                    </div>
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                      این چت با یک bot است. معمولاً نقش function (مثلاً
                      downloader) براش ست می‌کنی و mode رو روی Off می‌ذاری تا
                      AI جوابش رو نده. notes زیر به prompt تزریق می‌شه.
                    </div>
                    <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                      اسم سفارشی (اگه خالی بمونه، نام پیش‌فرض bot استفاده می‌شه)
                    </label>
                    <input
                      dir="auto"
                      type="text"
                      disabled={saving}
                      value={personal.firstName}
                      onChange={(e) =>
                        updatePersonal({ firstName: e.target.value })
                      }
                      placeholder={rule?.chatTitle ?? "—"}
                      className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] mb-3"
                    />
                    <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                      Notes
                    </label>
                    <textarea
                      dir="auto"
                      disabled={saving}
                      value={personal.notes}
                      onChange={(e) =>
                        updatePersonal({ notes: e.target.value })
                      }
                      rows={3}
                      placeholder="مثلاً: این bot لینک اینستاگرام می‌گیره و فایل می‌فرسته. دستور دانلود: فقط لینک رو بفرست."
                      className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                    />
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
                )}

                {rule?.chatType !== "private" && !rule?.isBot && (
                  <div className="mt-4 max-w-lg border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-2)]/40">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] mb-2">
                      Channel / Group context
                    </div>
                    <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                      اسم سفارشی (اگه خالی بمونه، نام پیش‌فرض کانال/گروه استفاده می‌شه)
                    </label>
                    <input
                      dir="auto"
                      type="text"
                      disabled={saving}
                      value={personal.firstName}
                      onChange={(e) =>
                        updatePersonal({ firstName: e.target.value })
                      }
                      placeholder={rule?.chatTitle ?? "—"}
                      className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] mb-3"
                    />
                    <label className="block text-[10px] text-[var(--color-text-dim)] mb-1">
                      📝 Context / Notes — هر چی اینجا بنویسی، توی همه‌ی
                      تحلیل‌های بعدی این چت (classify / summarise) به prompt
                      تزریق می‌شه. مثلاً: «این کانال خبری‌ست — هر چه مربوط به
                      شرکت X باشد مهم است.»
                    </label>
                    <textarea
                      dir="auto"
                      disabled={saving}
                      value={personal.notes}
                      onChange={(e) =>
                        updatePersonal({ notes: e.target.value })
                      }
                      rows={4}
                      placeholder="توضیح اینکه این کانال/گروه چی هست، چی توش مهمه، آدم‌های کلیدی، …"
                      className="w-full text-sm px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                    />
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
                )}
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

              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <div className="text-xs font-medium mb-1.5">
                  🧩 نقش‌های (Functions) این چت
                </div>
                <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                  هر چت می‌تونه چند نقش هم‌زمان داشته باشه (مثلاً یه کانال هم
                  📦 Storage باشه هم 📒 Notes inbox). تیک‌های پایین رو هر تعداد
                  بخوای روشن کن.
                </div>
                <div className="flex flex-col gap-1.5 text-xs">
                  {ALL_FUNCTION_ROLES.map((k) => (
                    <label
                      key={k}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={functionRoles.includes(k)}
                        disabled={saving}
                        onChange={async (e) => {
                          const next = e.target.checked
                            ? Array.from(new Set([...functionRoles, k]))
                            : functionRoles.filter((r) => r !== k);
                          setSaving(true);
                          try {
                            await fetch(`/api/chats/${chatId}/function`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                roles: next,
                                config: rule?.functionConfig ?? null,
                              }),
                            });
                            await load();
                          } finally {
                            setSaving(false);
                          }
                        }}
                      />
                      {FUNCTION_ROLE_LABELS[k]}
                    </label>
                  ))}
                </div>
                {functionRoles.length > 0 && (
                  <div className="text-[10px] text-[var(--color-text-dim)] mt-2">
                    فعال:{" "}
                    {functionRoles
                      .map((r) => FUNCTION_ROLE_LABELS[r] ?? r)
                      .join(" · ")}
                  </div>
                )}
              </div>

              {rule?.mode === "ai_listen" && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                  <div className="text-xs font-medium mb-1.5">
                    📬 Auto-summarize threads
                  </div>
                  <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                    وقتی یه thread با گپ سکوت بسته بشه، خلاصه‌اش خودکار
                    تولید می‌شه و توی کانال «Summary inbox» (که توی
                    Functions ست کردی) با دکمه‌ی «جواب پیشنهادی» پست می‌شه.
                    پیش‌فرض خاموش.
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(rule.autoSummarizeEnabled)}
                        disabled={saving}
                        onChange={(e) =>
                          fetch(`/api/chats/${chatId}/auto-summarize`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              enabled: e.target.checked,
                              gapMinutes: rule.autoSummarizeGapMinutes ?? 5,
                              smartTiming: rule.autoSummarizeSmartTiming ?? true,
                            }),
                          }).then(() => load())
                        }
                      />
                      Auto-summarize روشن
                    </label>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--color-text-dim)]">
                      گپ سکوت برای بستن thread:
                    </span>
                    <select
                      value={rule.autoSummarizeGapMinutes ?? 5}
                      disabled={saving || !rule.autoSummarizeEnabled}
                      onChange={(e) =>
                        fetch(`/api/chats/${chatId}/auto-summarize`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            enabled: rule.autoSummarizeEnabled,
                            gapMinutes: Number(e.target.value),
                            smartTiming: rule.autoSummarizeSmartTiming ?? true,
                          }),
                        }).then(() => load())
                      }
                      className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                    >
                      <option value="2">۲ دقیقه</option>
                      <option value="5">۵ دقیقه</option>
                      <option value="10">۱۰ دقیقه</option>
                      <option value="15">۱۵ دقیقه</option>
                      <option value="30">۳۰ دقیقه</option>
                      <option value="60">۱ ساعت</option>
                    </select>
                  </div>
                  <div className="mt-2">
                    <label className="flex items-start gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={rule.autoSummarizeSmartTiming ?? true}
                        disabled={saving || !rule.autoSummarizeEnabled}
                        onChange={(e) =>
                          fetch(`/api/chats/${chatId}/auto-summarize`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              enabled: rule.autoSummarizeEnabled,
                              gapMinutes: rule.autoSummarizeGapMinutes ?? 5,
                              smartTiming: e.target.checked,
                            }),
                          }).then(() => load())
                        }
                      />
                      <span>
                        🧠 <b>timing هوشمند</b> — گپ از آخرین پیامِ «کسی که
                        thread رو شروع کرده» حساب بشه. یعنی اگه طرف پرسیده و
                        تو جواب دادی و باز خودش یه چیزی اضافه کرده، تایمر از
                        پیام آخرِ <i>اون</i> شروع می‌شه (نه از پیام تو).
                      </span>
                    </label>
                  </div>
                  {rule.lastAutoSummaryAt && (
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-2">
                      آخرین summary خودکار: {relTime(rule.lastAutoSummaryAt)}
                    </div>
                  )}
                </div>
              )}

              {rule?.mode === "ai_chat" && (
                <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                  <div className="text-xs font-medium mb-1.5">
                    🎙 پردازش خودکار رسانه در AI chat
                  </div>
                  <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                    وقتی روشن باشه، AI به جای اینکه ساکت بمونه ویس / استیکر /
                    GIF / عکس / ویدیو نوت رو می‌فهمه و جواب می‌ده. transcript
                    روی پیام پایدار می‌مونه و دفعه‌ی بعد نیازی به دکمه نیست.
                  </div>
                  <div className="flex flex-col gap-1.5 text-xs">
                    {(
                      [
                        ["aiProcessVoice", "🎤 ویس", rule.aiProcessVoice],
                        ["aiProcessStickers", "🎨 استیکر", rule.aiProcessStickers],
                        ["aiProcessGifs", "🎞 گیف", rule.aiProcessGifs],
                        ["aiProcessPhotos", "📷 عکس", rule.aiProcessPhotos],
                        ["aiProcessVideoNotes", "📹 ویدیو نوت", rule.aiProcessVideoNotes],
                        ["aiGeneratePhoto", "🖼 تولید عکس من (نیاز به Owner photo URL تو Settings)", rule.aiGeneratePhoto],
                      ] as const
                    ).map(([key, label, value]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          disabled={saving}
                          onChange={(e) =>
                            patchRule({ [key]: e.target.checked })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            {rule && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium mb-2">
                🤖 اتومیشن — کپی خودکار به کانال‌های Storage
              </div>
              <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                هر voice/video/photo که توی این چت بیاد، خودکار توی کانال نقش‌دار
                ست‌شده کپی می‌شه. لوکیشن‌ها و موارد مهم توی{" "}
                <a href="/notes" className="underline">
                  Notes
                </a>{" "}
                ذخیره می‌شن. کانال‌های هدف باید از{" "}
                <a href="/functions" className="underline">
                  Functions
                </a>{" "}
                به‌عنوان voice_storage / video_storage / photo_storage /
                notes_inbox تگ شده باشن.
              </div>
              <div className="flex flex-col gap-1.5 text-xs">
                {(
                  [
                    [
                      "autoForwardVoice",
                      "🎤 voice + 🎥 video-note → voice_storage (با دکمه‌ی 📝 Transcribe)",
                      rule.autoForwardVoice,
                    ],
                    [
                      "autoForwardVideo",
                      "🎬 video → video_storage",
                      rule.autoForwardVideo,
                    ],
                    [
                      "autoForwardPhoto",
                      "🖼 photo → photo_storage",
                      rule.autoForwardPhoto,
                    ],
                    [
                      "autoForwardLocation",
                      "📍 location → Notes + notes_inbox",
                      rule.autoForwardLocation,
                    ],
                    [
                      "autoExtractNotes",
                      "📒 استخراج خودکار آدرس/تماس/نکات مهم با AI",
                      rule.autoExtractNotes,
                    ],
                  ] as const
                ).map(([key, label, value]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      disabled={saving}
                      onChange={(e) =>
                        patchAutomation({ [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            )}
            {rule && (
              <MediaRoutingLog chatId={chatId} />
            )}
            <ChatRulesPanel chatId={chatId} />
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium mb-1.5">👤 پروفایل چت</div>
              <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
                هر چت عضو یه پروفایله؛ اگه انتخاب نکنی، خودکار «پیش‌فرض» می‌شه.
                مدیریت پروفایل‌ها توی{" "}
                <Link
                  href="/chat-profiles"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  /chat-profiles
                </Link>
                .
              </p>
              <select
                value={
                  rule?.profileId ??
                  profiles.find((p) => p.isDefault)?.id ??
                  ""
                }
                disabled={saving}
                onChange={(e) => patchProfile(Number(e.target.value))}
                className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 w-full"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.emoji ?? ""} {p.name}
                    {p.isDefault ? " (پیش‌فرض)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium mb-1.5">
                ⏰ یادآور جواب‌ندادن
              </div>
              <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
                وقتی این شخص پیام بده و شما بیشتر از{" "}
                {fmtFollowUpDuration(rule?.followUpThresholdHours ?? 2)} جواب
                ندید، توی کانال notes_inbox یه پینگ می‌فرسته با خلاصه‌ی
                پیام‌ها. اگه بازم{" "}
                {fmtFollowUpDuration(rule?.followUpEscalateHours ?? 12)} بگذره
                و جواب ندید، escalate می‌کنه.
              </p>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={Boolean(rule?.followUpEnabled ?? true)}
                  disabled={saving}
                  onChange={(e) =>
                    patchFollowUp({ enabled: e.target.checked })
                  }
                />
                <span className="text-xs">یادآور برای این چت فعال باشه</span>
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    آستانه‌ی اول
                  </span>
                  <input
                    type="number"
                    min={0.25}
                    max={168}
                    step={0.25}
                    defaultValue={rule?.followUpThresholdHours ?? 2}
                    key={`th-${rule?.followUpThresholdHours ?? 2}`}
                    disabled={saving || !(rule?.followUpEnabled ?? true)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) {
                        patchFollowUp({ thresholdHours: v });
                      }
                    }}
                    className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
                  />
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {[
                      { label: "۱۵ دقیقه", v: 0.25 },
                      { label: "نیم ساعت", v: 0.5 },
                      { label: "۱ ساعت", v: 1 },
                      { label: "۲ ساعت", v: 2 },
                      { label: "۴ ساعت", v: 4 },
                    ].map((p) => (
                      <button
                        key={p.v}
                        type="button"
                        disabled={
                          saving || !(rule?.followUpEnabled ?? true)
                        }
                        onClick={() =>
                          patchFollowUp({ thresholdHours: p.v })
                        }
                        className={`text-[10px] px-1.5 py-0.5 rounded-md border ${
                          (rule?.followUpThresholdHours ?? 2) === p.v
                            ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                            : "bg-[var(--color-surface-2)] border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                        } disabled:opacity-50`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-[var(--color-text-dim)]">
                    escalate بعد از
                  </span>
                  <input
                    type="number"
                    min={0.25}
                    max={168}
                    step={0.25}
                    defaultValue={rule?.followUpEscalateHours ?? 12}
                    key={`esc-${rule?.followUpEscalateHours ?? 12}`}
                    disabled={saving || !(rule?.followUpEnabled ?? true)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) {
                        patchFollowUp({ escalateHours: v });
                      }
                    }}
                    className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
                  />
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {[
                      { label: "۱۵ دقیقه", v: 0.25 },
                      { label: "نیم ساعت", v: 0.5 },
                      { label: "۱ ساعت", v: 1 },
                      { label: "۴ ساعت", v: 4 },
                      { label: "۱۲ ساعت", v: 12 },
                    ].map((p) => (
                      <button
                        key={p.v}
                        type="button"
                        disabled={
                          saving || !(rule?.followUpEnabled ?? true)
                        }
                        onClick={() =>
                          patchFollowUp({ escalateHours: p.v })
                        }
                        className={`text-[10px] px-1.5 py-0.5 rounded-md border ${
                          (rule?.followUpEscalateHours ?? 12) === p.v
                            ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                            : "bg-[var(--color-surface-2)] border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                        } disabled:opacity-50`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium mb-1.5">📱 شماره تلفن</div>
              <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
                این شماره برای route کردن SMSهای ورودی و هر فیچر دیگه‌ای که
                شماره می‌خواد استفاده می‌شه. با + و کد کشور بنویس (مثلاً
                +989123456789).
              </p>
              <PhoneInput
                chatId={chatId}
                initial={rule?.phoneNumber ?? null}
                onSaved={load}
              />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <ChatHistoryPurge chatId={chatId} />
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <div className="text-xs font-medium mb-1.5">🚫 نادیده گرفتن کامل</div>
              <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
                وقتی تیک می‌خوره، bot به‌صورت کامل این چت رو نادیده می‌گیره
                — هیچ classify، هیچ log، هیچ rule eval، هیچ SMS route، هیچ
                auto-reply. مثل اینه که این چت اصلاً وجود نداره برای سیستم.
              </p>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!rule?.ignored}
                  disabled={saving}
                  onChange={async (e) => {
                    await fetch(`/api/chats/${chatId}/ignored`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ ignored: e.target.checked }),
                    });
                    load();
                  }}
                />
                این چت کلاً ignore بشه
              </label>
            </div>
          </Card>

          <PageTitle
            title="Threads"
            subtitle="هر فاصله‌ی سکوتِ بیشتر از چند دقیقه یه thread جدید درست می‌کنه. خلاصه‌ی هر کدوم رو با AI بگیر — اکشن‌های پیشنهادی به Actions اضافه می‌شن."
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={threadWindow}
                  onChange={(e) => {
                    const w = e.target.value as
                      | "recent24h"
                      | "recent7d"
                      | "all";
                    setThreadWindow(w);
                    void loadThreads(threadGap, w);
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                >
                  <option value="recent24h">۲۴ ساعت اخیر</option>
                  <option value="recent7d">۷ روز اخیر</option>
                  <option value="all">همه</option>
                </select>
                <select
                  value={threadGap}
                  onChange={(e) => {
                    const g = Number(e.target.value);
                    setThreadGap(g);
                    void loadThreads(g, threadWindow);
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                  title="فاصله‌ی سکوت برای جدا کردن threadها"
                >
                  <option value="2">gap ۲ دقیقه</option>
                  <option value="5">gap ۵ دقیقه</option>
                  <option value="15">gap ۱۵ دقیقه</option>
                  <option value="60">gap ۱ ساعت</option>
                </select>
                <button
                  onClick={() => loadThreads(threadGap, threadWindow)}
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
                {threadWindow === "all"
                  ? "پیامی در این چت نیست."
                  : "توی این بازه‌ی زمانی thread‌ای نیست. فیلتر رو روی «همه» بذار یا بازه‌ی بزرگ‌تر انتخاب کن."}
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
                const sum = t.summary;
                const summarising = summarizing.has(t.threadNo);
                const summariseLabel = summarising
                  ? "Summarising…"
                  : !sum
                    ? "Summarise"
                    : sum.stale
                      ? "🔄 Update summary"
                      : "✓ Re-summarise";
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
                          {sum?.stale && (
                            <span className="ml-2 text-amber-400">
                              · پیام جدید بعد از خلاصه
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() =>
                            summarizeThread(t.threadNo, sum?.stale ?? false)
                          }
                          disabled={summarising}
                          className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                        >
                          {summariseLabel}
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
                    {sum && (
                      <div className="mt-2 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md p-2">
                        <div
                          dir="auto"
                          className="whitespace-pre-wrap"
                        >
                          {sum.summary}
                        </div>
                        {sum.topics.length > 0 && (
                          <div
                            dir="auto"
                            className="mt-2 text-[11px] text-[var(--color-text-dim)]"
                          >
                            موضوعات: {sum.topics.join(" · ")}
                          </div>
                        )}
                        {sum.actionItems.length > 0 && (
                          <div className="mt-2">
                            <div className="text-[10px] text-[var(--color-text-dim)] mb-1">
                              اکشن‌های پیشنهادی — کلیک کن تا به Actions اضافه بشه:
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {sum.actionItems.map((a, i) => {
                                const key = `${t.threadNo}::${a}`;
                                const saved = savedActions.has(key);
                                return (
                                  <button
                                    key={i}
                                    dir="auto"
                                    onClick={() =>
                                      addActionFromSummary(t.threadNo, a)
                                    }
                                    disabled={saved}
                                    className={`text-[11px] px-2 py-1 rounded-md border text-left ${
                                      saved
                                        ? "border-emerald-700 bg-emerald-900/40 text-emerald-300 cursor-default"
                                        : "border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                                    }`}
                                  >
                                    {saved ? "✓ " : "+ "}
                                    {a}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mt-2 text-[10px] text-[var(--color-text-dim)]">
                          {sum.stale
                            ? "خلاصه‌ی قبلی — پیام‌های جدیدتری اضافه شده‌ان"
                            : `خلاصه‌ی ${relTime(sum.createdAt)}`}
                        </div>
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
                            {m.mediaKind && (
                              <MediaView messageId={m.id} kind={m.mediaKind} />
                            )}
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
                        m.deletedAt
                          ? "bg-red-900/20 border border-red-900/40 text-[var(--color-text-dim)] rounded-md"
                          : mine
                            ? "bg-[var(--color-accent)] text-white rounded-br-md"
                            : "bg-[var(--color-surface)] border border-[var(--color-border)] rounded-bl-md"
                      }`}
                    >
                      {m.otpCode && (
                        <div className="mb-2">
                          <OtpChip code={m.otpCode} />
                        </div>
                      )}
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
                    {m.mediaKind && !m.deletedAt && (
                      <MediaView messageId={m.id} kind={m.mediaKind} />
                    )}
                    {m.mediaDescription && !m.deletedAt && (
                      <div
                        dir="auto"
                        style={{
                          unicodeBidi: "plaintext",
                          textAlign: "start",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                        className="text-[11px] text-[var(--color-text-dim)] max-w-full whitespace-pre-wrap border-l-2 border-[var(--color-border)] pl-2 mt-1"
                      >
                        🖼 {m.mediaDescription}
                      </div>
                    )}
                    <div className="flex gap-1 flex-wrap text-[10px] px-1">
                      {m.deletedAt && (
                        <Badge tone="danger">
                          🗑 Deleted {relTime(m.deletedAt)}
                        </Badge>
                      )}
                      {m.editCount > 0 && (
                        <EditHistoryToggle
                          messageId={m.id}
                          count={m.editCount}
                          editedAt={m.editedAt}
                        />
                      )}
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
      {suggestion && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setSuggestion(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 w-full max-w-lg my-8"
          >
            <h2 className="text-base font-semibold mb-3">
              🤖 پیشنهاد AI برای این چت
            </h2>
            <div className="text-[11px] text-[var(--color-text-dim)] mb-3 leading-relaxed">
              {suggestion.reasoning}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
              {(
                [
                  ["First name", suggestion.firstName],
                  ["Last name", suggestion.lastName],
                  ["Nickname", suggestion.nickname],
                  [
                    "Relationship",
                    suggestion.relationship
                      ? RELATIONSHIP_LABELS[
                          suggestion.relationship as keyof typeof RELATIONSHIP_LABELS
                        ] ?? suggestion.relationship
                      : null,
                  ],
                ] as const
              ).map(([label, val]) => (
                <div
                  key={label}
                  className="p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                >
                  <div className="text-[10px] text-[var(--color-text-dim)]">
                    {label}
                  </div>
                  <div className="text-[12px] mt-0.5">
                    {val ?? <span className="opacity-50">—</span>}
                  </div>
                </div>
              ))}
            </div>
            {(suggestion.relationshipNotes ||
              suggestion.talkStyleNotes) && (
              <div className="flex flex-col gap-2 mb-3">
                {suggestion.relationshipNotes && (
                  <div className="p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-0.5">
                      شرح رابطه
                    </div>
                    <div className="text-[12px]">
                      {suggestion.relationshipNotes}
                    </div>
                  </div>
                )}
                {suggestion.talkStyleNotes && (
                  <div className="p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
                    <div className="text-[10px] text-[var(--color-text-dim)] mb-0.5">
                      لحن صحبت
                    </div>
                    <div className="text-[12px]">
                      {suggestion.talkStyleNotes}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSuggestion(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                رد کن
              </button>
              <button
                onClick={async () => {
                  await patchRule({
                    firstName: suggestion.firstName,
                    lastName: suggestion.lastName,
                    nickname: suggestion.nickname,
                    relationship: suggestion.relationship,
                    relationshipNotes: suggestion.relationshipNotes,
                    talkStyleNotes: suggestion.talkStyleNotes,
                  });
                  setSuggestion(null);
                }}
                className="text-xs px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-white"
              >
                ✅ اعمال کن
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

type LogEntry = {
  id: number;
  sourceChatId: number;
  sourceMessageId: number | null;
  kind: string;
  decision: string;
  targetRole: string | null;
  targetChatId: number | null;
  targetMessageId: number | null;
  error: string | null;
  createdAt: string;
};

function MediaRoutingLog({ chatId }: { chatId: number }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/media-routing-log?chatId=${chatId}`,
      );
      if (r.ok) {
        const j = (await r.json()) as { log: LogEntry[] };
        setLog(j.log);
      }
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const decisionStyle: Record<string, string> = {
    routed: "border-emerald-700 bg-emerald-900/20 text-emerald-300",
    no_rule: "border-[var(--color-border)] bg-[var(--color-surface-2)]/30",
    flag_off: "border-amber-700 bg-amber-900/20 text-amber-300",
    muted: "border-amber-700 bg-amber-900/20 text-amber-300",
    no_target: "border-red-700 bg-red-900/20 text-red-300",
    error: "border-red-700 bg-red-900/20 text-red-300",
  };
  const decisionLabel: Record<string, string> = {
    routed: "✅ کپی شد",
    no_rule: "ℹ️ chat_rules نداره",
    flag_off: "⏸ flag خاموش",
    muted: "🔇 muted",
    no_target: "❌ کانال هدف ست نیست",
    error: "🔴 خطای ارسال",
  };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={() => setOpen(!open)}
          className="text-xs font-medium flex items-center gap-2 hover:text-white text-[var(--color-text-dim)]"
        >
          <span>{open ? "▼" : "▶"}</span>
          🛰 Media routing log
          <span className="text-[10px]">
            (دلیل اینکه چرا voice/video/photo رفت یا نرفت)
          </span>
        </button>
        <a
          href="/media-routing"
          className="text-[10px] text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
        >
          → همه‌ی چت‌ها
        </a>
      </div>
      {open && (
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={reload}
              disabled={loading}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {loading ? "…" : "🔄"}
            </button>
            <span className="text-[10px] text-[var(--color-text-dim)]">
              {log.length} مورد آخر برای این چت
            </span>
          </div>
          {log.length === 0 ? (
            <div className="text-[11px] text-[var(--color-text-dim)]">
              لاگ خالیه. اولین voice/video/photo که توی این چت بیاد، تصمیم
              router اینجا ثبت می‌شه.
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
              {log.map((e) => (
                <div
                  key={e.id}
                  className={`text-[11px] p-1.5 rounded-md border ${
                    decisionStyle[e.decision] ?? "border-[var(--color-border)]"
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">
                      {decisionLabel[e.decision] ?? e.decision}
                    </span>
                    <span className="text-[10px]" dir="ltr">
                      {e.kind}
                    </span>
                    {e.targetChatId && (
                      <span className="text-[10px]" dir="ltr">
                        → {e.targetRole}:{e.targetChatId}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--color-text-dim)] ml-auto">
                      {relTime(e.createdAt)}
                    </span>
                  </div>
                  {e.error && (
                    <div
                      dir="ltr"
                      className="text-[10px] mt-1 break-all font-mono opacity-80"
                    >
                      {e.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatHistoryPurge({ chatId }: { chatId: number }) {
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState<{
    messages: number;
    reactions: number;
    oldestAt: string | null;
    newestAt: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const runPreview = async () => {
    setPreviewLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/history?days=${days}`);
      if (r.ok) setPreview(await r.json());
    } finally {
      setPreviewLoading(false);
    }
  };

  const purge = async () => {
    if (!preview || preview.messages === 0) return;
    if (
      !confirm(
        `${preview.messages} پیام + ${preview.reactions} ری‌اکشن قدیمی‌تر از ${days} روز برای همیشه پاک بشه؟ این عملیات قابل بازگشت نیست.`,
      )
    )
      return;
    setPurging(true);
    setResult(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/history?days=${days}`, {
        method: "DELETE",
      });
      if (r.ok) {
        const j = (await r.json()) as {
          messages: number;
          reactions: number;
        };
        setResult(
          `✅ ${j.messages} پیام + ${j.reactions} ری‌اکشن پاک شد.`,
        );
        setPreview(null);
      } else {
        setResult(`❌ HTTP ${r.status}`);
      }
    } finally {
      setPurging(false);
    }
  };

  return (
    <>
      <div className="text-xs font-medium mb-1.5">
        🗑 پاک کردن تاریخچه قدیمی
      </div>
      <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
        پیام‌های قدیمی‌تر از این مدت رو از <code>messages_log</code> پاک
        می‌کنه + ری‌اکشن‌های متناظر. این عملیات قابل بازگشت نیست — خوبه
        قبل از حذف یه پیش‌نمایش بگیری.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPreview(null);
            setResult(null);
          }}
          disabled={previewLoading || purging}
          className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
        >
          <option value={7}>قدیمی‌تر از ۷ روز</option>
          <option value={14}>قدیمی‌تر از ۱۴ روز</option>
          <option value={30}>قدیمی‌تر از ۳۰ روز</option>
          <option value={60}>قدیمی‌تر از ۶۰ روز</option>
          <option value={90}>قدیمی‌تر از ۹۰ روز</option>
          <option value={180}>قدیمی‌تر از ۶ ماه</option>
          <option value={365}>قدیمی‌تر از ۱ سال</option>
        </select>
        <button
          onClick={runPreview}
          disabled={previewLoading || purging}
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
        >
          {previewLoading ? "..." : "🔢 پیش‌نمایش"}
        </button>
        {preview && preview.messages > 0 && (
          <button
            onClick={purge}
            disabled={purging}
            className="text-xs px-3 py-1.5 rounded-md bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
          >
            {purging
              ? "..."
              : `🗑 پاک کن (${preview.messages} پیام)`}
          </button>
        )}
      </div>
      {preview && (
        <div className="text-[10px] text-[var(--color-text-dim)] mt-2">
          {preview.messages === 0
            ? `هیچ پیامی قدیمی‌تر از ${days} روز نیست.`
            : `${preview.messages} پیام + ${preview.reactions} ری‌اکشن. قدیمی‌ترین: ${preview.oldestAt ? new Date(preview.oldestAt).toLocaleDateString("fa-IR") : "—"}، جدیدترین: ${preview.newestAt ? new Date(preview.newestAt).toLocaleDateString("fa-IR") : "—"}`}
        </div>
      )}
      {result && (
        <div className="text-[10px] text-[var(--color-text-dim)] mt-2">
          {result}
        </div>
      )}
    </>
  );
}
