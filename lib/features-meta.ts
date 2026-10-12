// Client-safe list of dashboard features (labels and links only). How each one is measured lives server-side
// in lib/feature-usage.ts.
export type FeatureGroup = "daily" | "ai" | "channels" | "monitor" | "system";
export type FeatureMeta = { id: string; group: FeatureGroup; emoji: string; label: string; href: string; desc: string; unit: string };

export const FEATURE_GROUPS: Array<{ id: FeatureGroup; label: string; hint: string }> = [
  { id: "daily", label: "روزمره", hint: "چیزهایی که هر روز سراغشان می‌روی" },
  { id: "ai", label: "هوش و قانون‌ها", hint: "قانون، دیده‌بان، پروفایل و دانش" },
  { id: "channels", label: "پیامک، ایمیل و کد", hint: "ورودی‌ها و رله‌ها" },
  { id: "monitor", label: "مانیتور و دانلود", hint: "اینستاگرام، سایت، لینک، گروه" },
  { id: "system", label: "سیستم", hint: "تنظیمات، هزینه، لاگ، سلامت" },
];

export const FEATURES: FeatureMeta[] = [
  { id: "music", group: "daily", emoji: "🎧", label: "پلیر موسیقی", href: "/music", desc: "کتابخانه، پلی‌لیست، لینک پلیر، خواننده‌ها", unit: "آهنگ" },
  { id: "messages", group: "daily", emoji: "💬", label: "پیام‌ها", href: "/messages", desc: "پیام‌های تحلیل‌شده", unit: "پیام" },
  { id: "urgent", group: "daily", emoji: "🚨", label: "فوری", href: "/urgent", desc: "پیام‌های مهم و فوری", unit: "فوری" },
  { id: "chats", group: "daily", emoji: "👥", label: "چت‌ها", href: "/chats", desc: "تنظیم هر چت (VIP، بی‌صدا، پاسخ خودکار…)", unit: "چت" },
  { id: "reminders", group: "daily", emoji: "⏰", label: "کارها و یادآورها", href: "/reminders", desc: "کارهایی که از گفتگوها بیرون کشیده می‌شود", unit: "مورد" },
  { id: "notes", group: "daily", emoji: "📝", label: "یادداشت‌ها", href: "/notes", desc: "یادداشت‌های چت", unit: "یادداشت" },
  { id: "otp", group: "daily", emoji: "🔑", label: "کدهای یک‌بارمصرف", href: "/otp", desc: "تابلوی کدهای پیامکی + اپ مک", unit: "پیامک" },
  { id: "rules", group: "ai", emoji: "📐", label: "قوانین", href: "/rules", desc: "تشخیص پیام + فوروارد خودکار", unit: "تطبیق" },
  { id: "note-watch", group: "ai", emoji: "🔎", label: "دیده‌بان یادداشت", href: "/note-watchlist", desc: "مفاهیمی که باید در پیام‌ها دیده شوند", unit: "تطبیق" },
  { id: "profiles", group: "ai", emoji: "🎭", label: "پروفایل چت", href: "/chat-profiles", desc: "قالب رفتار برای دسته‌ای از چت‌ها", unit: "پروفایل" },
  { id: "functions", group: "ai", emoji: "🧩", label: "نقش چت‌ها", href: "/functions", desc: "کانال ورودی/آرشیو و دسته‌بندی", unit: "نقش" },
  { id: "knowledge", group: "ai", emoji: "📚", label: "دانش", href: "/knowledge", desc: "اطلاعاتی که AI برای پاسخ‌ها می‌داند", unit: "مورد" },
  { id: "ask", group: "ai", emoji: "🧠", label: "پرسش از گفتگوها", href: "/ask", desc: "سؤال آزاد از تاریخچهٔ پیام‌ها", unit: "پرسش" },
  { id: "follow-up", group: "ai", emoji: "🔔", label: "پیگیری", href: "/follow-up", desc: "یادآور پیام‌های بی‌جواب", unit: "پروفایل فعال" },
  { id: "sms-hook", group: "channels", emoji: "📲", label: "وب‌هوک پیامک", href: "/webhooks", desc: "دریافت پیامک از گوشی", unit: "وب‌هوک" },
  { id: "sms-block", group: "channels", emoji: "🚫", label: "بلاک پیامک", href: "/sms-block-rules", desc: "نمونه‌هایی که نباید فوروارد شوند", unit: "نمونه" },
  { id: "code-feeds", group: "channels", emoji: "🔗", label: "فید کد", href: "/code-feeds", desc: "آدرس‌های توکن‌دار برای کدهای پیامکی", unit: "فید" },
  { id: "emails", group: "channels", emoji: "✉️", label: "ایمیل", href: "/emails", desc: "حساب‌های Resend و ایمیل‌های دریافتی", unit: "ایمیل" },
  { id: "relays", group: "channels", emoji: "🔁", label: "رله منشی", href: "/secretary-relays", desc: "ارتباط منشی‌ها با چت‌ها", unit: "پیام" },
  { id: "monitored", group: "monitor", emoji: "📸", label: "مانیتور اینستاگرام", href: "/monitored", desc: "استوری و پست حساب‌ها", unit: "رویداد" },
  { id: "site-monitors", group: "monitor", emoji: "🌐", label: "مانیتور سایت", href: "/site-monitors", desc: "ورود و بررسی دوره‌ای سایت‌ها", unit: "سایت" },
  { id: "link-dl", group: "monitor", emoji: "⬇️", label: "دانلودر لینک", href: "/link-downloaders", desc: "ربات‌های دانلود برای لینک‌ها", unit: "دانلود" },
  { id: "media-routing", group: "monitor", emoji: "🛰", label: "مسیریابی مدیا", href: "/media-routing", desc: "کپی ویس/ویدیو/عکس به کانال هدف", unit: "مورد" },
  { id: "groups", group: "monitor", emoji: "🏘", label: "گروه‌ها", href: "/groups", desc: "تحلیل و برد تسک گروه‌ها", unit: "تحلیل" },
  { id: "group-summaries", group: "monitor", emoji: "🗒", label: "خلاصهٔ گروه‌ها", href: "/groups/summaries", desc: "خلاصهٔ دوره‌ای گفتگوهای گروه", unit: "خلاصه" },
  { id: "settings", group: "system", emoji: "⚙️", label: "تنظیمات", href: "/settings/edit", desc: "مالک، مدل‌های AI، پاسخ خودکار…", unit: "تنظیم" },
  { id: "roadmap", group: "system", emoji: "📈", label: "نقشهٔ راه و بهره‌وری", href: "/roadmap", desc: "دستور کار و شاخص‌های روزانه", unit: "آیتم" },
  { id: "costs", group: "system", emoji: "💵", label: "هزینه‌ها", href: "/costs", desc: "هزینهٔ AI و توکن", unit: "فراخوانی" },
  { id: "audit", group: "system", emoji: "🪵", label: "لاگ سیستم", href: "/audit", desc: "خطاها و لاگ تغییرات", unit: "خطا" },
  { id: "health", group: "system", emoji: "🩺", label: "سلامت", href: "/health", desc: "وب‌هوک، اتصال‌ها، دیتابیس", unit: "اتصال" },
  { id: "debug-log", group: "system", emoji: "🐞", label: "لاگ دیباگ", href: "/debug-log", desc: "آپدیت‌های خام تلگرام", unit: "آپدیت" },
];

export type FeatureState = "active" | "quiet" | "dormant" | "empty" | "configured";
export type FeatureUsage = { id: string; total: number; n7: number; n30: number; last: string | null; state: FeatureState; extra?: string; error?: string };
