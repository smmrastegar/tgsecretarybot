"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
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
  mode: string | null;
  vip: boolean | null;
  muted: boolean | null;
  autoSummarizeEnabled: boolean | null;
  autoSummarizeGapMinutes: number | null;
  autoSummarizeSmartTiming: boolean | null;
  autoForwardVoice: boolean | null;
  autoForwardVideo: boolean | null;
  autoForwardPhoto: boolean | null;
  autoForwardLocation: boolean | null;
  autoExtractNotes: boolean | null;
  aiProcessVoice: boolean | null;
  aiProcessStickers: boolean | null;
  aiProcessGifs: boolean | null;
  aiProcessPhotos: boolean | null;
  aiProcessVideoNotes: boolean | null;
  chatCount: number;
};

const MODES = [
  { v: "off", label: "Off" },
  { v: "secretary", label: "Secretary" },
  { v: "auto_reply", label: "Auto-reply" },
  { v: "friendly_reply", label: "Friendly auto-reply (AI)" },
  { v: "ai_chat", label: "AI chat (full)" },
  { v: "ai_listen", label: "AI listen (silent)" },
];

export default function ChatProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const profileId = Number(id);

  const [original, setOriginal] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chats, setChats] = useState<Array<{ chatId: number; name: string | null }>>([]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/chat-profiles/${profileId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        profile: Profile;
        chats: Array<{ chatId: number; name: string | null }>;
      };
      setOriginal(j.profile);
      setDraft(j.profile);
      setChats(j.chats);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const save = async () => {
    if (!draft || !original) return;
    setSaving(true);
    try {
      // Send only the changed keys — the API knows undefined = keep.
      const patch: Record<string, unknown> = {};
      for (const k of Object.keys(draft) as (keyof Profile)[]) {
        if (k === "id" || k === "slug" || k === "isDefault" || k === "isBuiltin" || k === "chatCount") continue;
        if (JSON.stringify(draft[k]) !== JSON.stringify(original[k])) {
          patch[k] = draft[k];
        }
      }
      const r = await fetch(`/api/chat-profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        const j = (await r.json()) as { profile: Profile };
        setOriginal(j.profile);
        setDraft(j.profile);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !draft || !original) {
    return (
      <Shell>
        <PageTitle title="..." />
        {err && (
          <Card>
            <div className="text-xs text-red-300">خطا: {err}</div>
          </Card>
        )}
      </Shell>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  return (
    <Shell>
      <PageTitle
        title={`${draft.emoji || "📋"} ${draft.name}`}
        subtitle={`${draft.chatCount} چت · ${draft.isBuiltin ? "builtin" : "custom"}${draft.isDefault ? " · پیش‌فرض" : ""}`}
        actions={
          <Link
            href="/chat-profiles"
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]"
          >
            ← همه پروفایل‌ها
          </Link>
        }
      />

      <div className="space-y-3 pb-32">
        <Card>
          <div className="text-xs font-medium mb-2">📛 اطلاعات پایه</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">emoji</span>
              <input
                type="text"
                value={draft.emoji ?? ""}
                onChange={(e) => update("emoji", e.target.value || null)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-[10px] text-[var(--color-text-dim)]">اسم</span>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-3">
              <span className="text-[10px] text-[var(--color-text-dim)]">توضیح (اختیاری)</span>
              <input
                type="text"
                value={draft.description ?? ""}
                onChange={(e) => update("description", e.target.value || null)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
            </label>
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium mb-2">⚙️ Mode + پرچم‌ها</div>
          <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
            null = این پروفایل این تنظیم رو override نمی‌کنه (per-chat می‌مونه).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">Mode</span>
              <select
                value={draft.mode ?? ""}
                onChange={(e) => update("mode", e.target.value === "" ? null : e.target.value)}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              >
                <option value="">— per-chat —</option>
                {MODES.map((m) => (
                  <option key={m.v} value={m.v}>{m.label}</option>
                ))}
              </select>
            </label>
            <TriToggle
              label="VIP"
              value={draft.vip}
              onChange={(v) => update("vip", v)}
            />
            <TriToggle
              label="Muted"
              value={draft.muted}
              onChange={(v) => update("muted", v)}
            />
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium mb-2">⏰ یادآور جواب‌ندادن</div>
          <label className="flex items-center gap-2 cursor-pointer text-xs mb-2">
            <input
              type="checkbox"
              checked={draft.followUpEnabled}
              onChange={(e) => update("followUpEnabled", e.target.checked)}
            />
            <span>یادآور فعال باشه</span>
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">آستانه اول</span>
              <select
                value={draft.followUpThresholdHours}
                onChange={(e) => update("followUpThresholdHours", Number(e.target.value))}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              >
                {[0.25, 0.5, 1, 2, 4, 12, 24].map((h) => (
                  <option key={h} value={h}>{h < 1 ? `${h * 60} دقیقه` : `${h} ساعت`}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">escalate بعد از</span>
              <select
                value={draft.followUpEscalateHours}
                onChange={(e) => update("followUpEscalateHours", Number(e.target.value))}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              >
                {[0.5, 1, 2, 4, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>{h < 1 ? `${h * 60} دقیقه` : `${h} ساعت`}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={draft.followUpTranscribeVoices}
              onChange={(e) => update("followUpTranscribeVoices", e.target.checked)}
            />
            <span>🎤 ویس‌ها رو هم به متن تبدیل کن و در تحلیل AI لحاظ کن</span>
          </label>
        </Card>

        <Card>
          <div className="text-xs font-medium mb-2">📊 Auto-summarize</div>
          <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
            خلاصه‌ی thread وقتی گپ گفت‌وگو فاصله می‌گیره.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
            <TriToggle
              label="فعال"
              value={draft.autoSummarizeEnabled}
              onChange={(v) => update("autoSummarizeEnabled", v)}
            />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--color-text-dim)]">گپ (دقیقه)</span>
              <input
                type="number"
                value={draft.autoSummarizeGapMinutes ?? ""}
                placeholder="per-chat"
                onChange={(e) => update("autoSummarizeGapMinutes", e.target.value === "" ? null : Number(e.target.value))}
                className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
            </label>
            <TriToggle
              label="timing هوشمند"
              value={draft.autoSummarizeSmartTiming}
              onChange={(v) => update("autoSummarizeSmartTiming", v)}
            />
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium mb-2">📦 Storage routing (auto-forward)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <TriToggle label="🎤 voice → voice_storage" value={draft.autoForwardVoice} onChange={(v) => update("autoForwardVoice", v)} />
            <TriToggle label="🎥 video → video_storage" value={draft.autoForwardVideo} onChange={(v) => update("autoForwardVideo", v)} />
            <TriToggle label="📸 photo → photo_storage" value={draft.autoForwardPhoto} onChange={(v) => update("autoForwardPhoto", v)} />
            <TriToggle label="📍 location → notes_inbox" value={draft.autoForwardLocation} onChange={(v) => update("autoForwardLocation", v)} />
            <TriToggle label="📒 استخراج خودکار Notes" value={draft.autoExtractNotes} onChange={(v) => update("autoExtractNotes", v)} />
          </div>
        </Card>

        <Card>
          <div className="text-xs font-medium mb-2">🤖 AI process media</div>
          <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
            آیا AI روی این نوع رسانه‌ها پاسخ بسازه و نقش کلی AI mode رو روشون اعمال کنه.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <TriToggle label="🎤 voice" value={draft.aiProcessVoice} onChange={(v) => update("aiProcessVoice", v)} />
            <TriToggle label="🌟 stickers" value={draft.aiProcessStickers} onChange={(v) => update("aiProcessStickers", v)} />
            <TriToggle label="🎞 GIFs" value={draft.aiProcessGifs} onChange={(v) => update("aiProcessGifs", v)} />
            <TriToggle label="📷 photos" value={draft.aiProcessPhotos} onChange={(v) => update("aiProcessPhotos", v)} />
            <TriToggle label="📹 video notes" value={draft.aiProcessVideoNotes} onChange={(v) => update("aiProcessVideoNotes", v)} />
          </div>
        </Card>

        {chats.length > 0 && (
          <Card>
            <div className="text-xs font-medium mb-2">
              👥 چت‌های متصل به این پروفایل ({chats.length})
            </div>
            <ul className="divide-y divide-[var(--color-border)] text-xs">
              {chats.slice(0, 50).map((c) => (
                <li key={c.chatId}>
                  <Link
                    href={`/chats/${c.chatId}`}
                    className="flex justify-between py-1.5 hover:text-[var(--color-accent)]"
                  >
                    <span>{c.name || `chat ${c.chatId}`}</span>
                    <span className="text-[10px] text-[var(--color-text-dim)]">{c.chatId}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {chats.length > 50 && (
              <div className="text-[10px] text-[var(--color-text-dim)] mt-2">
                ...و {chats.length - 50} مورد دیگر
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="fixed bottom-16 md:bottom-4 left-0 right-0 md:left-60 z-10 px-4">
        <div className="max-w-3xl mx-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-3 shadow-lg flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-dim)] mr-auto">
            {dirty ? "تغییرات ذخیره نشده" : "ذخیره‌شده ✓"}
          </span>
          <button
            onClick={() => setDraft(original)}
            disabled={!dirty || saving}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] disabled:opacity-50"
          >
            انصراف
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-xs px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            {saving ? "..." : "💾 ذخیره"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs px-1 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/30">
      <span>{label}</span>
      <select
        value={value == null ? "" : value ? "on" : "off"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : v === "on");
        }}
        className="text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md px-1.5 py-1"
      >
        <option value="">per-chat</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </select>
    </div>
  );
}
