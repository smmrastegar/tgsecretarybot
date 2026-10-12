"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Card } from "@/components/Card";
import AiSection from "@/components/chat-detail/AiSection";
import { MediaAutomationSection, RolesSection } from "@/components/chat-detail/AutomationSections";
import BehaviourSection from "@/components/chat-detail/BehaviourSection";
import DangerSection from "@/components/chat-detail/DangerSection";
import FollowUpSection from "@/components/chat-detail/FollowUpSection";
import GraceBanner from "@/components/chat-detail/GraceBanner";
import HeroCard from "@/components/chat-detail/HeroCard";
import IdentitySection from "@/components/chat-detail/IdentitySection";
import MessagesSection from "@/components/chat-detail/MessagesSection";
import SuggestionDialog from "@/components/chat-detail/SuggestionDialog";
import ThreadsSection from "@/components/chat-detail/ThreadsSection";
import { btnCls } from "@/components/chat-detail/shared";
import type { GraceInfo, Message, Personal, ProfileSummary, Rule, Stats, Suggestion } from "@/components/chat-detail/types";

// Per-chat page: who the chat is, how the bot treats it, automation, AI replies, threads and the conversation.
// Each purpose is one collapsible section (components/chat-detail/*); this file owns the data and the writes.
const blankPersonal: Personal = {
  firstName: "",
  lastName: "",
  nickname: "",
  relationship: "",
  relationshipNotes: "",
  talkStyleNotes: "",
  notes: "",
};

const PAGE = 10;

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const chatId = Number(params.id);
  const [rule, setRule] = useState<Rule | null>(null);
  const [functionRoles, setFunctionRoles] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [grace, setGrace] = useState<GraceInfo | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [secretaries, setSecretaries] = useState<{ userId: number; name: string }[]>([]);
  // `ready` is true after the first successful load; later reloads (after every save) keep the page mounted so
  // the sections keep their open/closed state.
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
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

  const [personal, setPersonal] = useState<Personal>(blankPersonal);
  const [personalDirty, setPersonalDirty] = useState(false);
  const [personalSaved, setPersonalSaved] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(chatId)) return;
    try {
      const r = await fetch(`/api/chats/${chatId}?limit=${PAGE}&offset=0`);
      if (!r.ok) {
        setLoadError(true);
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
      setLoadError(false);
      setReady(true);
    } catch {
      setLoadError(true);
    }
  }, [chatId]);

  const retryLoad = () => {
    setLoadError(false);
    setReady(false);
    void load();
  };

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

  async function runSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/suggest`, { method: "POST" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setSuggestError(`خطا: ${j.error ?? r.status}`);
        return;
      }
      const j = (await r.json()) as { suggestion: Suggestion };
      setSuggestion(j.suggestion);
    } finally {
      setSuggesting(false);
    }
  }

  const [fineTuning, setFineTuning] = useState(false);
  const [fineTuneMsg, setFineTuneMsg] = useState<string | null>(null);

  async function runFineTune() {
    setFineTuning(true);
    setFineTuneMsg(null);
    try {
      const r = await fetch(`/api/chats/${chatId}/fine-tune`, { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; toneProfile?: string; sampleCount?: number; error?: string };
      if (!r.ok) {
        setFineTuneMsg(j.error ?? `error ${r.status}`);
      } else {
        setFineTuneMsg(`پروفایل لحن از ${j.sampleCount ?? "?"} پیام خودت به‌روزرسانی شد (updated).`);
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
      const r = await fetch(`/api/chats/${chatId}?limit=${PAGE}&offset=${messages.length}`);
      if (!r.ok) return;
      const j = (await r.json()) as { messages: Message[]; hasMore: boolean };
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

  async function patchAutomation(patch: Record<string, boolean>) {
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

  async function patchFollowUp(patch: { enabled?: boolean; thresholdHours?: number; escalateHours?: number }) {
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

  async function putRoles(next: string[]) {
    setSaving(true);
    try {
      await fetch(`/api/chats/${chatId}/function`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: next, config: rule?.functionConfig ?? null }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  const putAutoSummarize = (body: { enabled: boolean; gapMinutes: number; smartTiming: boolean }) =>
    fetch(`/api/chats/${chatId}/auto-summarize`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(() => load());

  const putIsBot = (isBot: boolean) =>
    fetch(`/api/chats/${chatId}/is-bot`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBot }),
    }).then(() => load());

  const putIgnored = async (ignored: boolean) => {
    await fetch(`/api/chats/${chatId}/ignored`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignored }),
    });
    load();
  };

  const headPerson = messages.find((m) => m.senderId !== null && m.senderName);
  const customFull = [rule?.firstName, rule?.lastName].filter(Boolean).join(" ").trim();
  const personName = (customFull.length > 0 ? customFull : null) ?? rule?.chatTitle ?? headPerson?.senderName ?? (chatId ? `chat ${chatId}` : "—");
  const personHandle = headPerson?.senderUsername;
  const updatePersonal = (patch: Partial<Personal>) => {
    setPersonal((p) => ({ ...p, ...patch }));
    setPersonalDirty(true);
  };

  return (
    <Shell>
      <div className="mb-2">
        <button
          type="button"
          onClick={() => {
            // Prefer browser-history back so the operator returns to wherever they came from (/follow-up /
            // /messages / /functions / etc.) instead of always landing on /chats. Fall back to /chats when
            // there's no history (direct entry point, e.g. a shared link).
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/chats");
            }
          }}
          className="min-h-11 px-3 -mx-3 text-sm text-[var(--color-text-dim)] active:text-white"
        >
          ← برگشت
        </button>
      </div>

      {loadError ? (
        <Card>
          <p className="text-sm leading-7">بارگذاری این چت انجام نشد.</p>
          <div className="mt-3 flex [justify-content:left]">
            <button type="button" onClick={retryLoad} className={btnCls}>تلاش دوباره</button>
          </div>
        </Card>
      ) : !ready ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]" role="status">در حال بارگذاری…</p>
        </Card>
      ) : (
        <>
          <HeroCard chatId={chatId} rule={rule} stats={stats} personName={personName} personHandle={personHandle} />
          <GraceBanner rule={rule} grace={grace} nowTick={nowTick} saving={saving} onSkip={skipGrace} />

          <BehaviourSection rule={rule} secretaries={secretaries} profiles={profiles} saving={saving} patchRule={patchRule} patchProfile={patchProfile} />
          <IdentitySection chatId={chatId} rule={rule} personal={personal} updatePersonal={updatePersonal} dirty={personalDirty} saved={personalSaved}
            saving={saving} onSave={savePersonal} suggesting={suggesting} suggestError={suggestError} onSuggest={runSuggest} onToggleBot={putIsBot} onReload={load} />
          <AiSection rule={rule} showTone={chatId > 0 && rule?.chatType === "private" && !rule?.isBot} saving={saving} patchRule={patchRule}
            putAutoSummarize={putAutoSummarize} fineTuning={fineTuning} fineTuneMsg={fineTuneMsg} onFineTune={runFineTune} />
          <RolesSection chatId={chatId} functionRoles={functionRoles} saving={saving} onRoles={putRoles} />
          {rule && <MediaAutomationSection chatId={chatId} rule={rule} saving={saving} patchAutomation={patchAutomation} />}
          <FollowUpSection rule={rule} saving={saving} patchFollowUp={patchFollowUp} />
          <MessagesSection messages={messages} total={stats?.priorCount ?? null} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore}
            onPrivacyChange={(next) => setMessages((prev) => prev.map((mm) => (mm.id === next.id ? next : mm)))} />
          <ThreadsSection chatId={chatId} />
          <DangerSection chatId={chatId} rule={rule} saving={saving} onIgnore={putIgnored} />
        </>
      )}
      {suggestion && (
        <SuggestionDialog
          suggestion={suggestion}
          onClose={() => setSuggestion(null)}
          onApply={async () => {
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
        />
      )}
    </Shell>
  );
}
