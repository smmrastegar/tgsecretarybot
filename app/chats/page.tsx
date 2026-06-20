"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge, TableWrap } from "@/components/Card";
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

const MODE_TONES: Record<
  ChatMode,
  "neutral" | "success" | "warn" | "danger" | "info"
> = {
  off: "neutral",
  secretary: "warn",
  auto_reply: "info",
  friendly_reply: "info",
  ai_chat: "success",
  ai_listen: "info",
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

type Chat = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  relationship: Relationship | null;
  messages: number;
  urgent: number;
  lastSeen: string | null;
  vip: boolean;
  muted: boolean;
  customReply: string | null;
  mode: ChatMode;
  modeChangedAt: string | null;
  secretaryUserId: number | null;
  functionRole: string | null;
  isBot: boolean;
  aiCostUsd: number;
  aiTokens: number;
};

const FUNCTION_ROLE_BADGE: Record<string, string> = {
  downloader: "📥",
  sms_inbox: "📱",
  download_archive: "🗄",
  news: "📰",
  summary_inbox: "📬",
  storage: "📦",
};

type Secretary = { userId: number; name: string };

function chatDisplayName(c: {
  chatId: number;
  chatTitle: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return c.chatTitle ?? `chat ${c.chatId}`;
}

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Chat | null>(null);
  const [secretaries, setSecretaries] = useState<Secretary[]>([]);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | ChatMode>("all");
  const [typeFilter, setTypeFilter] = useState<
    "all" | "private" | "bot" | "group" | "channel"
  >("all");
  // "unset" = chats with no relationship value at all (null). A
  // specific value filters to exactly that relationship. "all" = no
  // filter. Same convention applies to roleFilter / flagFilter.
  const [relationshipFilter, setRelationshipFilter] = useState<
    "all" | "unset" | Relationship
  >("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "unset" | string>(
    "all",
  );
  const [flagFilter, setFlagFilter] = useState<"all" | "vip" | "muted">("all");
  const [profileFilter, setProfileFilter] = useState<"all" | number>("all");
  // Advanced toggles — undefined means "ignore this filter"; true = required ON, false = required OFF.
  type AdvKey =
    | "autoSummarize"
    | "followUp"
    | "followUpTranscribe"
    | "autoForwardVoice"
    | "autoForwardVideo"
    | "autoForwardPhoto"
    | "autoExtractNotes"
    | "hasProfile"
    | "hasPhone"
    | "isBot";
  const [advanced, setAdvanced] = useState<Partial<Record<AdvKey, boolean>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  type Facets = {
    total: number;
    byMode: Record<string, number>;
    byChatType: Record<string, number>;
    byRelationship: Record<string, number>;
    byFunctionRole: Record<string, number>;
    byProfile: Array<{
      profileId: number | null;
      name: string;
      emoji: string | null;
      isDefault: boolean;
      count: number;
    }>;
    flags: Record<string, number>;
  };
  const [facets, setFacets] = useState<Facets | null>(null);
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [bulkRules, setBulkRules] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [bulkProfiles, setBulkProfiles] = useState<
    { id: number; name: string; emoji: string | null }[]
  >([]);
  useEffect(() => {
    fetch("/api/rules")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rules?: { id: number; name: string }[] } | null) => {
        if (j?.rules) setBulkRules(j.rules);
      })
      .catch(() => {});
    fetch("/api/chat-profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          j: {
            profiles?: { id: number; name: string; emoji: string | null }[];
          } | null,
        ) => {
          if (j?.profiles) setBulkProfiles(j.profiles);
        },
      )
      .catch(() => {});
  }, []);

  const PAGE = 30;
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Build the query string from current filter state. The "all" /
  // "unset" sentinels stay client-side; "unset" maps to the
  // server's __unset__ sentinel which means "no value set".
  const buildFilterQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (modeFilter !== "all") p.set("mode", modeFilter);
    if (typeFilter !== "all") {
      // Server interprets "private" / "bot" / "group" / "channel" as
      // composite filters (private excludes bots, group includes
      // supergroup, etc.) — pass-through.
      p.set("chatType", typeFilter);
    }
    if (relationshipFilter === "unset") p.set("relationship", "__unset__");
    else if (relationshipFilter !== "all")
      p.set("relationship", relationshipFilter);
    if (roleFilter === "unset") p.set("role", "__unset__");
    else if (roleFilter !== "all") p.set("role", roleFilter);
    if (flagFilter === "vip") p.set("vip", "1");
    else if (flagFilter === "muted") p.set("muted", "1");
    if (profileFilter !== "all") p.set("profileId", String(profileFilter));
    if (search.trim()) p.set("q", search.trim());
    for (const [k, v] of Object.entries(advanced)) {
      if (v === undefined) continue;
      p.set(k, v ? "1" : "0");
    }
    return p;
  }, [
    modeFilter,
    typeFilter,
    relationshipFilter,
    roleFilter,
    flagFilter,
    profileFilter,
    search,
    advanced,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    const p = buildFilterQuery();
    p.set("limit", String(PAGE));
    p.set("offset", "0");
    const r = await fetch(`/api/chats?${p}`);
    const j = (await r.json()) as { chats: Chat[] };
    setChats(j.chats);
    setHasMore(j.chats.length === PAGE);
    setSelected(new Set());
    setLoading(false);
    // Refresh the matching-total alongside so the "select all" label
    // and the "X نمایش / Y کل" indicator stay accurate.
    try {
      const idsP = buildFilterQuery();
      idsP.set("idsOnly", "1");
      const idsR = await fetch(`/api/chats?${idsP}`);
      if (idsR.ok) {
        const idsJ = (await idsR.json()) as { chatIds: number[] };
        setTotalMatching(idsJ.chatIds.length);
      } else {
        setTotalMatching(null);
      }
    } catch {
      setTotalMatching(null);
    }
  }, [buildFilterQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const p = buildFilterQuery();
    p.set("limit", String(PAGE));
    p.set("offset", String(chats.length));
    const r = await fetch(`/api/chats?${p}`);
    const j = (await r.json()) as { chats: Chat[] };
    setChats((prev) => [...prev, ...j.chats]);
    setHasMore(j.chats.length === PAGE);
    setLoadingMore(false);
  }, [loadingMore, hasMore, chats.length, buildFilterQuery]);

  // Pull global facet counts once + after every load so dropdown
  // counts reflect the WHOLE system instead of the loaded subset.
  useEffect(() => {
    fetch("/api/chats?facets=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { facets?: Facets } | null) => {
        if (j?.facets) setFacets(j.facets);
      })
      .catch(() => {});
  }, []);

  // Re-fetch the list whenever any filter changes (with a tiny debounce
  // on free-text search to avoid spamming the API).
  useEffect(() => {
    const t = setTimeout(load, search.trim() ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modeFilter,
    typeFilter,
    relationshipFilter,
    roleFilter,
    flagFilter,
    profileFilter,
    search,
    advanced,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chatMatchesSearch(c: Chat, q: string): boolean {
    if (!q) return true;
    const fields = [
      c.chatTitle,
      c.firstName,
      c.lastName,
      c.nickname,
      String(c.chatId),
    ];
    return fields.some((f) => f && f.toLowerCase().includes(q));
  }

  function chatMatchesType(
    c: Chat,
    t: "all" | "private" | "bot" | "group" | "channel",
  ): boolean {
    if (t === "all") return true;
    if (t === "bot") return c.isBot;
    if (t === "private") return c.chatType === "private" && !c.isBot;
    if (t === "group")
      return c.chatType === "group" || c.chatType === "supergroup";
    if (t === "channel") return c.chatType === "channel";
    return true;
  }

  // Server applies the filters now; pass-through so existing
  // references (selectAll, list rendering, bulk action) keep working.
  const filteredChats = chats;

  async function selectAll() {
    // Fetch every chat_id matching the current filter (not just the
    // loaded page), so bulk actions target the whole filtered set.
    try {
      const p = buildFilterQuery();
      p.set("idsOnly", "1");
      const r = await fetch(`/api/chats?${p}`);
      if (r.ok) {
        const j = (await r.json()) as { chatIds: number[] };
        setSelected(new Set(j.chatIds));
        return;
      }
    } catch {
      // fall through to local fallback
    }
    setSelected(new Set(filteredChats.map((c) => c.chatId)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function runBulk(
    op:
      | "mode"
      | "vip"
      | "muted"
      | "function"
      | "auto_summarize"
      | "automation"
      | "rule_recipient"
      | "profile",
    extra: {
      mode?: ChatMode;
      value?: boolean;
      role?: string | null;
      gapMinutes?: number;
      ruleId?: number;
      profileId?: number | null;
      automation?: {
        autoForwardVoice?: boolean;
        autoForwardVideo?: boolean;
        autoForwardPhoto?: boolean;
        autoForwardLocation?: boolean;
        autoExtractNotes?: boolean;
      };
    } = {},
  ) {
    if (selected.size === 0) return;
    setBulking(true);
    try {
      const r = await fetch("/api/chats/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op,
          chatIds: [...selected],
          ...extra,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        alert(`عملیات شکست خورد: ${j.error ?? r.status}`);
      } else {
        await load();
      }
    } finally {
      setBulking(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/secretaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.secretaries && setSecretaries(d.secretaries))
      .catch(() => {});
  }, [load]);

  function secretaryName(id: number | null): string {
    if (id == null) return secretaries[0]?.name ?? "—";
    return secretaries.find((s) => s.userId === id)?.name ?? `user ${id}`;
  }

  async function save(c: Chat) {
    await fetch(`/api/chats/${c.chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: c.chatType,
        chatTitle: c.chatTitle,
        vip: c.vip,
        muted: c.muted,
        customReply: c.customReply || null,
        mode: c.mode,
        secretaryUserId: c.secretaryUserId,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        nickname: c.nickname || null,
        relationship: c.relationship || null,
      }),
    });
    setEdit(null);
    load();
  }

  async function quickMode(c: Chat, mode: ChatMode) {
    await fetch(`/api/chats/${c.chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: c.chatType,
        chatTitle: c.chatTitle,
        mode,
      }),
    });
    load();
  }

  async function quickSecretary(c: Chat, secretaryUserId: number | null) {
    await fetch(`/api/chats/${c.chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatType: c.chatType,
        chatTitle: c.chatTitle,
        secretaryUserId,
      }),
    });
    load();
  }

  return (
    <Shell>
      <PageTitle
        title="Chats"
        subtitle="Tune per-chat behavior. VIP = always alert. Muted = ignore entirely."
      />

      {loading && chats.length === 0 ? (
        <Card>Loading…</Card>
      ) : (
        <>
        <Card className="mb-3 !p-3">
          <div className="flex flex-col gap-2">
            <input
              dir="auto"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جستجو در اسم / nickname / id / title…"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[var(--color-text-dim)]">Mode:</span>
              <select
                value={modeFilter}
                onChange={(e) =>
                  setModeFilter(e.target.value as "all" | ChatMode)
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه ({facets?.total ?? "…"})</option>
                {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => {
                  const n = facets?.byMode[m] ?? 0;
                  return (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]} ({n})
                    </option>
                  );
                })}
              </select>
              <span className="text-[var(--color-text-dim)]">Type:</span>
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(
                    e.target.value as
                      | "all"
                      | "private"
                      | "bot"
                      | "group"
                      | "channel",
                  )
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                {(
                  [
                    ["all", "همه"],
                    ["private", "👤 شخصی"],
                    ["bot", "🤖 بات"],
                    ["group", "👥 گروه"],
                    ["channel", "📰 کانال"],
                  ] as const
                ).map(([k, label]) => {
                  let n: number;
                  if (k === "all") n = facets?.total ?? chats.length;
                  else n = facets?.byChatType[k] ?? 0;
                  return (
                    <option key={k} value={k}>
                      {label} ({n})
                    </option>
                  );
                })}
              </select>
              <span className="text-[var(--color-text-dim)]">رابطه:</span>
              <select
                value={relationshipFilter}
                onChange={(e) =>
                  setRelationshipFilter(
                    e.target.value as "all" | "unset" | Relationship,
                  )
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه ({facets?.total ?? "…"})</option>
                <option value="unset">
                  بدون رابطه ({facets?.byRelationship["__unset__"] ?? 0})
                </option>
                {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map(
                  (r) => {
                    const n = facets?.byRelationship[r] ?? 0;
                    if (n === 0) return null;
                    return (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]} ({n})
                      </option>
                    );
                  },
                )}
              </select>
              <span className="text-[var(--color-text-dim)]">پروفایل:</span>
              <select
                value={profileFilter}
                onChange={(e) =>
                  setProfileFilter(
                    e.target.value === "all" ? "all" : Number(e.target.value),
                  )
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه ({facets?.total ?? "…"})</option>
                {(facets?.byProfile ?? []).map((p) => (
                  <option key={p.profileId ?? "x"} value={p.profileId ?? ""}>
                    {p.emoji ?? "📋"} {p.name} ({p.count})
                  </option>
                ))}
              </select>
              <span className="text-[var(--color-text-dim)]">نقش:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه ({facets?.total ?? "…"})</option>
                <option value="unset">
                  بدون نقش ({facets?.byFunctionRole["__unset__"] ?? 0})
                </option>
                {Object.keys(FUNCTION_ROLE_BADGE).map((r) => {
                  const n = facets?.byFunctionRole[r] ?? 0;
                  if (n === 0) return null;
                  return (
                    <option key={r} value={r}>
                      {FUNCTION_ROLE_BADGE[r]} {r} ({n})
                    </option>
                  );
                })}
              </select>
              <span className="text-[var(--color-text-dim)]">لیبل:</span>
              <select
                value={flagFilter}
                onChange={(e) =>
                  setFlagFilter(e.target.value as "all" | "vip" | "muted")
                }
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
              >
                <option value="all">همه</option>
                <option value="vip">⭐ VIP ({facets?.flags.vip ?? 0})</option>
                <option value="muted">
                  🔇 Muted ({facets?.flags.muted ?? 0})
                </option>
              </select>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              >
                {showAdvanced ? "▴ بستن پیشرفته" : "▾ فیلتر پیشرفته"}
              </button>
              {(relationshipFilter !== "all" ||
                roleFilter !== "all" ||
                flagFilter !== "all" ||
                modeFilter !== "all" ||
                typeFilter !== "all" ||
                profileFilter !== "all" ||
                Object.values(advanced).some((v) => v !== undefined) ||
                search.trim()) && (
                <button
                  onClick={() => {
                    setRelationshipFilter("all");
                    setRoleFilter("all");
                    setFlagFilter("all");
                    setModeFilter("all");
                    setTypeFilter("all");
                    setProfileFilter("all");
                    setAdvanced({});
                    setSearch("");
                  }}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
                  title="پاک کردن همه فیلترها"
                >
                  ✕ پاک
                </button>
              )}
              <span className="text-[var(--color-text-dim)] ml-auto">
                {filteredChats.length} نمایش
                {totalMatching != null
                  ? ` / ${totalMatching} مطابقت`
                  : ""}
                {facets ? ` / ${facets.total} کل` : ""}
                {" / "}
                {selected.size} انتخاب
              </span>
            </div>
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-[var(--color-border)] text-xs">
                {(
                  [
                    ["autoSummarize", "📊 auto-summarize روشن", facets?.flags.autoSummarizeOn ?? 0],
                    ["followUp", "⏰ follow-up روشن", facets?.flags.followUpOn ?? 0],
                    ["followUpTranscribe", "🎤 transcribe ویس در follow-up", facets?.flags.followUpTranscribeOn ?? 0],
                    ["autoForwardVoice", "🎤 auto-forward ویس", facets?.flags.autoForwardVoiceOn ?? 0],
                    ["autoForwardVideo", "🎥 auto-forward ویدئو", facets?.flags.autoForwardVideoOn ?? 0],
                    ["autoForwardPhoto", "📸 auto-forward عکس", facets?.flags.autoForwardPhotoOn ?? 0],
                    ["autoExtractNotes", "📒 استخراج خودکار Notes", facets?.flags.autoExtractNotesOn ?? 0],
                    ["hasProfile", "👤 پروفایل صریح", facets?.flags.hasProfile ?? 0],
                    ["hasPhone", "📱 شماره تلفن ست شده", facets?.flags.hasPhone ?? 0],
                    ["isBot", "🤖 بات", facets?.flags.isBot ?? 0],
                  ] as Array<[AdvKey, string, number]>
                ).map(([k, label, n]) => {
                  const v = advanced[k];
                  return (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/30"
                    >
                      <span>
                        {label}{" "}
                        <span className="text-[var(--color-text-dim)] text-[10px]">
                          ({n})
                        </span>
                      </span>
                      <select
                        value={v === undefined ? "" : v ? "on" : "off"}
                        onChange={(e) => {
                          const nv = e.target.value;
                          setAdvanced((cur) => ({
                            ...cur,
                            [k]: nv === "" ? undefined : nv === "on",
                          }));
                        }}
                        className="text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-1.5 py-1"
                      >
                        <option value="">— بی‌تأثیر</option>
                        <option value="on">فقط روشن‌ها</option>
                        <option value="off">فقط خاموش‌ها</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
            {selected.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs pt-2 border-t border-[var(--color-border)]">
                <button
                  onClick={selectNone}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Clear
                </button>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value as ChatMode | "";
                    if (!v) return;
                    void runBulk("mode", { mode: v });
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                >
                  <option value="">Set mode to…</option>
                  {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => runBulk("vip", { value: true })}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-amber-700 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
                >
                  ⭐ Mark VIP
                </button>
                <button
                  onClick={() => runBulk("vip", { value: false })}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Unmark VIP
                </button>
                <button
                  onClick={() => runBulk("muted", { value: true })}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  🔕 Mute
                </button>
                <button
                  onClick={() => runBulk("muted", { value: false })}
                  disabled={bulking}
                  className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Unmute
                </button>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const role = v === "__clear" ? null : v;
                    void runBulk("function", { role });
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                >
                  <option value="">Set function role…</option>
                  <option value="downloader">📥 Downloader</option>
                  <option value="sms_inbox">📱 SMS inbox</option>
                  <option value="download_archive">🗄 Archive</option>
                  <option value="news">📰 News</option>
                  <option value="summary_inbox">📬 Summary inbox</option>
                  <option value="storage">📦 Storage</option>
                  <option value="__clear">— Clear role —</option>
                </select>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (v === "off") {
                      void runBulk("auto_summarize", { value: false });
                    } else {
                      void runBulk("auto_summarize", {
                        value: true,
                        gapMinutes: Number(v),
                      });
                    }
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                  title="Bulk Auto-summarize — وقتی روشن باشه، threadهای ساکت‌شده توی summary_inbox خلاصه می‌شن"
                >
                  <option value="">📬 Auto-summarize…</option>
                  <option value="2">روشن، گپ ۲ دقیقه</option>
                  <option value="5">روشن، گپ ۵ دقیقه</option>
                  <option value="10">روشن، گپ ۱۰ دقیقه</option>
                  <option value="15">روشن، گپ ۱۵ دقیقه</option>
                  <option value="30">روشن، گپ ۳۰ دقیقه</option>
                  <option value="60">روشن، گپ ۱ ساعت</option>
                  <option value="off">— Off —</option>
                </select>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const [field, value] = v.split(":");
                    if (!field) return;
                    const on = value === "on";
                    void runBulk("automation", {
                      automation: { [field]: on },
                    });
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                  title="Bulk اتومیشن — voice/video/photo/location → storage channels، یا استخراج خودکار Notes"
                >
                  <option value="">🤖 Automation…</option>
                  <option value="autoForwardVoice:on">
                    🎤 voice/video-note → on
                  </option>
                  <option value="autoForwardVoice:off">
                    🎤 voice/video-note → off
                  </option>
                  <option value="autoForwardVideo:on">🎬 video → on</option>
                  <option value="autoForwardVideo:off">🎬 video → off</option>
                  <option value="autoForwardPhoto:on">🖼 photo → on</option>
                  <option value="autoForwardPhoto:off">🖼 photo → off</option>
                  <option value="autoForwardLocation:on">
                    📍 location → on
                  </option>
                  <option value="autoForwardLocation:off">
                    📍 location → off
                  </option>
                  <option value="autoExtractNotes:on">
                    📒 extract notes → on
                  </option>
                  <option value="autoExtractNotes:off">
                    📒 extract notes → off
                  </option>
                </select>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    void runBulk("rule_recipient", { ruleId: Number(v) });
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                  title="چت‌های انتخاب‌شده رو به‌عنوان گیرنده‌ی این rule اضافه کن"
                >
                  <option value="">📐 Add to rule…</option>
                  {bulkRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      → {r.name}
                    </option>
                  ))}
                </select>
                <select
                  disabled={bulking}
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    void runBulk("profile", { profileId: Number(v) });
                    e.currentTarget.value = "";
                  }}
                  className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 disabled:opacity-50"
                  title="پروفایل رو روی چت‌های انتخاب‌شده اعمال کن"
                >
                  <option value="">👤 assign profile…</option>
                  {bulkProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji ?? ""} {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {filteredChats.length > 0 && (
              <button
                onClick={selectAll}
                className="self-start text-[10px] text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
              >
                انتخاب همه‌ی{" "}
                {totalMatching != null ? totalMatching : filteredChats.length}{" "}
                مورد فیلترشده
              </button>
            )}
          </div>
        </Card>
        {filteredChats.length === 0 && (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">
              هیچ چتی با این فیلتر مطابقت نداره.
            </p>
          </Card>
        )}
        {/* Mobile: card list */}
        <div className="md:hidden flex flex-col gap-2 mb-4">
          {filteredChats.map((c) => (
            <Card
              key={c.chatId}
              className={`!p-3 ${
                selected.has(c.chatId)
                  ? "ring-1 ring-[var(--color-accent)]"
                  : ""
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <input
                  type="checkbox"
                  checked={selected.has(c.chatId)}
                  onChange={() => toggleSelect(c.chatId)}
                  className="mt-1 shrink-0"
                />
                <Link
                  href={`/chats/${c.chatId}`}
                  className="flex-1 min-w-0 hover:opacity-90"
                >
                  <div className="font-medium text-sm truncate" dir="auto">
                    {chatDisplayName(c)}
                    {c.nickname && (
                      <span className="ml-1 text-[11px] font-normal text-[var(--color-text-dim)]">
                        ({c.nickname})
                      </span>
                    )}
                  </div>
                  {[c.firstName, c.lastName].filter(Boolean).length > 0 &&
                    c.chatTitle &&
                    c.chatTitle !== chatDisplayName(c) && (
                      <div className="text-[10px] text-[var(--color-text-dim)] truncate">
                        tg: {c.chatTitle}
                      </div>
                    )}
                  <div className="text-[11px] text-[var(--color-text-dim)] mt-0.5">
                    {chatTypeLabel(c.chatType)} · id {c.chatId} · {relTime(c.lastSeen)}
                  </div>
                </Link>
                <Link
                  href={`/chats/${c.chatId}`}
                  className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] shrink-0"
                >
                  Open →
                </Link>
              </div>
              <select
                value={c.mode}
                onChange={(e) => quickMode(c, e.target.value as ChatMode)}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-xs mb-2"
              >
                {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
              {c.mode === "secretary" && secretaries.length > 0 && (
                <div className="flex items-center gap-1.5 mb-2 text-[11px]">
                  <span className="text-[var(--color-text-dim)] shrink-0">
                    →
                  </span>
                  <select
                    value={String(c.secretaryUserId ?? "")}
                    onChange={(e) =>
                      quickSecretary(
                        c,
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                    className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11px]"
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
                </div>
              )}
              {c.modeChangedAt && (
                <div className="text-[10px] text-[var(--color-text-dim)] mb-2">
                  switched {relTime(c.modeChangedAt)}
                </div>
              )}
              <div className="flex flex-wrap gap-1 items-center text-[10px]">
                <span className="text-[var(--color-text-dim)]">
                  {c.messages} msg
                </span>
                {c.urgent > 0 && <Badge tone="danger">{c.urgent} urg</Badge>}
                {c.isBot && <Badge tone="info">🤖</Badge>}
                {c.functionRole && (
                  <Badge tone="info">
                    {FUNCTION_ROLE_BADGE[c.functionRole] ?? "🧩"}
                  </Badge>
                )}
                {c.vip && <Badge tone="warn">VIP</Badge>}
                {c.muted && <Badge tone="neutral">muted</Badge>}
                {c.relationship && (
                  <Badge tone={RELATIONSHIP_TONES[c.relationship]}>
                    {RELATIONSHIP_LABELS[c.relationship]}
                  </Badge>
                )}
                {c.customReply && <Badge tone="info">custom</Badge>}
                {c.aiCostUsd > 0 && (
                  <span className="text-[var(--color-text-dim)] ml-auto">
                    ${c.aiCostUsd.toFixed(4)}
                  </span>
                )}
              </div>
            </Card>
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="text-center text-[11px] text-[var(--color-text-dim)] py-4"
            >
              {loadingMore ? "بارگذاری بیشتر…" : "اسکرول کن"}
            </div>
          )}
          {!hasMore && chats.length > 0 && (
            <div className="text-center text-[10px] text-[var(--color-text-dim)] py-3">
              · {chats.length} چت بارگذاری شد ·
            </div>
          )}
        </div>

        {/* Desktop: table */}
        <Card className="hidden md:block">
          <TableWrap>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-[var(--color-text-dim)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left font-normal pb-2 pr-2 w-8">
                  <input
                    type="checkbox"
                    checked={
                      filteredChats.length > 0 &&
                      filteredChats.every((c) => selected.has(c.chatId))
                    }
                    onChange={(e) => {
                      if (e.target.checked) selectAll();
                      else selectNone();
                    }}
                  />
                </th>
                <th className="text-left font-normal pb-2 pr-3">Chat</th>
                <th className="text-left font-normal pb-2 pr-3">Mode</th>
                <th className="text-left font-normal pb-2 pr-3">Last seen</th>
                <th className="text-right font-normal pb-2 pr-3">Messages</th>
                <th className="text-right font-normal pb-2 pr-3">Urgent</th>
                <th className="text-right font-normal pb-2 pr-3">AI $</th>
                <th className="text-left font-normal pb-2 pr-3">Flags</th>
                <th className="text-right font-normal pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredChats.map((c) => (
                <tr
                  key={c.chatId}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    selected.has(c.chatId) ? "bg-[var(--color-surface-2)]/30" : ""
                  }`}
                >
                  <td className="py-3 pr-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(c.chatId)}
                      onChange={() => toggleSelect(c.chatId)}
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <Link
                      href={`/chats/${c.chatId}`}
                      className="block hover:opacity-90"
                    >
                      <div
                        className="font-medium underline-offset-2 hover:underline"
                        dir="auto"
                      >
                        {chatDisplayName(c)}
                        {c.nickname && (
                          <span className="ml-1 text-[11px] font-normal text-[var(--color-text-dim)]">
                            ({c.nickname})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-dim)] flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                        <span>
                          {chatTypeLabel(c.chatType)} · id {c.chatId}
                          {[c.firstName, c.lastName].filter(Boolean).length >
                            0 &&
                            c.chatTitle &&
                            c.chatTitle !== chatDisplayName(c) && (
                              <> · tg: {c.chatTitle}</>
                            )}
                        </span>
                        {c.relationship && (
                          <Badge tone={RELATIONSHIP_TONES[c.relationship]}>
                            {RELATIONSHIP_LABELS[c.relationship]}
                          </Badge>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="py-3 pr-3">
                    <select
                      value={c.mode}
                      onChange={(e) =>
                        quickMode(c, e.target.value as ChatMode)
                      }
                      className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 text-xs"
                    >
                      {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                    {c.mode === "secretary" && secretaries.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[11px]">
                        <span className="text-[var(--color-text-dim)]">→</span>
                        <select
                          value={String(c.secretaryUserId ?? "")}
                          onChange={(e) =>
                            quickSecretary(
                              c,
                              e.target.value ? Number(e.target.value) : null,
                            )
                          }
                          className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-0.5 text-[11px] max-w-[140px]"
                          title={
                            c.secretaryUserId
                              ? `override: ${secretaryName(c.secretaryUserId)}`
                              : `default: ${secretaryName(null)}`
                          }
                        >
                          <option value="">
                            {secretaries[0]?.name ?? "—"} (default)
                          </option>
                          {secretaries.map((s) => (
                            <option key={s.userId} value={s.userId}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {c.modeChangedAt && (
                      <div className="text-[10px] text-[var(--color-text-dim)] mt-1">
                        switched {relTime(c.modeChangedAt)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[var(--color-text-dim)]">
                    {relTime(c.lastSeen)}
                  </td>
                  <td className="py-3 pr-3 text-right">{c.messages}</td>
                  <td className="py-3 pr-3 text-right">
                    {c.urgent > 0 ? (
                      <Badge tone="danger">{c.urgent}</Badge>
                    ) : (
                      <span className="text-[var(--color-text-dim)]">0</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right text-xs">
                    {c.aiCostUsd > 0 ? (
                      <span title={`${c.aiTokens} tokens`}>
                        ${c.aiCostUsd.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-dim)]">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex gap-1 flex-wrap">
                      {c.isBot && <Badge tone="info">🤖 bot</Badge>}
                      {c.functionRole && (
                        <Badge tone="info">
                          {FUNCTION_ROLE_BADGE[c.functionRole] ?? "🧩"} {c.functionRole}
                        </Badge>
                      )}
                      {c.vip && <Badge tone="warn">VIP</Badge>}
                      {c.muted && <Badge tone="neutral">muted</Badge>}
                      {c.customReply && <Badge tone="info">custom reply</Badge>}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => setEdit(c)}
                      className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        </Card>
        </>
      )}

      {edit && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setEdit(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 w-full max-w-md"
          >
            <h2 className="text-lg font-semibold mb-1">
              {chatDisplayName(edit)}
            </h2>
            <p className="text-xs text-[var(--color-text-dim)] mb-4">
              {chatTypeLabel(edit.chatType)} · id {edit.chatId}
              {edit.chatTitle && edit.chatTitle !== chatDisplayName(edit) && (
                <> · tg: {edit.chatTitle}</>
              )}
            </p>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs text-[var(--color-text-dim)] mb-1">
                  First name
                </label>
                <input
                  dir="auto"
                  type="text"
                  value={edit.firstName ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, firstName: e.target.value })
                  }
                  placeholder="—"
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-dim)] mb-1">
                  Last name
                </label>
                <input
                  dir="auto"
                  type="text"
                  value={edit.lastName ?? ""}
                  onChange={(e) =>
                    setEdit({ ...edit, lastName: e.target.value })
                  }
                  placeholder="—"
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Nickname (اسم خودمونی)
            </label>
            <input
              dir="auto"
              type="text"
              value={edit.nickname ?? ""}
              onChange={(e) => setEdit({ ...edit, nickname: e.target.value })}
              placeholder="مثلاً موتی / دادا"
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-2"
            />

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Relationship
            </label>
            <select
              value={edit.relationship ?? ""}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  relationship: (e.target.value || null) as
                    | Relationship
                    | null,
                })
              }
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-4"
            >
              <option value="">— ست نشده —</option>
              {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </select>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Mode for this chat
            </label>
            <select
              value={edit.mode}
              onChange={(e) =>
                setEdit({ ...edit, mode: e.target.value as ChatMode })
              }
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-4"
            >
              {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>

            {edit.mode === "secretary" && secretaries.length > 0 && (
              <>
                <label className="block text-xs text-[var(--color-text-dim)] mb-1">
                  Forward to which secretary
                </label>
                <select
                  value={String(edit.secretaryUserId ?? "")}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      secretaryUserId: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm mb-4"
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
              </>
            )}

            <label className="flex items-center gap-2 mb-2 text-sm">
              <input
                type="checkbox"
                checked={edit.vip}
                onChange={(e) =>
                  setEdit({ ...edit, vip: e.target.checked, muted: e.target.checked ? false : edit.muted })
                }
              />
              VIP — always alert regardless of classification
            </label>
            <label className="flex items-center gap-2 mb-4 text-sm">
              <input
                type="checkbox"
                checked={edit.muted}
                onChange={(e) =>
                  setEdit({ ...edit, muted: e.target.checked, vip: e.target.checked ? false : edit.vip })
                }
              />
              Muted — ignore this chat entirely
            </label>

            <label className="block text-xs text-[var(--color-text-dim)] mb-1">
              Custom auto-reply (optional, overrides default)
            </label>
            <textarea
              dir="auto"
              value={edit.customReply ?? ""}
              onChange={(e) => setEdit({ ...edit, customReply: e.target.value })}
              rows={3}
              placeholder={truncate("Leave empty to use the default auto-reply.", 50)}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
            />

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setEdit(null)}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
              >
                Cancel
              </button>
              <button
                onClick={() => save(edit)}
                className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
