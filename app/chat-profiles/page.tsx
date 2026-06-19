"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type ProfileSummary = {
  id: number;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  isBuiltin: boolean;
  chatCount: number;
};

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

      <Card className="mb-4">
        <div className="text-xs font-medium mb-2">+ ساخت پروفایل جدید</div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={newEmoji}
            onChange={(e) => setNewEmoji(e.target.value)}
            placeholder="😀"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 w-16 text-center"
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم پروفایل (مثلاً «خانواده»)"
            className="flex-1 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <button
            onClick={create}
            disabled={creating || !newName.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            +
          </button>
        </div>
      </Card>

      {err && (
        <Card className="mb-4">
          <div className="text-xs text-red-300">خطا: {err}</div>
        </Card>
      )}

      {loading && profiles.length === 0 ? (
        <Card>
          <div className="text-xs text-[var(--color-text-dim)]">...</div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--color-border)]">
            {profiles.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/chat-profiles/${p.id}`}
                  className="flex items-center gap-3 py-3 px-1 hover:bg-[var(--color-surface-2)]/40 rounded-md"
                >
                  <span className="text-xl">{p.emoji || "📋"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)]">
                      {p.chatCount} چت
                      {p.isDefault && " · پیش‌فرض"}
                      {p.isBuiltin && !p.isDefault && " · builtin"}
                    </div>
                  </div>
                  <span className="text-[var(--color-text-dim)]">←</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
