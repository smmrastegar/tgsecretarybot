"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
import { chatTypeLabel, relTime, truncate } from "@/lib/format";

type ChatMode =
  | "off"
  | "secretary"
  | "auto_reply"
  | "friendly_reply"
  | "ai_chat"
  | "ai_listen";

const MODE_LABELS: Record<ChatMode, string> = {
  off: "خاموش",
  secretary: "منشی",
  auto_reply: "پاسخ خودکار",
  friendly_reply: "پاسخ خودکار صمیمی (AI)",
  ai_chat: "چت AI (کامل)",
  ai_listen: "شنود AI (بی‌صدا، خلاصه می‌کنه)",
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

type Tone = "neutral" | "success" | "warn" | "danger" | "info";

const RELATIONSHIP_TONES: Record<Relationship, Tone> = {
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

type TypeFilter = "all" | "private" | "bot" | "group" | "channel";

const TYPE_FILTERS: ReadonlyArray<readonly [TypeFilter, string]> = [
  ["all", "همه"],
  ["private", "👤 شخصی"],
  ["bot", "🤖 بات"],
  ["group", "👥 گروه"],
  ["channel", "📰 کانال"],
];

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

type BulkOp =
  | "mode"
  | "vip"
  | "muted"
  | "function"
  | "auto_summarize"
  | "automation"
  | "rule_recipient"
  | "profile";

type BulkExtra = {
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
};

const fa = (v: number | string) =>
  String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

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

// The "tg: …" line is only worth showing when the Telegram title differs from the name we display.
function tgTitleHint(c: Chat): string | null {
  const hasName = [c.firstName, c.lastName].filter(Boolean).length > 0;
  return hasName && c.chatTitle && c.chatTitle !== chatDisplayName(c)
    ? c.chatTitle
    : null;
}

function typeIcon(c: Chat): string {
  if (c.isBot) return "🤖";
  if (c.chatType === "channel") return "📰";
  if (c.chatType === "group" || c.chatType === "supergroup") return "👥";
  return "👤";
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
  success: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-200",
  danger: "bg-rose-500/15 text-rose-300",
  info: "bg-sky-500/15 text-sky-300",
};

// Status chip (12 px: the shared Badge is 11 px).
function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

const FIELD =
  "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 disabled:opacity-50";
const SELECT = `${FIELD} text-center [text-align-last:center]`;
const BTN =
  "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const BTN_PRIMARY =
  "min-h-11 px-4 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs text-[var(--color-text-dim)] mb-1">{label}</span>
      {children}
    </label>
  );
}

// One horizontally-scrollable chip. `shrink-0` keeps the label whole; the row scrolls instead of wrapping.
function FilterChip({
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

export default function ChatsPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [edit, setEdit] = useState<Chat | null>(null);
  const [secretaries, setSecretaries] = useState<Secretary[]>([]);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | ChatMode>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
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
  const [advanced, setAdvanced] = useState<Partial<Record<AdvKey, boolean>>>({});
  const [facets, setFacets] = useState<Facets | null>(null);
  const [totalMatching, setTotalMatching] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
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
  const [moreError, setMoreError] = useState(false);

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
    setLoadError(false);
    const p = buildFilterQuery();
    p.set("limit", String(PAGE));
    p.set("offset", "0");
    try {
      const r = await fetch(`/api/chats?${p}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { chats: Chat[] };
      setChats(j.chats);
      setHasMore(j.chats.length === PAGE);
      setMoreError(false);
      setSelected(new Set());
    } catch {
      setLoadError(true);
      setLoading(false);
      return;
    }
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
    if (loadingMore || !hasMore || moreError) return;
    setLoadingMore(true);
    const p = buildFilterQuery();
    p.set("limit", String(PAGE));
    p.set("offset", String(chats.length));
    try {
      const r = await fetch(`/api/chats?${p}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { chats: Chat[] };
      setChats((prev) => [...prev, ...j.chats]);
      setHasMore(j.chats.length === PAGE);
    } catch {
      setMoreError(true);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, moreError, chats.length, buildFilterQuery]);

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

  function exitSelect() {
    setSelectMode(false);
    setBulkOpen(false);
    setSelected(new Set());
  }

  async function runBulk(op: BulkOp, extra: BulkExtra = {}) {
    if (selected.size === 0) return;
    // A single change can touch hundreds of chats at once, so ask first.
    if (
      selected.size > 1 &&
      !(await confirmDialog(
        `این تغییر روی ${fa(selected.size)} چت اعمال می‌شود. ادامه بدیم؟`,
        { title: "عملیات گروهی", confirmLabel: "اعمال" },
      ))
    )
      return;
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
        await confirmDialog(`عملیات شکست خورد: ${j.error ?? r.status}`, {
          title: "خطا",
          confirmLabel: "باشه",
          danger: true,
        });
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

  // Escape closes the edit sheet.
  useEffect(() => {
    if (!edit) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEdit(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [edit]);

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

  const advancedActive = Object.values(advanced).filter(
    (v) => v !== undefined,
  ).length;
  // Filters that live inside the collapsible section (type / flag chips are always visible).
  const sectionFilters =
    (modeFilter !== "all" ? 1 : 0) +
    (relationshipFilter !== "all" ? 1 : 0) +
    (profileFilter !== "all" ? 1 : 0) +
    (roleFilter !== "all" ? 1 : 0) +
    advancedActive;
  const anyFilter =
    sectionFilters > 0 ||
    typeFilter !== "all" ||
    flagFilter !== "all" ||
    search.trim() !== "";

  function resetFilters() {
    setRelationshipFilter("all");
    setRoleFilter("all");
    setFlagFilter("all");
    setModeFilter("all");
    setTypeFilter("all");
    setProfileFilter("all");
    setAdvanced({});
    setSearch("");
  }

  const advRows = [
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
  ] as Array<[AdvKey, string, number]>;

  return (
    <Shell>
      <PageTitle
        title="چت‌ها"
        subtitle="رفتار هر چت رو تنظیم کن. VIP = همیشه هشدار. Muted = کاملاً نادیده بگیر."
      />

      {facets && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {(
            [
              ["کل چت‌ها", facets.total],
              ["⭐ VIP", facets.flags.vip ?? 0],
              ["🔇 بی‌صدا", facets.flags.muted ?? 0],
            ] as const
          ).map(([label, n]) => (
            <div
              key={label}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2.5 text-center"
            >
              <div className="text-xl font-semibold tabular-nums">{fa(n)}</div>
              <div className="text-xs text-[var(--color-text-dim)] truncate">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <input
          dir="auto"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="جستجو در اسم / nickname / id / title…"
          aria-label="جستجوی چت"
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

      {/* Quick filters: one horizontally scrollable row (type group, then flag group). */}
      <div className="-mx-4 px-4 mb-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-2 w-max">
          <div className="flex gap-2">
            {TYPE_FILTERS.map(([k, label]) => (
              <FilterChip
                key={k}
                active={typeFilter === k}
                onClick={() => setTypeFilter(k)}
              >
                {label}
                {k !== "all" && facets ? ` ${fa(facets.byChatType[k] ?? 0)}` : ""}
              </FilterChip>
            ))}
          </div>
          <span aria-hidden className="w-px self-stretch bg-[var(--color-border)]" />
          <div className="flex gap-2">
            <FilterChip
              active={flagFilter === "vip"}
              onClick={() => setFlagFilter(flagFilter === "vip" ? "all" : "vip")}
            >
              ⭐ VIP
            </FilterChip>
            <FilterChip
              active={flagFilter === "muted"}
              onClick={() =>
                setFlagFilter(flagFilter === "muted" ? "all" : "muted")
              }
            >
              🔇 Muted
            </FilterChip>
          </div>
        </div>
      </div>

      <Section
        icon="🔎"
        title="فیلترهای بیشتر"
        summary="حالت، رابطه، پروفایل، نقش و فیلتر پیشرفته"
        badge={sectionFilters > 0 ? <Pill tone="warn">{fa(sectionFilters)}</Pill> : undefined}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-center">
          <Field label="حالت">
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as "all" | ChatMode)}
              className={SELECT}
            >
              <option value="all">همه ({fa(facets?.total ?? "…")})</option>
              {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]} ({fa(facets?.byMode[m] ?? 0)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="رابطه">
            <select
              value={relationshipFilter}
              onChange={(e) =>
                setRelationshipFilter(
                  e.target.value as "all" | "unset" | Relationship,
                )
              }
              className={SELECT}
            >
              <option value="all">همه ({fa(facets?.total ?? "…")})</option>
              <option value="unset">
                بدون رابطه ({fa(facets?.byRelationship["__unset__"] ?? 0)})
              </option>
              {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map((r) => {
                const n = facets?.byRelationship[r] ?? 0;
                if (n === 0) return null;
                return (
                  <option key={r} value={r}>
                    {RELATIONSHIP_LABELS[r]} ({fa(n)})
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label="پروفایل">
            <select
              value={profileFilter}
              onChange={(e) =>
                setProfileFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
              className={SELECT}
            >
              <option value="all">همه ({fa(facets?.total ?? "…")})</option>
              {(facets?.byProfile ?? []).map((p) => (
                <option key={p.profileId ?? "x"} value={p.profileId ?? ""}>
                  {p.emoji ?? "📋"} {p.name} ({fa(p.count)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="نقش">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={SELECT}
            >
              <option value="all">همه ({fa(facets?.total ?? "…")})</option>
              <option value="unset">
                بدون نقش ({fa(facets?.byFunctionRole["__unset__"] ?? 0)})
              </option>
              {Object.keys(FUNCTION_ROLE_BADGE).map((r) => {
                const n = facets?.byFunctionRole[r] ?? 0;
                if (n === 0) return null;
                return (
                  <option key={r} value={r}>
                    {FUNCTION_ROLE_BADGE[r]} {r} ({fa(n)})
                  </option>
                );
              })}
            </select>
          </Field>
        </div>

        <Section
          className="mt-4 !mb-0"
          icon="⚙️"
          title="فیلتر پیشرفته"
          summary="روشن / خاموش بودن امکانات هر چت"
          badge={advancedActive > 0 ? <Pill tone="warn">{fa(advancedActive)}</Pill> : undefined}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {advRows.map(([k, label, n]) => {
              const v = advanced[k];
              return (
                <Field key={k} label={`${label} (${fa(n)})`}>
                  <select
                    value={v === undefined ? "" : v ? "on" : "off"}
                    onChange={(e) => {
                      const nv = e.target.value;
                      setAdvanced((cur) => ({
                        ...cur,
                        [k]: nv === "" ? undefined : nv === "on",
                      }));
                    }}
                    className={SELECT}
                  >
                    <option value="">— بی‌تأثیر</option>
                    <option value="on">فقط روشن‌ها</option>
                    <option value="off">فقط خاموش‌ها</option>
                  </select>
                </Field>
              );
            })}
          </div>
        </Section>
      </Section>

      <div className="flex items-center justify-center gap-3 flex-wrap text-xs text-[var(--color-text-dim)] mb-3 min-h-8">
        <span className="tabular-nums">
          {fa(filteredChats.length)} نمایش
          {totalMatching != null ? ` / ${fa(totalMatching)} مطابقت` : ""}
          {facets ? ` / ${fa(facets.total)} کل` : ""}
        </span>
        {anyFilter && (
          <button
            type="button"
            onClick={resetFilters}
            title="پاک کردن همه فیلترها"
            className="min-h-10 px-3 rounded-xl border border-[var(--color-border)] text-xs active:bg-[var(--color-surface-2)]"
          >
            ✕ پاک کردن فیلترها
          </button>
        )}
      </div>

      {selectMode && (
        <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
          <div className="text-xs text-[var(--color-text-dim)]">
            چت‌های مورد نظر رو علامت بزن، بعد عملیات گروهی رو بزن.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {filteredChats.length > 0 && (
              <button type="button" onClick={selectAll} className={`${BTN} text-xs`}>
                انتخاب همه‌ی{" "}
                {fa(totalMatching != null ? totalMatching : filteredChats.length)}{" "}
                مورد فیلترشده
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" onClick={selectNone} className={`${BTN} text-xs`}>
                پاک کردن انتخاب
              </button>
            )}
          </div>
        </div>
      )}

      {loading && chats.length === 0 && !loadError ? (
        <Card>در حال بارگذاری…</Card>
      ) : loadError && chats.length === 0 ? (
        <Card>
          <p className="text-sm text-rose-300">بارگذاری چت‌ها انجام نشد.</p>
          <div className="mt-3 flex">
            <button type="button" onClick={() => load()} className={BTN_PRIMARY}>
              تلاش دوباره
            </button>
          </div>
        </Card>
      ) : (
        <>
          {filteredChats.length === 0 &&
            (anyFilter ? (
              <EmptyState
                icon="🔍"
                title="هیچ چتی با این فیلتر مطابقت نداره."
                hint="فیلترها رو کم کن یا چیز دیگه‌ای جستجو کن."
                action={
                  <button type="button" onClick={resetFilters} className={BTN}>
                    پاک کردن فیلترها
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon="💬"
                title="هنوز چتی ثبت نشده."
                hint="با اولین پیام به بات، چت اینجا ظاهر می‌شود."
              />
            ))}

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 mb-4">
            {filteredChats.map((c) => {
              const tg = tgTitleHint(c);
              const isSel = selected.has(c.chatId);
              return (
                <div
                  key={c.chatId}
                  className={`rounded-2xl border bg-[var(--color-surface)] p-3 text-center min-w-0 ${
                    isSel
                      ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  <div className="flex items-center gap-2 min-h-14">
                    {selectMode ? (
                      <label className="grid place-items-center w-11 h-11 shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(c.chatId)}
                          aria-label={`انتخاب ${chatDisplayName(c)}`}
                          className="!w-5 !h-5"
                        />
                      </label>
                    ) : (
                      <span
                        aria-hidden
                        className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--color-surface-2)] text-xl shrink-0"
                      >
                        {typeIcon(c)}
                      </span>
                    )}
                    <Link
                      href={`/chats/${c.chatId}`}
                      className="min-w-0 flex-1 py-1 hover:opacity-90"
                    >
                      <div className="text-sm font-semibold truncate" dir="auto">
                        {chatDisplayName(c)}
                      </div>
                      {c.nickname && (
                        <div className="text-xs text-[var(--color-text-dim)] truncate" dir="auto">
                          ({c.nickname})
                        </div>
                      )}
                      <div className="text-xs text-[var(--color-text-dim)] truncate" dir="rtl">
                        <bdi>
                          {chatTypeLabel(c.chatType)} · id {c.chatId}
                        </bdi>{" "}
                        · {relTime(c.lastSeen)}
                      </div>
                      {tg && (
                        <div className="text-xs text-[var(--color-text-dim)] truncate" dir="rtl">
                          <bdi>tg:</bdi> <bdi>{tg}</bdi>
                        </div>
                      )}
                    </Link>
                  </div>

                  <div className="mt-2 flex flex-wrap justify-center items-center gap-1.5">
                    {c.urgent > 0 && <Chip tone="danger">{fa(c.urgent)} فوری</Chip>}
                    {c.vip && <Chip tone="warn">⭐ VIP</Chip>}
                    {c.muted && <Chip>🔇 بی‌صدا</Chip>}
                    {c.relationship && (
                      <Chip tone={RELATIONSHIP_TONES[c.relationship]}>
                        {RELATIONSHIP_LABELS[c.relationship]}
                      </Chip>
                    )}
                    {c.isBot && <Chip tone="info">🤖 بات</Chip>}
                    {c.functionRole && (
                      <Chip tone="info">
                        {FUNCTION_ROLE_BADGE[c.functionRole] ?? "🧩"} {c.functionRole}
                      </Chip>
                    )}
                    {c.customReply && <Chip tone="info">پاسخ سفارشی</Chip>}
                    <span className="text-xs text-[var(--color-text-dim)] tabular-nums">
                      {fa(c.messages)} پیام
                    </span>
                    {c.aiCostUsd > 0 && (
                      <span
                        className="text-xs text-[var(--color-text-dim)] tabular-nums"
                        title={`${c.aiTokens} tokens`}
                      >
                        ${fa(c.aiCostUsd.toFixed(4))}
                      </span>
                    )}
                  </div>

                  <select
                    value={c.mode}
                    onChange={(e) => quickMode(c, e.target.value as ChatMode)}
                    aria-label="حالت این چت"
                    className={`${SELECT} mt-3`}
                  >
                    {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  {c.mode === "secretary" && secretaries.length > 0 && (
                    <select
                      value={String(c.secretaryUserId ?? "")}
                      onChange={(e) =>
                        quickSecretary(
                          c,
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      aria-label="منشی این چت"
                      title={
                        c.secretaryUserId
                          ? `override: ${secretaryName(c.secretaryUserId)}`
                          : `default: ${secretaryName(null)}`
                      }
                      className={`${SELECT} mt-2`}
                    >
                      <option value="">
                        → پیش‌فرض ({secretaries[0]?.name ?? "—"})
                      </option>
                      {secretaries.map((s) => (
                        <option key={s.userId} value={s.userId}>
                          → {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {c.modeChangedAt && (
                    <div className="mt-1.5 text-xs text-[var(--color-text-dim)]">
                      تغییر یافت {relTime(c.modeChangedAt)}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Link
                      href={`/chats/${c.chatId}`}
                      className={`${BTN_PRIMARY} grid place-items-center`}
                    >
                      باز کن →
                    </Link>
                    <button type="button" onClick={() => setEdit(c)} className={BTN}>
                      ✏️ ویرایش
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {loadError && (
            <div className="mb-4 text-center">
              <p className="text-xs text-rose-300 mb-2">
                بارگذاری مجدد فهرست انجام نشد.
              </p>
              <div className="flex">
                <button type="button" onClick={() => load()} className={BTN}>
                  تلاش دوباره
                </button>
              </div>
            </div>
          )}
          {hasMore && filteredChats.length > 0 && (
            <div
              ref={sentinelRef}
              className="text-center text-xs text-[var(--color-text-dim)] py-4"
            >
              {loadingMore ? (
                "بارگذاری بیشتر…"
              ) : moreError ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-rose-300">بارگذاری بیشتر انجام نشد.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreError(false);
                      void loadMore();
                    }}
                    className={BTN}
                  >
                    تلاش دوباره
                  </button>
                </div>
              ) : (
                "اسکرول کن"
              )}
            </div>
          )}
          {!hasMore && chats.length > 0 && (
            <div className="text-center text-xs text-[var(--color-text-dim)] py-3">
              · {fa(chats.length)} چت بارگذاری شد ·
            </div>
          )}
        </>
      )}

      {/* Bulk bar: sticks to the bottom (above the phone tab bar) while chats are selected. */}
      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-[4.5rem] md:bottom-4 z-20 mt-2 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-3 shadow-2xl text-center">
          {bulkOpen && (
            <div className="mb-3 max-h-[55vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => runBulk("vip", { value: true })}
                  disabled={bulking}
                  className={`${BTN} !border-amber-700 text-amber-300`}
                >
                  ⭐ علامت VIP
                </button>
                <button
                  type="button"
                  onClick={() => runBulk("vip", { value: false })}
                  disabled={bulking}
                  className={BTN}
                >
                  حذف VIP
                </button>
                <button
                  type="button"
                  onClick={() => runBulk("muted", { value: true })}
                  disabled={bulking}
                  className={BTN}
                >
                  🔕 بی‌صدا
                </button>
                <button
                  type="button"
                  onClick={() => runBulk("muted", { value: false })}
                  disabled={bulking}
                  className={BTN}
                >
                  لغو بی‌صدا
                </button>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  disabled={bulking}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value as ChatMode | "";
                    if (v) void runBulk("mode", { mode: v });
                  }}
                  aria-label="تنظیم حالت به"
                  className={SELECT}
                >
                  <option value="">تنظیم حالت به…</option>
                  {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
                <select
                  disabled={bulking}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const role = v === "__clear" ? null : v;
                    void runBulk("function", { role });
                  }}
                  aria-label="تنظیم نقش"
                  className={SELECT}
                >
                  <option value="">تنظیم نقش…</option>
                  <option value="downloader">📥 Downloader</option>
                  <option value="sms_inbox">📱 SMS inbox</option>
                  <option value="download_archive">🗄 Archive</option>
                  <option value="news">📰 News</option>
                  <option value="summary_inbox">📬 Summary inbox</option>
                  <option value="storage">📦 Storage</option>
                  <option value="__clear">— پاک کردن نقش —</option>
                </select>
                <select
                  disabled={bulking}
                  value=""
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
                  }}
                  aria-label="خلاصه‌سازی خودکار"
                  className={SELECT}
                  title="Bulk Auto-summarize — وقتی روشن باشه، threadهای ساکت‌شده توی summary_inbox خلاصه می‌شن"
                >
                  <option value="">📬 خلاصه‌سازی خودکار…</option>
                  <option value="2">روشن، گپ ۲ دقیقه</option>
                  <option value="5">روشن، گپ ۵ دقیقه</option>
                  <option value="10">روشن، گپ ۱۰ دقیقه</option>
                  <option value="15">روشن، گپ ۱۵ دقیقه</option>
                  <option value="30">روشن، گپ ۳۰ دقیقه</option>
                  <option value="60">روشن، گپ ۱ ساعت</option>
                  <option value="off">— خاموش —</option>
                </select>
                <select
                  disabled={bulking}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const [field, value] = v.split(":");
                    if (!field) return;
                    const on = value === "on";
                    void runBulk("automation", {
                      automation: { [field]: on },
                    });
                  }}
                  aria-label="اتومیشن"
                  className={SELECT}
                  title="Bulk اتومیشن — voice/video/photo/location → storage channels، یا استخراج خودکار Notes"
                >
                  <option value="">🤖 اتومیشن…</option>
                  <option value="autoForwardVoice:on">🎤 voice/video-note → on</option>
                  <option value="autoForwardVoice:off">🎤 voice/video-note → off</option>
                  <option value="autoForwardVideo:on">🎬 video → on</option>
                  <option value="autoForwardVideo:off">🎬 video → off</option>
                  <option value="autoForwardPhoto:on">🖼 photo → on</option>
                  <option value="autoForwardPhoto:off">🖼 photo → off</option>
                  <option value="autoForwardLocation:on">📍 location → on</option>
                  <option value="autoForwardLocation:off">📍 location → off</option>
                  <option value="autoExtractNotes:on">📒 extract notes → on</option>
                  <option value="autoExtractNotes:off">📒 extract notes → off</option>
                </select>
                <select
                  disabled={bulking}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void runBulk("rule_recipient", { ruleId: Number(v) });
                  }}
                  aria-label="افزودن به rule"
                  className={SELECT}
                  title="چت‌های انتخاب‌شده رو به‌عنوان گیرنده‌ی این rule اضافه کن"
                >
                  <option value="">📐 افزودن به rule…</option>
                  {bulkRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      → {r.name}
                    </option>
                  ))}
                </select>
                <select
                  disabled={bulking}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void runBulk("profile", { profileId: Number(v) });
                  }}
                  aria-label="تخصیص پروفایل"
                  className={SELECT}
                  title="پروفایل رو روی چت‌های انتخاب‌شده اعمال کن"
                >
                  <option value="">👤 تخصیص پروفایل…</option>
                  {bulkProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji ?? ""} {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="text-sm font-medium mb-2">
            {bulking ? "در حال اعمال…" : `${fa(selected.size)} چت انتخاب شده`}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-expanded={bulkOpen}
              onClick={() => setBulkOpen((v) => !v)}
              className={BTN_PRIMARY}
            >
              {bulkOpen ? "▾ بستن عملیات" : "▴ عملیات گروهی"}
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={bulking}
              className={BTN}
            >
              پاک کردن
            </button>
          </div>
        </div>
      )}

      {edit && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:p-4"
          onClick={() => setEdit(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-3xl md:rounded-3xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5 pb-6"
          >
            <div className="text-center">
              <h2 className="text-lg font-semibold truncate" dir="auto">
                {chatDisplayName(edit)}
              </h2>
              <p className="text-xs text-[var(--color-text-dim)] mt-1 mb-4 break-words">
                {chatTypeLabel(edit.chatType)} · id {edit.chatId}
                {edit.chatTitle && edit.chatTitle !== chatDisplayName(edit) && (
                  <> · tg: {edit.chatTitle}</>
                )}
              </p>
            </div>

            {/* A form: field labels sit at the start of each input (text-start), unlike centred cards. */}
            <div className="text-start flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="نام">
                  <input
                    dir="auto"
                    type="text"
                    value={edit.firstName ?? ""}
                    onChange={(e) =>
                      setEdit({ ...edit, firstName: e.target.value })
                    }
                    placeholder="—"
                    className={FIELD}
                  />
                </Field>
                <Field label="نام خانوادگی">
                  <input
                    dir="auto"
                    type="text"
                    value={edit.lastName ?? ""}
                    onChange={(e) =>
                      setEdit({ ...edit, lastName: e.target.value })
                    }
                    placeholder="—"
                    className={FIELD}
                  />
                </Field>
              </div>

              <Field label="اسم خودمونی">
                <input
                  dir="auto"
                  type="text"
                  value={edit.nickname ?? ""}
                  onChange={(e) => setEdit({ ...edit, nickname: e.target.value })}
                  placeholder="مثلاً موتی / دادا"
                  className={FIELD}
                />
              </Field>

              <Field label="رابطه">
                <select
                  value={edit.relationship ?? ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      relationship: (e.target.value || null) as Relationship | null,
                    })
                  }
                  className={FIELD}
                >
                  <option value="">— ست نشده —</option>
                  {(Object.keys(RELATIONSHIP_LABELS) as Relationship[]).map((r) => (
                    <option key={r} value={r}>
                      {RELATIONSHIP_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="حالت این چت">
                <select
                  value={edit.mode}
                  onChange={(e) =>
                    setEdit({ ...edit, mode: e.target.value as ChatMode })
                  }
                  className={FIELD}
                >
                  {(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>

              {edit.mode === "secretary" && secretaries.length > 0 && (
                <Field label="فوروارد به کدوم منشی">
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
                    className={FIELD}
                  >
                    <option value="">
                      پیش‌فرض ({secretaries[0]?.name ?? "—"})
                    </option>
                    {secretaries.map((s) => (
                      <option key={s.userId} value={s.userId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <label className="flex items-center gap-3 min-h-11 text-sm rounded-xl border border-[var(--color-border)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={edit.vip}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      vip: e.target.checked,
                      muted: e.target.checked ? false : edit.muted,
                    })
                  }
                  className="!w-5 !h-5 shrink-0"
                />
                <span className="min-w-0">VIP — همیشه هشدار، فارغ از دسته‌بندی</span>
              </label>
              <label className="flex items-center gap-3 min-h-11 text-sm rounded-xl border border-[var(--color-border)] px-3 py-2">
                <input
                  type="checkbox"
                  checked={edit.muted}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      muted: e.target.checked,
                      vip: e.target.checked ? false : edit.vip,
                    })
                  }
                  className="!w-5 !h-5 shrink-0"
                />
                <span className="min-w-0">بی‌صدا — این چت رو کاملاً نادیده بگیر</span>
              </label>

              <Section
                className="!mb-0"
                icon="💬"
                title="پاسخ خودکار سفارشی"
                summary={edit.customReply ? truncate(edit.customReply, 40) : "اختیاری، جای پیش‌فرض رو می‌گیره"}
                defaultOpen={!!edit.customReply}
              >
                <textarea
                  dir="auto"
                  value={edit.customReply ?? ""}
                  onChange={(e) => setEdit({ ...edit, customReply: e.target.value })}
                  rows={3}
                  aria-label="پاسخ خودکار سفارشی"
                  placeholder={truncate("خالی بذار تا پاسخ خودکار پیش‌فرض استفاده بشه.", 50)}
                  className={`${FIELD} py-2 text-start`}
                />
              </Section>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => save(edit)} className={BTN_PRIMARY}>
                ذخیره
              </button>
              <button type="button" onClick={() => setEdit(null)} className={BTN}>
                لغو
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
