"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

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
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/chat-profiles/${profileId}/chats`);
      if (r.ok) {
        const j = (await r.json()) as { profile: Profile; members: Chat[] };
        setProfile(j.profile);
        setMembers(j.members);
      }
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
        subtitle={`${members.length} چت عضو این پروفایله. اضافه/حذف از همین صفحه.`}
        actions={
          <Link
            href={`/chat-profiles/${profileId}`}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]"
          >
            ← تنظیمات پروفایل
          </Link>
        }
      />

      <Card className="mb-3">
        <div className="text-xs font-medium mb-2">+ اضافه کردن چت</div>
        <input
          type="text"
          value={candidateQuery}
          onChange={(e) => setCandidateQuery(e.target.value)}
          placeholder="🔍 جستجو بر اساس اسم یا chatId — حداقل یه حرف تایپ کن"
          className="w-full text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 mb-2"
        />
        {candidateQuery.trim().length > 0 && (
          <div className="max-h-64 overflow-auto border border-[var(--color-border)] rounded-md mb-2">
            {searching && (
              <div className="text-[10px] text-[var(--color-text-dim)] p-2">
                در حال جستجو...
              </div>
            )}
            {!searching && candidates.length === 0 && (
              <div className="text-[10px] text-[var(--color-text-dim)] p-2">
                نتیجه‌ای پیدا نشد.
              </div>
            )}
            <ul>
              {candidates.map((c) => (
                <li
                  key={c.chatId}
                  className="border-b border-[var(--color-border)]/40 last:border-0"
                >
                  <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-[var(--color-surface-2)]/40">
                    <input
                      type="checkbox"
                      checked={picked.has(c.chatId)}
                      onChange={() => togglePick(c.chatId)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">
                        {c.name || `chat ${c.chatId}`}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-dim)]">
                        {c.chatType} · {c.chatId}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-dim)] mr-auto">
            {picked.size > 0 && `${picked.size} انتخاب شده`}
          </span>
          <button
            onClick={addPicked}
            disabled={busy || picked.size === 0}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            + اضافه کن ({picked.size})
          </button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs font-medium">
            👥 اعضای فعلی ({members.length})
          </div>
          <input
            type="text"
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            placeholder="🔍 فیلتر"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1 w-40"
          />
        </div>
        {loading ? (
          <div className="text-xs text-[var(--color-text-dim)]">...</div>
        ) : filteredMembers.length === 0 ? (
          <div className="text-xs text-[var(--color-text-dim)] italic">
            هیچ چتی نیست.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {filteredMembers.map((c) => (
              <li
                key={c.chatId}
                className="flex items-center gap-2 py-2 text-xs"
              >
                <Link
                  href={`/chats/${c.chatId}`}
                  className="flex-1 min-w-0 hover:text-[var(--color-accent)]"
                >
                  <div>{c.name || `chat ${c.chatId}`}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)]">
                    {c.chatType} · {c.chatId}
                  </div>
                </Link>
                <button
                  onClick={() => remove(c.chatId)}
                  disabled={busy}
                  className="text-[10px] px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
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
