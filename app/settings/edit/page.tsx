"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import OwnerPhotoUploader from "@/components/OwnerPhotoUploader";

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
};

type FieldConfig = {
  key: keyof Settings;
  label: string;
  hint?: string;
  type?: "text" | "textarea" | "number" | "toggle";
};

const SECTIONS: Array<{ title: string; fields: FieldConfig[] }> = [
  {
    title: "پروفایل صاحب",
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
    title: "تشخیص فوری",
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
    title: "مهلت گفتگوی فعال",
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
    title: "webhook دستگاه هشدار",
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
  },
  {
    title: "پاسخ خودکار (فقط DMهای فوری)",
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
    title: "تحلیل‌گر گروه",
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
    title: "منشی",
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
    title: "یادآوری‌ها و تقویم (استخراج AI)",
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
    title: "پیش‌فرض چت‌های جدید",
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
    title: "پیامک سایلنت (مانیتورینگ)",
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

export default function SettingsPage() {
  const [values, setValues] = useState<Settings | null>(null);
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
    const r = await fetch(`/api/settings${tenantQuery}`);
    if (!r.ok) return;
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
    setEnvLocked(new Set(j.envLocked));
  }, []);

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
      setMsg("ذخیره شد.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Approx OpenRouter input price ($/1M tokens) for the cost-sort button.
  const MODEL_RATES_IN: Record<string, number> = {
    "google/gemini-2.5-flash-lite": 0.1,
    "google/gemini-2.5-flash": 0.3,
    "google/gemini-2.5-pro": 1.25,
    "anthropic/claude-haiku-4-5": 1.0,
    "anthropic/claude-sonnet-4-6": 3.0,
    "openai/gpt-4o-mini": 0.15,
  };
  function sortModelsCheapestFirst() {
    if (!values) return;
    const list = (values.aiModelsCsv || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (list.length === 0) {
      const ranked = Object.entries(MODEL_RATES_IN)
        .sort((a, b) => a[1] - b[1])
        .map(([m]) => m);
      update("aiModelsCsv", ranked.join(", "));
      return;
    }
    list.sort(
      (a, b) =>
        (MODEL_RATES_IN[a] ?? Infinity) - (MODEL_RATES_IN[b] ?? Infinity),
    );
    update("aiModelsCsv", list.join(", "));
  }

  if (!values) {
    return (
      <Shell>
        <PageTitle title="تنظیمات" />
        <Card>در حال بارگذاری…</Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {tenantId && (
        <div className="mb-3 p-3 rounded-lg border border-amber-700 bg-amber-900/20">
          <div className="text-sm font-medium text-amber-200">
            🏢 در حال ویرایش tenant: {tenantName ?? `#${tenantId}`}
          </div>
          <div className="text-[11px] text-amber-300/80 mt-1">
            تغییرات روی این tenant ذخیره می‌شن — مقادیر خالی fallback به global.
            برای ویرایش global،{" "}
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
        actions={
          <button
            disabled={saving}
            onClick={save}
            className="text-xs px-4 py-2 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "در حال ذخیره…" : "ذخیره‌ی تغییرات"}
          </button>
        }
      />

      <div className="mb-4 text-[11px]">
        <Link
          href="/settings"
          className="text-[var(--color-text-dim)] hover:text-white underline-offset-2 hover:underline"
        >
          ← برگشت به Settings
        </Link>
      </div>

      {msg && (
        <Card className="mb-6">
          <p className="text-sm">{msg}</p>
        </Card>
      )}

      <div className="flex flex-col gap-4 md:gap-6">
        {/* Owner reference photo — uploads a file instead of needing a URL. */}
        <OwnerPhotoUploader />
        {/* Custom rich editor: Secretaries */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">منشی‌ها</h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            اولین نفر توی لیست، فوروارد‌های خودکار رو انجام می‌ده. هر کسی رو با
            یه user id عددی تلگرام می‌تونی اضافه یا حذف کنی (باید یه بار بات رو
            /start کنه تا بتونه بهش DM بده). یا لینک دعوت زیر رو براشون بفرست تا
            وقتی روش زدن، خودکار اضافه بشن.
            {envLocked.has("secretariesJson") && (
              <span className="ml-2 italic">(قفل‌شده با env)</span>
            )}
          </p>
          <SecretariesEditor
            value={parseSecretaries(values.secretariesJson)}
            disabled={envLocked.has("secretariesJson")}
            onChange={(list) =>
              update("secretariesJson", JSON.stringify(list))
            }
          />
          <InviteLinkPanel disabled={envLocked.has("secretariesJson")} />
        </Card>

        {/* Custom rich editor: AI Models — general (classify / summaries) */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            مدل‌های AI — دسته‌بندی و خلاصه‌ها
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            برای تشخیص فوری، خلاصه‌ی گروه‌ها و متادیتای رونویسی استفاده می‌شه. به
            ترتیب امتحان می‌شن؛ در صورت خطا به بعدی برمی‌گرده.
            {envLocked.has("aiModelsCsv") && (
              <span className="ml-2 italic">(قفل‌شده با env)</span>
            )}
          </p>
          <ModelsEditor
            value={(values.aiModelsCsv || "")
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)}
            disabled={envLocked.has("aiModelsCsv")}
            onChange={(list) => update("aiModelsCsv", list.join(", "))}
          />
        </Card>

        {/* Custom rich editor: AI Models — chat (ai_chat / friendly_reply) */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            مدل‌های AI — چت و پاسخ دوستانه
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            لیست جداگانه‌ای که فقط وقتی یه چت توی حالت <strong>AI chat</strong>{" "}
            یا <strong>پاسخ خودکار دوستانه</strong> باشه استفاده می‌شه. مدل‌های
            باهوش‌تر رو اینجا بذار (Claude Sonnet, GPT-4o, …) — فقط وقتی یه گفتگوی
            واقعی در جریانه اجرا می‌شن. خالی بذار تا از همون لیست دسته‌بندی استفاده بشه.
            {envLocked.has("aiChatModelsCsv") && (
              <span className="ml-2 italic">(قفل‌شده با env)</span>
            )}
          </p>
          <ModelsEditor
            value={(values.aiChatModelsCsv || "")
              .split(",")
              .map((m) => m.trim())
              .filter(Boolean)}
            disabled={envLocked.has("aiChatModelsCsv")}
            onChange={(list) => update("aiChatModelsCsv", list.join(", "))}
          />
        </Card>

        {/* Custom rich editor: Alert webhook headers */}
        <Card>
          <h2 className="text-sm font-semibold mb-1">
            هدرهای webhook هشدار
          </h2>
          <p className="text-xs text-[var(--color-text-dim)] mb-4">
            هدرهای HTTP اضافه‌ای که با هر فراخوانی webhook هشدار فرستاده می‌شن.
            {envLocked.has("alertWebhookHeaders") && (
              <span className="ml-2 italic">(قفل‌شده با env)</span>
            )}
          </p>
          <HeadersEditor
            value={parseHeaders(values.alertWebhookHeaders)}
            disabled={envLocked.has("alertWebhookHeaders")}
            onChange={(pairs) =>
              update(
                "alertWebhookHeaders",
                JSON.stringify(
                  Object.fromEntries(
                    pairs
                      .filter((p) => p.key)
                      .map((p) => [p.key, p.value]),
                  ),
                ),
              )
            }
          />
        </Card>

        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <h2 className="text-sm font-semibold mb-1">{section.title}</h2>
            <div className="mt-4 flex flex-col gap-4">
              {section.fields.map((f) => {
                const locked = envLocked.has(f.key);
                const val = values[f.key];
                const lockedSuffix = locked ? " (قفل‌شده با env)" : "";
                if (f.type === "toggle") {
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={val.toLowerCase() !== "false" && val !== ""}
                        onChange={(e) =>
                          update(f.key, e.target.checked ? "true" : "false")
                        }
                      />
                      <span>
                        {f.label}
                        <span className="text-[var(--color-text-dim)] text-xs">
                          {lockedSuffix}
                        </span>
                      </span>
                    </label>
                  );
                }
                return (
                  <div key={f.key}>
                    <label className="block text-xs text-[var(--color-text-dim)] mb-1">
                      {f.label}
                      {lockedSuffix && (
                        <span className="ml-1 italic">{lockedSuffix}</span>
                      )}
                    </label>
                    {f.type === "textarea" ? (
                      <textarea
                        rows={3}
                        disabled={locked}
                        value={val}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm disabled:opacity-60"
                      />
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        disabled={locked}
                        value={val}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm disabled:opacity-60"
                      />
                    )}
                    {f.hint && (
                      <p className="text-xs text-[var(--color-text-dim)] mt-1">
                        {f.hint}
                      </p>
                    )}
                    {f.key === "aiModelsCsv" && (
                      <button
                        type="button"
                        onClick={sortModelsCheapestFirst}
                        disabled={locked}
                        className="mt-2 text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                      >
                        💵 مرتب‌سازی از ارزان‌ترین
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Shell>
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
        <p className="text-xs text-[var(--color-text-dim)]">
          هنوز منشی‌ای نیست.
        </p>
      )}
      {value.map((s, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] w-6 shrink-0 text-center">
            {idx === 0 ? "★" : idx + 1}
          </div>
          <input
            type="text"
            disabled={disabled}
            value={s.name}
            placeholder="نام"
            onChange={(e) => update(idx, { name: e.target.value })}
            className="flex-1 min-w-0 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <input
            type="number"
            disabled={disabled}
            value={s.userId || ""}
            placeholder="user id"
            onChange={(e) => update(idx, { userId: Number(e.target.value) || 0 })}
            className="w-32 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <div className="flex gap-0.5 shrink-0">
            <button
              disabled={disabled || idx === 0}
              onClick={() => move(idx, -1)}
              className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              aria-label="انتقال به بالا"
            >
              ▲
            </button>
            <button
              disabled={disabled || idx === value.length - 1}
              onClick={() => move(idx, 1)}
              className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              aria-label="انتقال به پایین"
            >
              ▼
            </button>
            <button
              disabled={disabled}
              onClick={() => remove(idx)}
              className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
              aria-label="حذف"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <button
        disabled={disabled}
        onClick={add}
        className="text-xs px-3 py-2 rounded-md border border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 self-start"
      >
        + افزودن منشی
      </button>
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
        <p className="text-xs text-[var(--color-text-dim)]">
          فقط از OPENROUTER_MODEL پیش‌فرض استفاده می‌شه.
        </p>
      )}
      {value.map((id, idx) => {
        const meta = KNOWN_MODELS.find((m) => m.id === id);
        return (
          <div
            key={`${id}-${idx}`}
            className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] w-6 shrink-0 text-center">
              {idx === 0 ? "★" : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{meta?.label ?? id}</div>
              <div className="text-[10px] text-[var(--color-text-dim)] truncate">
                {id}
                {meta && (
                  <span className="ml-2">
                    ورودی ${meta.in}/M · خروجی ${meta.out}/M
                  </span>
                )}
                {!meta && <span className="ml-2 italic">قیمت نامشخص</span>}
              </div>
            </div>
            <div className="flex gap-0.5 shrink-0">
              <button
                disabled={disabled || idx === 0}
                onClick={() => move(idx, -1)}
                className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              >
                ▲
              </button>
              <button
                disabled={disabled || idx === value.length - 1}
                onClick={() => move(idx, 1)}
                className="text-xs px-1.5 py-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
              >
                ▼
              </button>
              <button
                disabled={disabled}
                onClick={() => remove(idx)}
                className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 items-center mt-1">
        <select
          disabled={disabled}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = "";
            add(v);
          }}
          className="text-xs px-2 py-1.5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]"
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
          disabled={disabled}
          placeholder="…یا هر id از OpenRouter رو بچسبون"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const t = e.currentTarget.value.trim();
              if (t) {
                add(t);
                e.currentTarget.value = "";
              }
            }
          }}
          className="text-xs px-2 py-1.5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] flex-1 min-w-[160px]"
        />
        <button
          type="button"
          disabled={disabled || value.length < 2}
          onClick={sortByCost}
          className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          💵 مرتب‌سازی از ارزان‌ترین
        </button>
      </div>
      {value.some((id) => !knownIds.has(id)) && (
        <p className="text-[11px] text-[var(--color-text-dim)] mt-1">
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
        <p className="text-xs text-[var(--color-text-dim)]">
          هدر اضافه‌ای نیست.
        </p>
      )}
      {value.map((p, idx) => (
        <div
          key={idx}
          className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2"
        >
          <input
            type="text"
            disabled={disabled}
            value={p.key}
            placeholder="نام هدر (مثلاً X-Auth)"
            onChange={(e) => update(idx, { key: e.target.value })}
            className="w-40 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <input
            type="text"
            disabled={disabled}
            value={p.value}
            placeholder="مقدار"
            onChange={(e) => update(idx, { value: e.target.value })}
            className="flex-1 min-w-0 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-sm"
          />
          <button
            disabled={disabled}
            onClick={() => remove(idx)}
            className="text-xs px-2 py-1 rounded text-red-400 hover:bg-red-900/30 disabled:opacity-30"
            aria-label="حذف"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        disabled={disabled}
        onClick={add}
        className="text-xs px-3 py-2 rounded-md border border-dashed border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50 self-start"
      >
        + افزودن هدر
      </button>
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
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <button
          type="button"
          onClick={generate}
          disabled={disabled || pending}
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "در حال ساخت…" : "🔗 ساخت لینک دعوت"}
        </button>
        <span className="text-[11px] text-[var(--color-text-dim)]">
          ۷ روز معتبره و یک‌بارمصرفه. توی تلگرام به اشتراک بذار تا یه منشی جدید
          اضافه بشه.
        </span>
      </div>
      {url && (
        <div className="flex items-center gap-2 bg-[var(--color-surface-2)] rounded-md p-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 bg-transparent text-xs"
          />
          <button
            type="button"
            onClick={copy}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
          >
            {copied ? "کپی شد ✓" : "کپی"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface)]"
          >
            باز کردن
          </a>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}
    </div>
  );
}
