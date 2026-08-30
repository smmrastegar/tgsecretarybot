"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageTitle } from "@/components/Card";
import DebugModeToggle from "@/components/DebugModeToggle";

// Tiles overview. The actual settings form (owner info, AI models,
// auto-reply, all the toggles, etc.) lives at /settings/edit so this
// page stays a quick directory. Each tile is one tool.

const TILES: Array<{
  href: string;
  emoji: string;
  label: string;
  desc: string;
}> = [
  {
    href: "/settings/edit",
    emoji: "⚙️",
    label: "تنظیمات",
    desc: "همه‌ی تنظیمات (owner، AI models، auto-reply، grace، debug، حداقل importance، ...)",
  },
  {
    href: "/rules",
    emoji: "📐",
    label: "قوانین",
    desc: "قانون‌های تشخیص پیام (مثلاً OTP) + فوروارد خودکار با format دلخواه",
  },
  {
    href: "/webhooks",
    emoji: "📡",
    label: "وب‌هوک‌ها",
    desc: "ورودی‌های مستقل SMS — هر کدوم اسم و URL خودش رو داره (برای SMS-Forwarder اندروید)",
  },
  {
    href: "/sms-block-rules",
    emoji: "🚫",
    label: "بلاک پیامک",
    desc: "نمونه‌هایی از SMS که نمی‌خوای ببینی (تبلیغ ملک، آرایشی، حراج، ...). AI پیام‌های شبیه به این‌ها رو فیلتر می‌کنه.",
  },
  {
    href: "/secretary-relays",
    emoji: "🧑‍💼",
    label: "مسیرهای منشی",
    desc: "هر Route یه لیست فرستنده + گیرنده داره؛ پیام DM به چند تا منشی فوروارد می‌شه و جواب اون‌ها مستقیم برمی‌گرده.",
  },
  {
    href: "/note-watchlist",
    emoji: "🕵️",
    label: "دیده‌بان یادداشت",
    desc: "مفاهیم global برای همه‌ی چت‌ها (با aliases) — جدا از auto_extract_notes هر چت. اگه پیامی به مفهومی اشاره کنه، توی Notes + کانال notes_inbox ثبت می‌شه.",
  },
  {
    href: "/follow-up",
    emoji: "⏰",
    label: "پیگیری",
    desc: "چت‌هایی که جوابشون رو ندادی — با فیلتر بر اساس وضعیت، جستجو، و دکمه اجرای فوری cron.",
  },
  {
    href: "/chat-profiles",
    emoji: "👤",
    label: "پروفایل چت‌ها",
    desc: "قالب‌های تنظیمات follow-up (کاری / دوستانه / صمیمی / پاسخ سریع / ...). هر چت رو می‌تونی به یه پروفایل assign کنی.",
  },
  {
    href: "/debug-log",
    emoji: "🪵",
    label: "لاگ دیباگ",
    desc: "هر Update که Telegram به webhook فرستاده — با تایم، چت، نوع، payload کامل. مخصوصاً MessageReactionUpdated برای دیباگ ری‌اکشن.",
  },
  {
    href: "/ask",
    emoji: "🔎",
    label: "پرسش",
    desc: "سوال طبیعی از همه‌ی پیام‌ها (مثلاً «ساعت کاری بچه‌ها رو بگو»)",
  },
  {
    href: "/monitored",
    emoji: "📸",
    label: "پایش اینستاگرام",
    desc: "اکانت‌های اینستاگرام که هر ۵ دقیقه چک می‌شن برای استوری جدید",
  },
  {
    href: "/site-monitors",
    emoji: "🌐",
    label: "پایش سایت",
    desc: "سایت‌های با لاگین (آدرس + یوزر/پسورد) که سر ساعت‌های مشخص به‌وقت تهران چک می‌شن؛ اگه نتیجه‌ای بود با تحلیل AI توی Note Inbox می‌آد.",
  },
  {
    href: "/code-feeds",
    emoji: "🔑",
    label: "فیدِ کدها (URL توکن‌دار)",
    desc: "آدرس توکن‌دار که فقط پیام‌های کددارِ یک کانال را در بازه‌ی اخیر (پیش‌فرض ۵ دقیقه) برمی‌گرداند. کانال، طول بازه، فرمت و IPهای مجاز از همین‌جا تنظیم می‌شود؛ خودِ آدرس کامل هم همان‌جا نمایش داده می‌شود.",
  },
  {
    href: "/link-downloaders",
    emoji: "⬇️",
    label: "دانلودِ لینک",
    desc: "لینک‌های اینستاگرام و اسپاتیفای که در چت‌های خصوصی می‌آیند به بات دانلودر فرستاده و نتیجه برگردانده می‌شود. دامنه‌ها و بات مقصدِ هرکدام از همین‌جا تنظیم می‌شود.",
  },
  {
    href: "/emails",
    emoji: "📧",
    label: "ایمیل (Resend)",
    desc: "دریافت/ارسال ایمیل با Resend. ایمیل ورودی توی کانال ایمیل با دکمه‌های Preview/Summary/Text/HTML میاد؛ ریپلای و ساخت ایمیل جدید هم از همینجا.",
  },
  {
    href: "/groups",
    emoji: "👥",
    label: "گروه‌ها",
    desc: "هر گروهی که بات در آن عضو است: لینکِ اشتراک‌گذاری عمومی، فرکانسِ خلاصه‌سازی، خلاصه‌گیریِ دستی، و تحلیلِ کارها و تاپیک‌های هر گروه.",
  },
  {
    href: "/groups/summaries",
    emoji: "📝",
    label: "خلاصه‌های روزانه",
    desc: "فیدِ خلاصه‌های AI همه‌ی گروه‌ها با فیلترِ بازه و جستجو در متن.",
  },
  {
    href: "/functions",
    emoji: "🧩",
    label: "نقش‌ها",
    desc: "نقش هر چت (downloader, news, voice/video/photo storage, ...)",
  },
  {
    href: "/knowledge",
    emoji: "📘",
    label: "دانش‌نامه",
    desc: "اصطلاحات و توضیحاتی که به AI تزریق می‌شه",
  },
  {
    href: "/notes",
    emoji: "📒",
    label: "یادداشت‌ها",
    desc: "تب «یادداشت‌ها» (استخراج‌شده از هر چت) + تب «مفاهیم» (global Watchlist) + تب «تنظیمات» پیشرفته (cooldown / digest / archive).",
  },
  {
    href: "/media-routing",
    emoji: "🛰",
    label: "مسیریابی مدیا",
    desc: "debug: چرا یه voice/video/photo توی کانال هدف کپی نشد",
  },
  {
    href: "/costs",
    emoji: "💵",
    label: "هزینه‌ها",
    desc: "هزینه‌ی AI و توکن‌ها",
  },
  {
    href: "/audit",
    emoji: "🪵",
    label: "لاگ سیستم",
    desc: "خطاهای سیستم + لاگ تغییرات audit. هر خطا دکمه کپی داره با stack trace کامل.",
  },
  {
    href: "/health",
    emoji: "🩺",
    label: "سلامت",
    desc: "وضعیت webhook، business connections، DB",
  },
];

// Admin-only tile — appended at the end of TILES when /api/admin/me
// confirms the current user is in admin_users. Mobile has no sidebar,
// so without this the operator can't reach /admin from the phone.
const ADMIN_TILE: (typeof TILES)[number] = {
  href: "/admin",
  emoji: "🛡",
  label: "مدیریت",
  desc: "tenants، کاربران ادمین، کلیدهای API، impersonation",
};

export default function SettingsTilesPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { admin?: boolean } | null) => {
        if (!cancelled) setIsAdmin(!!d?.admin);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = isAdmin ? [...TILES, ADMIN_TILE] : TILES;
  return (
    <Shell>
      <PageTitle
        title="تنظیمات"
        subtitle="ابزارها و پنل‌های مدیریتی. روی هر کارت کلیک کن تا وارد بشی."
      />

      <DebugModeToggle />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex flex-col items-start gap-1 p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]"
          >
            <span className="text-lg">{t.emoji}</span>
            <span className="text-sm font-medium">{t.label}</span>
            <span className="text-[10px] text-[var(--color-text-dim)] leading-relaxed">
              {t.desc}
            </span>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
