"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import OwnerPhotoUploader from "@/components/OwnerPhotoUploader";
import Section, { Pill } from "@/components/ui/Section";

type Settings = {
  ownerName: string;
  ownerDisplayName: string;
  ownerContext: string;
  ownerAliasesCsv: string;
  ownerJobDescription: string;
  groupPriorityKeywordsCsv: string;
  importanceThreshold: string;
  ownerNotifyChatId: string;
  alertWebhookUrl: string;
  alertWebhookMethod: string;
  alertWebhookHeaders: string;
  autoReplyEnabled: string;
  autoReplyText: string;
  autoReplyCooldownMinutes: string;
  groupAnalysisEnabled: string;
  groupSummaryHourUTC: string;
  dmActiveGraceMinutes: string;
  groupActiveGraceMinutes: string;
  secretaryEnabled: string;
  secretaryUserId: string;
  secretaryDisplayName: string;
  secretarySessionMinutes: string;
  secretarySuppressAutoReply: string;
  secretaryAutoTranscribe: string;
  secretariesJson: string;
  aiModelsCsv: string;
  aiChatModelsCsv: string;
  sttLanguage: string;
  markMessagesAsRead: string;
  autoExtractEnabled: string;
  autoExtractMinImportance: string;
  chatDefaultMode: string;
  chatDefaultRelationship: string;
  chatDefaultAutoForwardVoice: string;
  chatDefaultAutoForwardVideo: string;
  chatDefaultAutoForwardPhoto: string;
  chatDefaultAutoForwardLocation: string;
  chatDefaultAutoExtractNotes: string;
  chatDefaultAutoSummarizeEnabled: string;
  chatDefaultAutoSummarizeGapMinutes: string;
  chatDefaultAutoSummarizeSmartTiming: string;
  chatDefaultAiProcessVoice: string;
  chatDefaultAiProcessStickers: string;
  chatDefaultAiProcessGifs: string;
  chatDefaultAiProcessPhotos: string;
  chatDefaultAiProcessVideoNotes: string;
  chatDefaultAiGeneratePhoto: string;
  ownerPhotoUrl: string;
  smsSilentSenderPatterns: string;
  smsSilentCopyChatId: string;
  smsSilentCopyThreadId: string;
  channelMirrors: string;
};

type FieldConfig = {
  key: keyof Settings;
  label: string;
  hint?: string;
  type?: "text" | "textarea" | "number" | "toggle";
};

// The custom editors that sit between (or after) a group's plain fields.
type Block = "photo" | "secretaries" | "models" | "chatModels" | "headers";

type Group = {
  id: string;
  icon: string;
  title: string;
  summary: (v: Settings) => string;
  badge?: (v: Settings) => ReactNode;
  lead?: Block[];
  fields: FieldConfig[];
  tail?: Block[];
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));
const isOn = (s: string) => s.toLowerCase() !== "false" && s !== "";
const onOff = (s: string) => <Pill tone={isOn(s) ? "ok" : "neutral"}>{isOn(s) ? "روشن" : "خاموش"}</Pill>;
const csv = (s: string) => (s || "").split(",").map((m) => m.trim()).filter(Boolean);

// The old page was one 1,100-line scroll. Settings are now grouped by purpose into collapsible sections
// (closed by default) with a one-line live summary each; the save button is pinned at the bottom.
const GROUPS: Group[] = [
  {
    id: "profile",
    icon: "👤",
    title: "پروفایل صاحب",
    summary: v => v.ownerName ? `${v.ownerName} · نام، نام‌های مستعار، کلمات کلیدی` : "نام، نام‌های مستعار، کلمات کلیدی",
    lead: ["photo"],
    fields: [
      {
        key: "ownerName",
        label: "نام شما",
        hint: "مردم توی چت‌ها چطور صدات می‌کنن. به دسته‌بند کمک می‌کنه پیام‌هایی که خطاب به توئه رو تشخیص بده.",
      },
      {
        key: "ownerDisplayName",
        label: "نامی که در پاسخ‌ها استفاده می‌شه",
        hint: "نامی که توی گفتگوها باهاش امضا می‌کنی (AI / پاسخ خودکار دوستانه موقع امضا ازش استفاده می‌کنه). پیش‌فرض همون نام شماست.",
      },
      {
        key: "ownerContext",
        label: "زمینه‌ی شخصی",
        hint: "یکی دو جمله درباره‌ی خودت (نقش، خانواده، موضوعات رایج).",
        type: "textarea",
      },
      {
        key: "ownerAliasesCsv",
        label: "نام‌های مستعار / لقب‌ها (جدا با کاما)",
        hint: "هر شکلی که مردم توی گروه‌ها باهاش بهت اشاره می‌کنن — نام کوچک، نام خانوادگی، غلط‌های املایی رایج، لقب‌ها، @-هندل‌ها بدون @. مثال: مهدی, موتی, راستگار, mahdi. دسته‌بند هر تطبیقی رو یعنی خطاب به تو در نظر می‌گیره.",
      },
      {
        key: "ownerJobDescription",
        label: "کارت چیه",
        hint: "یک خط کوتاه. دسته‌بند ازش استفاده می‌کنه تا بسنجه یه پیام گروهی به کارت مربوطه یا نه.",
        type: "textarea",
      },
      {
        key: "groupPriorityKeywordsCsv",
        label: "کلمات کلیدی مهم (جدا با کاما)",
        hint: "اسم پروژه‌ها، محصولات، ددلاین‌ها، هر چیزی که می‌خوای خودکار علامت بخوره. یه تطبیق importance رو حدود ۲ واحد بالا می‌بره و پیام رو مربوط به تو علامت می‌زنه.",
      },
    ],
  },
  {
    id: "secretary",
    icon: "🧑‍💼",
    title: "منشی‌ها",
    summary: v => `${fa(parseSecretaries(v.secretariesJson).length)} منشی · لینک دعوت و رونویسی صدا`,
    badge: v => onOff(v.secretaryEnabled),
    lead: ["secretaries"],
    fields: [
      {
        key: "secretaryEnabled",
        label: "فعال",
        type: "toggle",
      },
      {
        key: "secretarySessionMinutes",
        label: "مهلت بیکاری session (دقیقه)",
        hint: "بعد از این مدت بی‌فعالیتی، thread خودکار بسته می‌شه و پیام فوری بعدی یه session تازه شروع می‌کنه.",
        type: "number",
      },
      {
        key: "secretarySuppressAutoReply",
        label: "سرکوب پاسخ خودکار وقتی منشی داره رسیدگی می‌کنه",
        type: "toggle",
      },
      {
        key: "secretaryAutoTranscribe",
        label: "رونویسی خودکار voice / audio / video note برای منشی",
        hint: "وقتی یه پیام صوتی یا voice فوروارد می‌شه، بات رونوشت Groq / Gemini رو هم به‌عنوان پاسخ توی همون thread می‌فرسته.",
        type: "toggle",
      },
      {
        key: "sttLanguage",
        label: "زبان رونویسی (ISO 639-1)",
        hint: 'زبان صوت رو به‌جای حدس Whisper اجباری کن (Whisper صوت کوتاه فارسی رو اشتباه انگلیسی می‌خونه). مثال‌ها: "fa" فارسی، "en" انگلیسی، "ar" عربی. برای تشخیص خودکار خالی بذار.',
      },
      {
        key: "markMessagesAsRead",
        label: "پیام فرستنده رو بعد از هر پاسخ «دیده‌شده» علامت بزن",
        hint: "وقتی بات از طریق business connection جواب می‌ده (پاسخ خودکار، AI، دوستانه، relay منشی، یا ارسال از داشبورد)، readBusinessMessage رو هم صدا می‌زنه تا فرستنده تیک دیده‌شده بگیره. به دسترسی can_read_messages توی Telegram Business ← Chatbots نیاز داره. اگه ترجیح می‌دی تیک دیده‌شده نشون داده نشه این رو خاموش کن.",
        type: "toggle",
      },
    ],
  },
  {
    id: "models",
    icon: "🧠",
    title: "مدل‌های AI",
    summary: v => `${fa(csv(v.aiModelsCsv).length)} مدل دسته‌بندی · ${fa(csv(v.aiChatModelsCsv).length)} مدل چت`,
    lead: ["models", "chatModels"],
    fields: [],
  },
  {
    id: "urgent",
    icon: "🚨",
    title: "تشخیص فوری",
    summary: v => `آستانه‌ی importance: ${fa(v.importanceThreshold || "؟")} از ۱۰`,
    fields: [
      {
        key: "importanceThreshold",
        label: "آستانه‌ی importance (۰ تا ۱۰)",
        hint: "زیر این مقدار، هشدارها سرکوب می‌شن حتی اگه فوری علامت خورده باشن.",
        type: "number",
      },
      {
        key: "ownerNotifyChatId",
        label: "chat id تلگرام برای هشدار فوری",
        hint: "معمولاً user id خودته. یه کپی از هر هشدار رو از طریق این بات دریافت می‌کنه.",
      },
    ],
  },
  {
    id: "grace",
    icon: "⏳",
    title: "مهلت گفتگوی فعال",
    summary: v => `DM ${fa(v.dmActiveGraceMinutes || 0)} دقیقه · گروه ${fa(v.groupActiveGraceMinutes || 0)} دقیقه`,
    fields: [
      {
        key: "dmActiveGraceMinutes",
        label: "مهلت DM (دقیقه)",
        hint: "اگه تو توی این بازه توی یه DM پیامی فرستاده باشی، پیام‌های ورودی اونجا فقط لاگ می‌شن ولی دسته‌بندی، هشدار یا پاسخ خودکار نمی‌گیرن. ۰ یعنی غیرفعال. چت‌های VIP از این مستثنان.",
        type: "number",
      },
      {
        key: "groupActiveGraceMinutes",
        label: "مهلت گروه (دقیقه)",
        hint: "همین ایده برای چت‌های گروهی. پیش‌فرضش بالاتره چون فعالیت گروه پرنوسانه.",
        type: "number",
      },
    ],
  },
  {
    id: "autoreply",
    icon: "💬",
    title: "پاسخ خودکار",
    summary: () => "فقط برای DMهای فوری",
    badge: v => onOff(v.autoReplyEnabled),
    fields: [
      { key: "autoReplyEnabled", label: "فعال", type: "toggle" },
      { key: "autoReplyText", label: "متن پیش‌فرض", type: "textarea" },
      {
        key: "autoReplyCooldownMinutes",
        label: "cooldown برای هر فرستنده (دقیقه)",
        hint: "توی این بازه بیشتر از یک بار به یه چت پاسخ خودکار نمی‌ده.",
        type: "number",
      },
    ],
  },
  {
    id: "webhook",
    icon: "🔔",
    title: "webhook هشدار",
    summary: v => v.alertWebhookUrl ? "آدرس تنظیم شده" : "غیرفعال — آدرسی ثبت نشده",
    fields: [
      {
        key: "alertWebhookUrl",
        label: "آدرس webhook هشدار",
        hint: "با payload پیام فوری POST می‌شه. خالی یعنی غیرفعال.",
      },
      {
        key: "alertWebhookMethod",
        label: "متد HTTP",
      },
    ],
    tail: ["headers"],
  },
  {
    id: "analysis",
    icon: "📊",
    title: "تحلیل‌گر گروه",
    summary: () => "خلاصه‌ی روزانه‌ی گروه‌ها",
    badge: v => onOff(v.groupAnalysisEnabled),
    fields: [
      { key: "groupAnalysisEnabled", label: "فعال", type: "toggle" },
      {
        key: "groupSummaryHourUTC",
        label: "ساعت خلاصه‌ی روزانه (UTC)",
        hint: "Vercel Cron جداگانه توی vercel.json تنظیم می‌شه.",
        type: "number",
      },
    ],
  },
  {
    id: "extract",
    icon: "🗓",
    title: "یادآوری و تقویم",
    summary: () => "استخراج خودکار کارها با AI",
    badge: v => onOff(v.autoExtractEnabled),
    fields: [
      {
        key: "autoExtractEnabled",
        label: "استخراج خودکار رویدادها / کارها / یادآوری‌ها از پیام‌ها",
        hint: "بعد از دسته‌بندی هر پیام ورودی، AI دنبال تاریخ‌ها، ددلاین‌ها و کارها می‌گرده و به /reminders اضافه‌شون می‌کنه. خاموش کن تا فقط وقتی دستی 🧠 استخراج می‌زنی استخراج بشه.",
        type: "toggle",
      },
      {
        key: "autoExtractMinImportance",
        label: "حداقل importance برای استخراج خودکار (۰ تا ۱۰)",
        hint: "پیام‌هایی که زیر این importance دسته‌بندی شدن رو رد کن تا هزینه‌ی AI کم شه. پیش‌فرض ۴: تبلیغ/اسپم رو نادیده می‌گیره، هر چیزی که شبیه گفتگوی واقعیه رو پردازش می‌کنه.",
        type: "number",
      },
    ],
  },
  {
    id: "defaults",
    icon: "📋",
    title: "پیش‌فرض چت‌های جدید",
    summary: () => "فوروارد، پردازش AI، خلاصه‌سازی",
    fields: [
      {
        key: "chatDefaultMode",
        label: "Mode پیش‌فرض",
        hint: "وقتی بات اولین بار یه چت رو می‌بینه، rule‌اش با این مقدار ساخته می‌شه. روی هر چت قابل override.",
      },
      {
        key: "chatDefaultRelationship",
        label: "Relationship پیش‌فرض (اختیاری)",
        hint: "خالی = بدون رابطه. مقادیر معتبر: close_family / family / close_friend / friend / work_acquaintance / employer / formal / suspicious / stranger.",
      },
      {
        key: "chatDefaultAutoForwardVoice",
        label: "🎤 auto-forward voice + video-note (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardVideo",
        label: "🎬 auto-forward video (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardPhoto",
        label: "🖼 auto-forward photo (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoForwardLocation",
        label: "📍 auto-forward location (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoExtractNotes",
        label: "📒 استخراج خودکار Notes با AI (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoSummarizeEnabled",
        label: "📬 Auto-summarize threads (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAutoSummarizeGapMinutes",
        label: "🕐 gap سکوت برای close thread (دقیقه)",
        type: "number",
      },
      {
        key: "chatDefaultAutoSummarizeSmartTiming",
        label: "🧠 timing هوشمند — gap از آخرین پیام «شروع‌کننده» حساب شه",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessVoice",
        label: "🎤 AI process voice (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessStickers",
        label: "🎨 AI process sticker (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessGifs",
        label: "🎞 AI process GIF (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessPhotos",
        label: "📷 AI process photo (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiProcessVideoNotes",
        label: "📹 AI process video note (پیش‌فرض)",
        type: "toggle",
      },
      {
        key: "chatDefaultAiGeneratePhoto",
        label: "🖼 AI generate photo of owner (پیش‌فرض)",
        type: "toggle",
      },
    ],
  },
  {
    id: "sms",
    icon: "📟",
    title: "پیامک سایلنت",
    summary: () => "الگوهای فرستنده و مقصد کپی",
    fields: [
      {
        key: "smsSilentSenderPatterns",
        label: "الگوهای فرستنده‌ی سایلنت",
        hint: "هر خط یک الگو (یا با کاما). اگه اسم فرستنده یا متن پیامک شامل یکی از این‌ها باشه، بی‌صدا (بدون نوتیف) توی کانال منتشر می‌شه. مثلاً «مانیتورینگ» همه‌ی هشدارهای «سرویس مانیتورینگ لیمومی» رو می‌گیره. حساس به بزرگی/کوچکی نیست و ي/ك عربی رو هم می‌فهمه.",
        type: "textarea",
      },
      {
        key: "smsSilentCopyChatId",
        label: "chat id مقصد کپی (اختیاری)",
        hint: "یک نسخه از هر پیامک سایلنت اینجا هم لاگ می‌شه (بی‌صدا). آی‌دی گروه — مثلاً ‎-1004364845878‎. خالی = بدون کپی.",
      },
      {
        key: "smsSilentCopyThreadId",
        label: "topic (thread) id مقصد کپی (اختیاری)",
        hint: "اگه مقصد یه تاپیک داخل گروهه، آی‌دی تاپیک رو بذار (مثلاً ۱۱۶۳ برای تاپیک Monitoring). خالی = ریشه‌ی گروه.",
        type: "number",
      },
    ],
  },
  {
    id: "mirror",
    icon: "🔁",
    title: "آینه‌ی کانال",
    summary: v => `${fa(v.channelMirrors.split("\n").filter(l => l.trim()).length)} قانون`,
    fields: [
      {
        key: "channelMirrors",
        label: "قوانین آینه — هر خط یک قانون",
        hint: "هر پستی که توی کانال/گروه مبدأ بیاد، عیناً توی مقصد کپی می‌شه (بدون برچسب forward). هر خط: «آی‌دی‌مبدأ > آی‌دی‌مقصد» و در صورت نیاز «> آی‌دی‌تاپیک». مثال: ‎-1003979188345 > -1004487820314‎. حلقه‌گارد داره (مقصد هیچ‌وقت به‌عنوان مبدأ استفاده نمی‌شه). خالی = غیرفعال. توجه: بات باید توی مبدأ عضو و توی مقصد ادمین با اجازه‌ی ارسال باشه.",
        type: "textarea",
      },
    ],
  },
];

const KNOWN_MODELS: Array<{ id: string; in: number; out: number; label: string }> = [
  { id: "google/gemini-2.5-flash-lite", in: 0.1, out: 0.4, label: "Gemini 2.5 Flash Lite" },
  { id: "google/gemini-2.5-flash", in: 0.3, out: 2.5, label: "Gemini 2.5 Flash" },
  { id: "google/gemini-2.5-pro", in: 1.25, out: 10.0, label: "Gemini 2.5 Pro" },
  { id: "anthropic/claude-haiku-4-5", in: 1.0, out: 5.0, label: "Claude Haiku 4.5" },
  { id: "anthropic/claude-sonnet-4-6", in: 3.0, out: 15.0, label: "Claude Sonnet 4.6" },
  { id: "openai/gpt-4o-mini", in: 0.15, out: 0.6, label: "GPT-4o mini" },
];

type Secretary = { userId: number; name: string };

type HeaderPair = { key: string; value: string };

function parseHeaders(json: string): HeaderPair[] {
  try {
    const obj = JSON.parse(json || "{}") as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj as Record<string, unknown>).map(([key, v]) => ({
      key,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
  } catch {
    return [];
  }
}

function parseSecretaries(json: string): Secretary[] {
  try {
    const arr = JSON.parse(json || "[]") as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => {
        const o = s as { userId?: unknown; name?: unknown };
        const id = Number(o.userId);
        if (!Number.isFinite(id) || id <= 0) return null;
        return { userId: id, name: typeof o.name === "string" ? o.name : `user ${id}` };
      })
      .filter((x): x is Secretary => x !== null);
  } catch {
    return [];
  }
}

// Form controls. Typed text stays start-aligned (it is input, not card copy); labels and hints are centred.
const inputCls = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2 disabled:opacity-60";
const miniInputCls = "w-full min-h-11 text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-3 py-2 disabled:opacity-60";
const btnCls = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-40";
const iconBtnCls = "min-h-10 min-w-10 px-2 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface)] disabled:opacity-30";
const LOCKED = "(قفل‌شده با env)";
const SAVED = "ذخیره شد.";

export default function SettingsPage() {
  const [values, setValues] = useState<Settings | null>(null);
  const [initial, setInitial] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [envLocked, setEnvLocked] = useState<Set<keyof Settings>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Admin can edit a specific tenant's overrides via ?tenant=<id>.
  // The route enforces admin-ness; we just plumb the query param
  // through to every fetch so reads and writes stay consistent.
  const tenantId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("tenant")
      : null;
  const tenantQuery = tenantId
    ? `?tenant=${encodeURIComponent(tenantId)}`
    : "";
  const [tenantName, setTenantName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch(`/api/settings${tenantQuery}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        values: Settings;
        envLocked: Array<keyof Settings>;
        meta?: { defaultModel?: string; tenantId?: number | null; tenantName?: string | null };
      };
      if (j.meta?.tenantName) setTenantName(j.meta.tenantName);

      // Migrate legacy fields so the new editors are pre-populated:
      //  - secretariesJson empty + legacy secretaryUserId set → seed the list
      //  - aiModelsCsv empty + meta.defaultModel known → seed the list
      const v = { ...j.values };
      if (!v.secretariesJson || v.secretariesJson.trim() === "") {
        const legacyId = Number(v.secretaryUserId);
        if (Number.isFinite(legacyId) && legacyId > 0) {
          v.secretariesJson = JSON.stringify([
            { userId: legacyId, name: v.secretaryDisplayName || "Secretary" },
          ]);
        }
      }
      if (
        (!v.aiModelsCsv || v.aiModelsCsv.trim() === "") &&
        j.meta?.defaultModel
      ) {
        v.aiModelsCsv = j.meta.defaultModel;
      }

      setValues(v);
      setInitial(JSON.stringify(v));
      setEnvLocked(new Set(j.envLocked));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [tenantQuery]);

  useEffect(() => {
    load();
  }, [load]);

  function update<K extends keyof Settings>(key: K, val: string) {
    setValues((v) => (v ? { ...v, [key]: val } : v));
  }

  async function save() {
    if (!values) return;
    setSaving(true);
    setMsg(null);
    const payload: Partial<Settings> = {};
    for (const k of Object.keys(values) as Array<keyof Settings>) {
      if (!envLocked.has(k)) payload[k] = values[k];
    }
    try {
      const r = await fetch(`/api/settings${tenantQuery}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `ذخیره ناموفق بود (${r.status})`);
      }
      setMsg(SAVED);
      setInitial(JSON.stringify(values));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!values) {
    return (
      <Shell>
        <PageTitle title="تنظیمات" />
        {loadError ? (
          <Card>
            <p className="text-sm text-rose-300">بارگذاری تنظیمات ناموفق بود ({loadError})</p>
            <button onClick={load} className="mt-3 min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium">تلاش دوباره</button>
          </Card>
        ) : (
          <Card>در حال بارگذاری…</Card>
        )}
      </Shell>
    );
  }

  const dirty = JSON.stringify(values) !== initial;
  const lockedNote = (k: keyof Settings) => (envLocked.has(k) ? <span className="mx-1 italic">{LOCKED}</span> : null);

  const renderBlock = (b: Block) => {
    switch (b) {
      case "photo":
        // Owner reference photo — uploads a file instead of needing a URL.
        return <OwnerPhotoUploader key={b} />;
      case "secretaries":
        return (
          <div key={b}>
            <h3 className="text-sm font-semibold mb-1">لیست منشی‌ها{lockedNote("secretariesJson")}</h3>
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
              اولین نفر توی لیست، فوروارد‌های خودکار رو انجام می‌ده. هر کسی رو با یه user id عددی تلگرام می‌تونی اضافه یا حذف کنی (باید یه بار بات رو /start کنه تا بتونه بهش DM بده). یا لینک دعوت زیر رو براشون بفرست تا وقتی روش زدن، خودکار اضافه بشن.
            </p>
            <SecretariesEditor
              value={parseSecretaries(values.secretariesJson)}
              disabled={envLocked.has("secretariesJson")}
              onChange={(list) => update("secretariesJson", JSON.stringify(list))}
            />
            <InviteLinkPanel disabled={envLocked.has("secretariesJson")} />
          </div>
        );
      case "models":
        return (
          <div key={b}>
            <h3 className="text-sm font-semibold mb-1">دسته‌بندی و خلاصه‌ها{lockedNote("aiModelsCsv")}</h3>
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
              برای تشخیص فوری، خلاصه‌ی گروه‌ها و متادیتای رونویسی استفاده می‌شه. به ترتیب امتحان می‌شن؛ در صورت خطا به بعدی برمی‌گرده.
            </p>
            <ModelsEditor
              value={csv(values.aiModelsCsv)}
              disabled={envLocked.has("aiModelsCsv")}
              onChange={(list) => update("aiModelsCsv", list.join(", "))}
            />
          </div>
        );
      case "chatModels":
        return (
          <div key={b} className="pt-5 border-t border-[var(--color-border)]">
            <h3 className="text-sm font-semibold mb-1">چت و پاسخ دوستانه{lockedNote("aiChatModelsCsv")}</h3>
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
              لیست جداگانه‌ای که فقط وقتی یه چت توی حالت <strong>AI chat</strong> یا <strong>پاسخ خودکار دوستانه</strong> باشه استفاده می‌شه. مدل‌های باهوش‌تر رو اینجا بذار (Claude Sonnet, GPT-4o, …) — فقط وقتی یه گفتگوی واقعی در جریانه اجرا می‌شن. خالی بذار تا از همون لیست دسته‌بندی استفاده بشه.
            </p>
            <ModelsEditor
              value={csv(values.aiChatModelsCsv)}
              disabled={envLocked.has("aiChatModelsCsv")}
              onChange={(list) => update("aiChatModelsCsv", list.join(", "))}
            />
          </div>
        );
      case "headers":
        return (
          <div key={b} className="pt-5 border-t border-[var(--color-border)]">
            <h3 className="text-sm font-semibold mb-1">هدرهای webhook هشدار{lockedNote("alertWebhookHeaders")}</h3>
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
              هدرهای HTTP اضافه‌ای که با هر فراخوانی webhook هشدار فرستاده می‌شن.
            </p>
            <HeadersEditor
              value={parseHeaders(values.alertWebhookHeaders)}
              disabled={envLocked.has("alertWebhookHeaders")}
              onChange={(pairs) =>
                update(
                  "alertWebhookHeaders",
                  JSON.stringify(Object.fromEntries(pairs.filter((p) => p.key).map((p) => [p.key, p.value]))),
                )
              }
            />
          </div>
        );
    }
  };

  return (
    <Shell>
      {tenantId && (
        <div className="mb-3 p-3 rounded-2xl border border-amber-700 bg-amber-900/20 text-center">
          <div className="text-sm font-medium text-amber-200">
            🏢 در حال ویرایش tenant: {tenantName ?? `#${tenantId}`}
          </div>
          <div className="text-xs leading-6 text-amber-300/80 mt-1">
            تغییرات روی این tenant ذخیره می‌شن — مقادیر خالی fallback به global. برای ویرایش global،{" "}
            <a href="/settings" className="underline">
              برو settings بدون ?tenant
            </a>
            .
          </div>
        </div>
      )}
      <PageTitle
        title={tenantId ? `تنظیمات · ${tenantName ?? `#${tenantId}`}` : "تنظیمات"}
        subtitle="همه چیز قابل تنظیم. مقادیری که با متغیرهای محیطی قفل شدن فقط‌خواندنی هستن."
      />

      <Link
        href="/settings"
        className="mb-4 inline-flex min-h-11 items-center text-sm text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
      >
        ← برگشت به Settings
      </Link>

      {GROUPS.map((g) => (
        <Section key={g.id} icon={g.icon} title={g.title} summary={g.summary(values)} badge={g.badge?.(values)}>
          <div className="flex flex-col gap-5">
            {g.lead?.map(renderBlock)}
            {g.fields.length > 0 && (
              <div className="flex flex-col gap-4">
                {g.fields.map((f) => (
                  <FieldRow
                    key={f.key}
                    f={f}
                    value={values[f.key]}
                    locked={envLocked.has(f.key)}
                    onChange={(val) => update(f.key, val)}
                  />
                ))}
              </div>
            )}
            {g.tail?.map(renderBlock)}
          </div>
        </Section>
      ))}

      {/* Pinned save bar: always reachable, shows whether anything is unsaved. Sits above the mobile tab bar. */}
      <div className="sticky bottom-[4.5rem] md:bottom-3 z-10 mt-4 flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-lg">
        <span
          role="status"
          className={`min-w-0 flex-1 text-center text-xs leading-5 ${msg && msg !== SAVED ? "text-rose-300" : msg === SAVED ? "text-emerald-300" : dirty ? "text-amber-200" : "text-[var(--color-text-dim)]"}`}
        >
          {msg ?? (dirty ? "تغییرات ذخیره‌نشده داری" : "همه‌ی تغییرات ذخیره‌ست")}
        </span>
        <button
          disabled={saving}
          onClick={save}
          className="shrink-0 min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "در حال ذخیره…" : "ذخیره‌ی تغییرات"}
        </button>
      </div>
    </Shell>
  );
}

// One setting: a toggle becomes label + explanation + 52 px switch; everything else is label, field, hint.
function FieldRow({ f, value, locked, onChange }: { f: FieldConfig; value: string; locked: boolean; onChange: (v: string) => void }) {
  const lockedSuffix = locked ? <span className="mx-1 text-xs italic text-[var(--color-text-dim)]">{LOCKED}</span> : null;
  if (f.type === "toggle") {
    return (
      <label className="flex items-center gap-3 min-h-14 py-2.5 px-3 rounded-xl bg-[var(--color-surface-2)] cursor-pointer">
        <span className="min-w-0 flex-1 text-center">
          <span className="block text-sm leading-6">
            {f.label}
            {lockedSuffix}
          </span>
          {f.hint && <span className="block text-xs leading-6 text-[var(--color-text-dim)]">{f.hint}</span>}
        </span>
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          disabled={locked}
          checked={isOn(value)}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
        <span
          aria-hidden
          className="relative shrink-0 w-[52px] h-8 rounded-full bg-[var(--color-border)] transition-colors peer-checked:bg-[var(--color-accent)] peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent)] after:content-[''] after:absolute after:top-1 after:left-1 after:w-6 after:h-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
        />
      </label>
    );
  }
  return (
    <div>
      <label className="block text-sm leading-6 mb-1.5">
        {f.label}
        {lockedSuffix}
      </label>
      {f.type === "textarea" ? (
        <textarea
          rows={3}
          dir="auto"
          disabled={locked}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} leading-6`}
        />
      ) : (
        <input
          type={f.type === "number" ? "number" : "text"}
          dir={f.type === "number" ? "ltr" : "auto"}
          disabled={locked}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
      {f.hint && <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-1.5">{f.hint}</p>}
    </div>
  );
}

function SecretariesEditor({
  value,
  onChange,
  disabled,
}: {
  value: Secretary[];
  onChange: (list: Secretary[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<Secretary>) {
    const next = value.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { userId: 0, name: "" }]);
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] py-5 text-sm text-[var(--color-text-dim)]">
          هنوز منشی‌ای نیست.
        </p>
      )}
      {value.map((s, idx) => (
        <div key={idx} className="rounded-xl bg-[var(--color-surface-2)] p-3">
          <div className="mb-2 text-xs text-[var(--color-text-dim)]">{idx === 0 ? "★ منشی اصلی" : `منشی ${fa(idx + 1)}`}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              dir="auto"
              disabled={disabled}
              value={s.name}
              placeholder="نام"
              aria-label="نام منشی"
              onChange={(e) => update(idx, { name: e.target.value })}
              className={miniInputCls}
            />
            <input
              type="number"
              dir="ltr"
              disabled={disabled}
              value={s.userId || ""}
              placeholder="user id"
              aria-label="user id"
              onChange={(e) => update(idx, { userId: Number(e.target.value) || 0 })}
              className={miniInputCls}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={disabled || idx === 0} onClick={() => move(idx, -1)} className={iconBtnCls} aria-label="انتقال به بالا">
              ▲
            </button>
            <button disabled={disabled || idx === value.length - 1} onClick={() => move(idx, 1)} className={iconBtnCls} aria-label="انتقال به پایین">
              ▼
            </button>
            <button disabled={disabled} onClick={() => remove(idx)} className={`${iconBtnCls} text-red-400`} aria-label="حذف">
              ✕
            </button>
          </div>
        </div>
      ))}
      <div>
        <button disabled={disabled} onClick={add} className={`${btnCls} border-dashed`}>
          + افزودن منشی
        </button>
      </div>
    </div>
  );
}

function ModelsEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (list: string[]) => void;
  disabled: boolean;
}) {
  const knownIds = new Set(KNOWN_MODELS.map((m) => m.id));
  const available = KNOWN_MODELS.filter((m) => !value.includes(m.id));
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    onChange(next);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add(id: string) {
    if (!id) return;
    onChange([...value, id]);
  }
  function sortByCost() {
    const rateOf = (id: string) =>
      KNOWN_MODELS.find((m) => m.id === id)?.in ?? Infinity;
    onChange([...value].sort((a, b) => rateOf(a) - rateOf(b)));
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] py-5 text-sm text-[var(--color-text-dim)]">
          فقط از OPENROUTER_MODEL پیش‌فرض استفاده می‌شه.
        </p>
      )}
      {value.map((id, idx) => {
        const meta = KNOWN_MODELS.find((m) => m.id === id);
        return (
          <div key={`${id}-${idx}`} className="rounded-xl bg-[var(--color-surface-2)] p-3">
            <div className="min-w-0">
              <div className="text-sm [overflow-wrap:anywhere]">
                <span className="text-xs text-[var(--color-text-dim)]">{idx === 0 ? "★" : fa(idx + 1)} </span>
                {meta?.label ?? id}
              </div>
              <div dir="ltr" className="mt-0.5 text-xs leading-5 text-[var(--color-text-dim)] break-all">{id}</div>
              <div className="text-xs leading-5 text-[var(--color-text-dim)]">
                {meta ? <>ورودی <bdi>${meta.in}/M</bdi> · خروجی <bdi>${meta.out}/M</bdi></> : <span className="italic">قیمت نامشخص</span>}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button disabled={disabled || idx === 0} onClick={() => move(idx, -1)} className={iconBtnCls} aria-label="انتقال به بالا">
                ▲
              </button>
              <button disabled={disabled || idx === value.length - 1} onClick={() => move(idx, 1)} className={iconBtnCls} aria-label="انتقال به پایین">
                ▼
              </button>
              <button disabled={disabled} onClick={() => remove(idx)} className={`${iconBtnCls} text-red-400`} aria-label="حذف">
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <div className="grid gap-2 sm:grid-cols-2 mt-1">
        <select
          disabled={disabled}
          defaultValue=""
          aria-label="افزودن مدل شناخته‌شده"
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            add(v);
          }}
          className="w-full min-h-11 text-sm px-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <option value="" disabled>
            + افزودن یک مدل شناخته‌شده…
          </option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — ورودی ${m.in}/M، خروجی ${m.out}/M
            </option>
          ))}
        </select>
        <input
          type="text"
          dir="auto"
          disabled={disabled}
          placeholder="…یا هر id از OpenRouter رو بچسبون"
          aria-label="id مدل OpenRouter"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = e.currentTarget.value.trim();
              if (t) {
                add(t);
                e.currentTarget.value = "";
              }
            }
          }}
          className="w-full min-h-11 text-sm px-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]"
        />
      </div>
      <div>
        <button type="button" disabled={disabled || value.length < 2} onClick={sortByCost} className={btnCls}>
          💵 مرتب‌سازی از ارزان‌ترین
        </button>
      </div>
      {value.some((id) => !knownIds.has(id)) && (
        <p className="text-xs leading-6 text-[var(--color-text-dim)]">
          مدل‌هایی که قیمت داخلی ندارن، در پیش‌بینی هزینه به حساب نمیان.
        </p>
      )}
    </div>
  );
}

function HeadersEditor({
  value,
  onChange,
  disabled,
}: {
  value: HeaderPair[];
  onChange: (pairs: HeaderPair[]) => void;
  disabled: boolean;
}) {
  function update(idx: number, patch: Partial<HeaderPair>) {
    onChange(value.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, { key: "", value: "" }]);
  }
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] py-5 text-sm text-[var(--color-text-dim)]">
          هدر اضافه‌ای نیست.
        </p>
      )}
      {value.map((p, idx) => (
        <div key={idx} className="rounded-xl bg-[var(--color-surface-2)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              dir="ltr"
              disabled={disabled}
              value={p.key}
              placeholder="نام هدر (مثلاً X-Auth)"
              aria-label="نام هدر"
              onChange={(e) => update(idx, { key: e.target.value })}
              className={miniInputCls}
            />
            <input
              type="text"
              dir="auto"
              disabled={disabled}
              value={p.value}
              placeholder="مقدار"
              aria-label="مقدار هدر"
              onChange={(e) => update(idx, { value: e.target.value })}
              className={miniInputCls}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={disabled} onClick={() => remove(idx)} className={`${iconBtnCls} text-red-400`} aria-label="حذف">
              ✕
            </button>
          </div>
        </div>
      ))}
      <div>
        <button disabled={disabled} onClick={add} className={`${btnCls} border-dashed`}>
          + افزودن هدر
        </button>
      </div>
    </div>
  );
}

function InviteLinkPanel({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const r = await fetch("/api/secretaries/invite", { method: "POST" });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok) throw new Error(j.error ?? `ناموفق (${r.status})`);
      setUrl(j.url ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("کپی ناموفق بود؛ لینک رو دستی انتخاب کن.");
    }
  }

  return (
    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
        لینک دعوت ۷ روز معتبره و یک‌بارمصرفه. توی تلگرام به اشتراک بذار تا یه منشی جدید اضافه بشه.
      </p>
      <div>
        <button
          type="button"
          onClick={generate}
          disabled={disabled || pending}
          className="min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "در حال ساخت…" : "🔗 ساخت لینک دعوت"}
        </button>
      </div>
      {url && (
        <div className="mt-3 rounded-xl bg-[var(--color-surface-2)] p-3">
          <input
            readOnly
            dir="ltr"
            value={url}
            aria-label="لینک دعوت"
            onFocus={(e) => e.currentTarget.select()}
            className={miniInputCls}
          />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={copy} className={btnCls}>
              {copied ? "کپی شد ✓" : "کپی"}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={`${btnCls} inline-flex items-center`}>
              باز کردن
            </a>
          </div>
        </div>
      )}
      {error && <p className="text-xs leading-6 text-red-400 mt-2">{error}</p>}
    </div>
  );
}
