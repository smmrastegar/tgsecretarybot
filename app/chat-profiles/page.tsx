"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

type Profile = {
  id: number;
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  isDefault: boolean;
  isBuiltin: boolean;
  followUpEnabled: boolean;
  followUpThresholdHours: number;
  followUpEscalateHours: number;
  followUpTranscribeVoices: boolean;
  chatCount: number;
};

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} دقیقه`;
  return `${h} ساعت`;
}

export default function ChatProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmoji, setNewEmoji] = useState("");

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/chat-profiles");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { profiles: Profile[] };
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

  const createProfile = async () => {
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

  const patchProfile = async (id: number, patch: Partial<Profile>) => {
    await fetch(`/api/chat-profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  };

  const deleteProfile = async (id: number) => {
    if (!confirm("این پروفایل پاک بشه؟ همه چت‌های متصل به profile پیش‌فرض برمی‌گردن.")) {
      return;
    }
    await fetch(`/api/chat-profiles/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <Shell>
      <PageTitle
        title="👤 پروفایل‌های چت"
        subtitle="هر پروفایل یه قالب از تنظیمات follow-up هست. چت‌ها رو بهشون assign کن تا تنظیمات از پروفایل ارث ببرن."
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
              if (e.key === "Enter") createProfile();
            }}
          />
          <button
            onClick={createProfile}
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              onPatch={(patch) => patchProfile(p.id, patch)}
              onDelete={() => deleteProfile(p.id)}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

function ProfileCard({
  profile,
  onPatch,
  onDelete,
}: {
  profile: Profile;
  onPatch: (patch: Partial<Profile>) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{profile.emoji || "📋"}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{profile.name}</div>
          <div className="text-[10px] text-[var(--color-text-dim)]">
            {profile.slug}
            {profile.isDefault && " · پیش‌فرض"}
            {profile.isBuiltin && !profile.isDefault && " · builtin"}
            {" · "}
            <Link
              href={`/chats?profile=${profile.id}`}
              className="text-[var(--color-accent)] hover:underline"
            >
              {profile.chatCount} چت
            </Link>
          </div>
        </div>
        {!profile.isBuiltin && !profile.isDefault && (
          <button
            onClick={onDelete}
            className="text-[10px] text-red-300 hover:text-red-200 px-2 py-1"
          >
            🗑
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={profile.followUpEnabled}
          onChange={(e) =>
            onPatch({ followUpEnabled: e.target.checked })
          }
        />
        <span className="text-xs">یادآور جواب‌ندادن فعال باشه</span>
      </label>

      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-dim)]">
            آستانه‌ی اول · {fmtHours(profile.followUpThresholdHours)}
          </span>
          <select
            value={profile.followUpThresholdHours}
            onChange={(e) =>
              onPatch({ followUpThresholdHours: Number(e.target.value) })
            }
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          >
            <option value={0.25}>۱۵ دقیقه</option>
            <option value={0.5}>نیم ساعت</option>
            <option value={1}>۱ ساعت</option>
            <option value={2}>۲ ساعت</option>
            <option value={4}>۴ ساعت</option>
            <option value={12}>۱۲ ساعت</option>
            <option value={24}>۲۴ ساعت</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[var(--color-text-dim)]">
            escalate بعد از · {fmtHours(profile.followUpEscalateHours)}
          </span>
          <select
            value={profile.followUpEscalateHours}
            onChange={(e) =>
              onPatch({ followUpEscalateHours: Number(e.target.value) })
            }
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          >
            <option value={0.5}>نیم ساعت</option>
            <option value={1}>۱ ساعت</option>
            <option value={2}>۲ ساعت</option>
            <option value={4}>۴ ساعت</option>
            <option value={12}>۱۲ ساعت</option>
            <option value={24}>۲۴ ساعت</option>
            <option value={48}>۴۸ ساعت</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={profile.followUpTranscribeVoices}
          onChange={(e) =>
            onPatch({ followUpTranscribeVoices: e.target.checked })
          }
        />
        <span className="text-xs">
          🎤 ویس‌ها رو هم به متن تبدیل کن و در تحلیل AI لحاظ کن
        </span>
      </label>
    </Card>
  );
}
