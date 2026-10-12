"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";

type ProfileSummary = {
  id: number;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  isBuiltin: boolean;
  chatCount: number;
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN_PRIMARY = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 bg-[var(--color-accent)] text-white disabled:opacity-50";
const FIELD = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";

export default function ChatProfilesIndexPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/chat-profiles");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { profiles: ProfileSummary[] };
      setProfiles(j.profiles);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await fetch("/api/chat-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: name.toLowerCase().replace(/\s+/g, "-").slice(0, 40),
          name,
          emoji: newEmoji.trim() || null,
        }),
      });
      if (r.ok) {
        setNewName("");
        setNewEmoji("");
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Shell>
      <PageTitle
        title="👤 پروفایل‌های چت"
        subtitle="هر پروفایل یه قالب کامل از تنظیمات چت هست. یکی رو کلیک کن تا واردش بشی و تنظیماتش رو ویرایش کنی."
      />

      <Section icon="➕" title="ساخت پروفایل جدید" summary="اسم و ایموجی، بعد وارد تنظیماتش شو">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            placeholder="😀 ایموجی (اختیاری)"
            aria-label="ایموجی"
            className={`${FIELD} text-center`}
          />
          <input
            type="text"
            dir="auto"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم پروفایل (مثلاً «خانواده»)"
            aria-label="اسم پروفایل"
            className={FIELD}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button onClick={create} disabled={creating || !newName.trim()} className={`${BTN_PRIMARY} w-full`}>
            {creating ? "…" : "+ ساخت پروفایل"}
          </button>
        </div>
      </Section>

      {err ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری پروفایل‌ها: {err}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && profiles.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری پروفایل‌ها…</p>
        </Card>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon="👤"
          title="هنوز پروفایلی نداری."
          hint="از «ساخت پروفایل جدید» بالا اولین پروفایل را بساز."
        />
      ) : (
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          {profiles.map((p) => (
            <Link
              key={p.id}
              href={`/chat-profiles/${p.id}`}
              className="flex items-center gap-3 px-4 min-h-16 py-2.5 border-t first:border-t-0 border-[var(--color-border)] active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]"
            >
              <span aria-hidden className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--color-surface-2)] text-xl shrink-0">{p.emoji || "📋"}</span>
              <span className="min-w-0 flex-1 text-center">
                <span dir="auto" className="block text-sm font-semibold truncate">{p.name}</span>
                <span className="block text-xs text-[var(--color-text-dim)] truncate">
                  {fa(p.chatCount)} چت
                  {p.isBuiltin && !p.isDefault && " · builtin"}
                </span>
              </span>
              {p.isDefault && <Pill tone="ok">پیش‌فرض</Pill>}
              <span aria-hidden className="shrink-0 text-[var(--color-text-dim)]">‹</span>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}
