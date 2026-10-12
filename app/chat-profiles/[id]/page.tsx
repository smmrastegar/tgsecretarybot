"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";

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
  { v: "off", label: "خاموش" },
  { v: "secretary", label: "منشی" },
  { v: "auto_reply", label: "پاسخ خودکار" },
  { v: "friendly_reply", label: "پاسخ خودکار دوستانه (AI)" },
  { v: "ai_chat", label: "گفتگوی AI (کامل)" },
  { v: "ai_listen", label: "شنود AI (بی‌صدا)" },
];

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const BTN_PLAIN = `${BTN} border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]`;
// Action row: buttons sit on the physical left (also when it holds links, which the global rule does not cover).
const ACTIONS = "flex flex-wrap gap-2 w-full justify-[left]";
const FIELD = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";
const LABEL = "block text-sm text-[var(--color-text-dim)] mb-1.5";

// How many tri-state flags of a group are overridden (not "per-chat").
const setCount = (...v: Array<boolean | null>) => v.filter((x) => x != null).length;

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

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/chat-profiles/${profileId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { profile: Profile };
      setOriginal(j.profile);
      setDraft(j.profile);
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
        <PageTitle title="👤 پروفایل چت" />
        {err ? (
          <Card>
            <div className="text-sm text-red-300">خطا: {err}</div>
            <div className="mt-3 flex">
              <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
          </Card>
        )}
      </Shell>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };
  const modeLabel = MODES.find((m) => m.v === draft.mode)?.label ?? "per-chat";
  const hoursLabel = (h: number) => (h < 1 ? `${fa(h * 60)} دقیقه` : `${fa(h)} ساعت`);

  return (
    <Shell>
      <PageTitle
        title={`${draft.emoji || "📋"} ${draft.name}`}
        subtitle={`${fa(draft.chatCount)} چت · ${draft.isBuiltin ? "builtin" : "custom"}${draft.isDefault ? " · پیش‌فرض" : ""}`}
        actions={
          <div className={ACTIONS}>
            <Link href="/chat-profiles" className={BTN_PLAIN}>
              ← همه پروفایل‌ها
            </Link>
          </div>
        }
      />

      <div className="pb-36">
        {/* The one big action of this page's body: where the chats of this profile are managed. */}
        <Card className="mb-3">
          <div className="text-sm font-medium mb-1">
            👥 چت‌های متصل به این پروفایل ({fa(draft.chatCount)})
          </div>
          <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
            مدیریت اعضا (اضافه/حذف چت) توی یه صفحه‌ی جداگانه.
          </p>
          <Link href={`/chat-profiles/${profileId}/chats`} className={`${BTN_PRIMARY} w-full`}>
            → مدیریت چت‌ها
          </Link>
        </Card>

        <Section icon="📛" title="اطلاعات پایه" summary={`${draft.emoji || "📋"} ${draft.name}`} defaultOpen>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className={LABEL}>emoji</span>
              <input
                type="text"
                value={draft.emoji ?? ""}
                onChange={(e) => update("emoji", e.target.value || null)}
                className={`${FIELD} text-center`}
              />
            </label>
            <label className="block">
              <span className={LABEL}>اسم</span>
              <input
                type="text"
                dir="auto"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className={LABEL}>توضیح (اختیاری)</span>
              <input
                type="text"
                dir="auto"
                value={draft.description ?? ""}
                onChange={(e) => update("description", e.target.value || null)}
                className={FIELD}
              />
            </label>
          </div>
        </Section>

        <Section
          icon="⚙️"
          title="Mode + پرچم‌ها"
          summary={`${modeLabel} · VIP ${flagText(draft.vip)} · بی‌صدا ${flagText(draft.muted)}`}
        >
          <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
            null = این پروفایل این تنظیم رو override نمی‌کنه (per-chat می‌مونه).
          </p>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className={LABEL}>Mode</span>
              <select
                value={draft.mode ?? ""}
                onChange={(e) => update("mode", e.target.value === "" ? null : e.target.value)}
                className={FIELD}
              >
                <option value="">— per-chat —</option>
                {MODES.map((m) => (
                  <option key={m.v} value={m.v}>{m.label}</option>
                ))}
              </select>
            </label>
            <TriToggle label="VIP" value={draft.vip} onChange={(v) => update("vip", v)} />
            <TriToggle label="بی‌صدا" value={draft.muted} onChange={(v) => update("muted", v)} />
          </div>
        </Section>

        <Section
          icon="⏰"
          title="یادآور جواب‌ندادن"
          summary={draft.followUpEnabled ? `فعال · ${hoursLabel(draft.followUpThresholdHours)}` : "غیرفعال"}
          badge={<Pill tone={draft.followUpEnabled ? "ok" : "neutral"}>{draft.followUpEnabled ? "فعال" : "خاموش"}</Pill>}
        >
          <label className="flex items-center justify-center gap-3 min-h-12 cursor-pointer text-sm mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3">
            <input
              type="checkbox"
              checked={draft.followUpEnabled}
              onChange={(e) => update("followUpEnabled", e.target.checked)}
            />
            <span>یادآور فعال باشه</span>
          </label>
          <div className="flex flex-col gap-3 mb-3">
            <label className="block">
              <span className={LABEL}>آستانه اول</span>
              <select
                value={draft.followUpThresholdHours}
                onChange={(e) => update("followUpThresholdHours", Number(e.target.value))}
                className={FIELD}
              >
                {[0.25, 0.5, 1, 2, 4, 12, 24].map((h) => (
                  <option key={h} value={h}>{h < 1 ? `${h * 60} دقیقه` : `${h} ساعت`}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>escalate بعد از</span>
              <select
                value={draft.followUpEscalateHours}
                onChange={(e) => update("followUpEscalateHours", Number(e.target.value))}
                className={FIELD}
              >
                {[0.5, 1, 2, 4, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>{h < 1 ? `${h * 60} دقیقه` : `${h} ساعت`}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center justify-center gap-3 min-h-12 cursor-pointer text-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2 leading-6">
            <input
              type="checkbox"
              checked={draft.followUpTranscribeVoices}
              onChange={(e) => update("followUpTranscribeVoices", e.target.checked)}
            />
            <span>🎤 ویس‌ها رو هم به متن تبدیل کن و در تحلیل AI لحاظ کن</span>
          </label>
        </Section>

        <Section
          icon="📊"
          title="Auto-summarize"
          summary={`فعال ${flagText(draft.autoSummarizeEnabled)}${draft.autoSummarizeGapMinutes != null ? ` · گپ ${fa(draft.autoSummarizeGapMinutes)} دقیقه` : ""}`}
        >
          <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
            خلاصه‌ی thread وقتی گپ گفت‌وگو فاصله می‌گیره.
          </p>
          <div className="flex flex-col gap-3">
            <TriToggle label="فعال" value={draft.autoSummarizeEnabled} onChange={(v) => update("autoSummarizeEnabled", v)} />
            <label className="block">
              <span className={LABEL}>گپ (دقیقه)</span>
              <input
                type="number"
                inputMode="numeric"
                value={draft.autoSummarizeGapMinutes ?? ""}
                placeholder="per-chat"
                onChange={(e) => update("autoSummarizeGapMinutes", e.target.value === "" ? null : Number(e.target.value))}
                className={`${FIELD} text-center`}
              />
            </label>
            <TriToggle label="timing هوشمند" value={draft.autoSummarizeSmartTiming} onChange={(v) => update("autoSummarizeSmartTiming", v)} />
          </div>
        </Section>

        <Section
          icon="📦"
          title="Storage routing (auto-forward)"
          summary={`${fa(setCount(draft.autoForwardVoice, draft.autoForwardVideo, draft.autoForwardPhoto, draft.autoForwardLocation, draft.autoExtractNotes))} از ${fa(5)} مورد تنظیم‌شده`}
        >
          <div className="flex flex-col gap-3">
            <TriToggle label="🎤 voice → voice_storage" value={draft.autoForwardVoice} onChange={(v) => update("autoForwardVoice", v)} />
            <TriToggle label="🎥 video → video_storage" value={draft.autoForwardVideo} onChange={(v) => update("autoForwardVideo", v)} />
            <TriToggle label="📸 photo → photo_storage" value={draft.autoForwardPhoto} onChange={(v) => update("autoForwardPhoto", v)} />
            <TriToggle label="📍 location → notes_inbox" value={draft.autoForwardLocation} onChange={(v) => update("autoForwardLocation", v)} />
            <TriToggle label="📒 استخراج خودکار Notes" value={draft.autoExtractNotes} onChange={(v) => update("autoExtractNotes", v)} />
          </div>
        </Section>

        <Section
          icon="🤖"
          title="AI process media"
          summary={`${fa(setCount(draft.aiProcessVoice, draft.aiProcessStickers, draft.aiProcessGifs, draft.aiProcessPhotos, draft.aiProcessVideoNotes))} از ${fa(5)} مورد تنظیم‌شده`}
        >
          <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
            آیا AI روی این نوع رسانه‌ها پاسخ بسازه و نقش کلی AI mode رو روشون اعمال کنه.
          </p>
          <div className="flex flex-col gap-3">
            <TriToggle label="🎤 voice" value={draft.aiProcessVoice} onChange={(v) => update("aiProcessVoice", v)} />
            <TriToggle label="🌟 stickers" value={draft.aiProcessStickers} onChange={(v) => update("aiProcessStickers", v)} />
            <TriToggle label="🎞 GIFs" value={draft.aiProcessGifs} onChange={(v) => update("aiProcessGifs", v)} />
            <TriToggle label="📷 photos" value={draft.aiProcessPhotos} onChange={(v) => update("aiProcessPhotos", v)} />
            <TriToggle label="📹 video notes" value={draft.aiProcessVideoNotes} onChange={(v) => update("aiProcessVideoNotes", v)} />
          </div>
        </Section>
      </div>

      <div className="fixed bottom-16 md:bottom-4 left-0 right-0 md:left-60 z-10 px-4">
        <div className="max-w-3xl mx-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-3 shadow-lg flex items-center gap-2">
          <span className="min-w-0 flex-1 text-center text-sm text-[var(--color-text-dim)]">
            {dirty ? "تغییرات ذخیره نشده" : "ذخیره‌شده ✓"}
          </span>
          <button onClick={() => setDraft(original)} disabled={!dirty || saving} className={BTN_PLAIN}>
            انصراف
          </button>
          <button onClick={save} disabled={!dirty || saving} className={BTN_PRIMARY}>
            {saving ? "..." : "💾 ذخیره"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function flagText(v: boolean | null): string {
  return v == null ? "per-chat" : v ? "on" : "off";
}

// Three-way switch (inherit / on / off) as one segmented control: three big touch targets instead of a tiny <select>.
function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const opts: Array<{ v: boolean | null; text: string }> = [
    { v: null, text: "per-chat" },
    { v: true, text: "on" },
    { v: false, text: "off" },
  ];
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 p-2.5">
      <div className="text-sm text-center mb-2 leading-6" dir="auto">{label}</div>
      <div role="group" aria-label={label} dir="ltr" className="grid grid-cols-3 gap-1.5">
        {opts.map((o) => {
          const active = value === o.v;
          const tone = !active
            ? "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
            : o.v === true
              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
              : o.v === false
                ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
                : "bg-[var(--color-accent)] border-transparent text-white";
          return (
            <button key={o.text} type="button" onClick={() => onChange(o.v)} aria-pressed={active}
              className={`min-h-11 rounded-lg border text-sm ${tone}`}>
              {o.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
