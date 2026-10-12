"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";

type Profile = {
  id: number;
  name: string;
  emoji: string | null;
  chatCount: number;
};

type Chat = {
  chatId: number;
  name: string | null;
  chatType: string;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
// Action row: buttons sit on the physical left (also when it holds links, which the global rule does not cover).
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";
const FIELD = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";

export default function ProfileChatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const profileId = Number(id);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Chat[]>([]);
  const [memberFilter, setMemberFilter] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<Chat[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const r = await fetch(`/api/chat-profiles/${profileId}/chats`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { profile: Profile; members: Chat[] };
      setProfile(j.profile);
      setMembers(j.members);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    load();
  }, [load]);

  const search = useCallback(async () => {
    setSearching(true);
    try {
      const url = `/api/chat-profiles/${profileId}/chats?search=${encodeURIComponent(candidateQuery)}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = (await r.json()) as { candidates: Chat[] };
        setCandidates(j.candidates);
      }
    } finally {
      setSearching(false);
    }
  }, [profileId, candidateQuery]);

  // Search-on-type with a tiny debounce.
  useEffect(() => {
    const t = setTimeout(() => {
      if (candidateQuery.trim().length > 0) {
        void search();
      } else {
        setCandidates([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [candidateQuery, search]);

  const togglePick = (chatId: number) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const addPicked = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      await fetch(`/api/chat-profiles/${profileId}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatIds: [...picked] }),
      });
      setPicked(new Set());
      setCandidateQuery("");
      setCandidates([]);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (chatId: number) => {
    setBusy(true);
    try {
      await fetch(`/api/chat-profiles/${profileId}/chats`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const filteredMembers = members.filter((m) => {
    if (!memberFilter.trim()) return true;
    const q = memberFilter.toLowerCase();
    return (
      (m.name ?? "").toLowerCase().includes(q) ||
      String(m.chatId).includes(q)
    );
  });

  return (
    <Shell>
      <PageTitle
        title={`👥 چت‌های پروفایل «${profile?.emoji ?? ""} ${profile?.name ?? "..."}»`}
        subtitle={`${fa(members.length)} چت عضو این پروفایله. اضافه/حذف از همین صفحه.`}
        actions={
          <div className={ACTIONS}>
            <Link href={`/chat-profiles/${profileId}`} className={BTN_PLAIN}>
              ← تنظیمات پروفایل
            </Link>
          </div>
        }
      />

      <Card className="mb-3">
        <div className="text-sm font-medium mb-3">+ اضافه کردن چت</div>
        <input
          type="search"
          dir="auto"
          value={candidateQuery}
          onChange={(e) => setCandidateQuery(e.target.value)}
          aria-label="جستجوی چت"
          placeholder="🔍 جستجو با اسم یا chatId"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-[var(--color-text-dim)]">حداقل یه حرف تایپ کن.</p>
        {candidateQuery.trim().length > 0 && (
          <div className="mt-3 max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-xl">
            {searching && (
              <div className="text-sm text-[var(--color-text-dim)] p-3">
                در حال جستجو...
              </div>
            )}
            {!searching && candidates.length === 0 && (
              <div className="text-sm text-[var(--color-text-dim)] p-3">
                نتیجه‌ای پیدا نشد.
              </div>
            )}
            <ul>
              {candidates.map((c) => (
                <li
                  key={c.chatId}
                  className="border-b border-[var(--color-border)]/40 last:border-0"
                >
                  <label className="flex items-center gap-3 cursor-pointer px-3 min-h-14 py-2 hover:bg-[var(--color-surface-2)]/40 active:bg-[var(--color-surface-2)]">
                    <input
                      type="checkbox"
                      checked={picked.has(c.chatId)}
                      onChange={() => togglePick(c.chatId)}
                    />
                    <div className="flex-1 min-w-0 text-center">
                      <div dir="auto" className="text-sm truncate">
                        {c.name || `چت ${c.chatId}`}
                      </div>
                      <div className="text-xs text-[var(--color-text-dim)] truncate">
                        {c.chatType} · {c.chatId}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {picked.size > 0 && (
            <span className="text-xs text-[var(--color-text-dim)]">{fa(picked.size)} انتخاب شده</span>
          )}
          <div className="flex">
            <button onClick={addPicked} disabled={busy || picked.size === 0} className={BTN_PRIMARY}>
              + اضافه کن ({fa(picked.size)})
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-medium mb-3">
          👥 اعضای فعلی ({fa(members.length)})
        </div>
        {members.length > 0 && (
          <input
            type="search"
            dir="auto"
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            aria-label="فیلتر اعضا"
            placeholder="🔍 فیلتر"
            className={`${FIELD} mb-3`}
          />
        )}
        {loadErr ? (
          <div>
            <p className="text-sm text-red-300">خطا در بارگذاری چت‌ها: {loadErr}</p>
            <div className="mt-3 flex">
              <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
            </div>
          </div>
        ) : loading ? (
          <div className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</div>
        ) : filteredMembers.length === 0 ? (
          <EmptyState
            icon="👥"
            title={members.length === 0 ? "هیچ چتی در این پروفایل نیست." : "چتی با این فیلتر پیدا نشد."}
            hint={members.length === 0 ? "از بخش «اضافه کردن چت» بالا چت اضافه کن." : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredMembers.map((c) => (
              <li
                key={c.chatId}
                className="flex items-center gap-2 min-h-14 px-3 py-2 rounded-xl border border-[var(--color-border)]"
              >
                <Link
                  href={`/chats/${c.chatId}`}
                  className="flex-1 min-w-0 self-stretch flex flex-col justify-center text-center hover:text-[var(--color-accent)]"
                >
                  <div dir="auto" className="text-sm font-medium truncate">{c.name || `چت ${c.chatId}`}</div>
                  <div className="text-xs text-[var(--color-text-dim)] truncate">
                    {c.chatType} · {c.chatId}
                  </div>
                </Link>
                <button
                  onClick={() => remove(c.chatId)}
                  disabled={busy}
                  className={`${BTN} !px-3 bg-rose-500/10 border border-rose-500/30 text-rose-200 hover:bg-rose-500/20`}
                  title="منتقل کن به پروفایل پیش‌فرض"
                >
                  حذف
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
