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
    label: "Settings",
    desc: "همه‌ی تنظیمات (owner، AI models، auto-reply، grace، debug، حداقل importance، ...)",
  },
  {
    href: "/rules",
    emoji: "📐",
    label: "Rules",
    desc: "قانون‌های تشخیص پیام (مثلاً OTP) + فوروارد خودکار با format دلخواه",
  },
  {
    href: "/webhooks",
    emoji: "📡",
    label: "Webhooks",
    desc: "ورودی‌های مستقل SMS — هر کدوم اسم و URL خودش رو داره (برای SMS-Forwarder اندروید)",
  },
  {
    href: "/sms-block-rules",
    emoji: "🚫",
    label: "SMS Blocks",
    desc: "نمونه‌هایی از SMS که نمی‌خوای ببینی (تبلیغ ملک، آرایشی، حراج، ...). AI پیام‌های شبیه به این‌ها رو فیلتر می‌کنه.",
  },
  {
    href: "/secretary-relays",
    emoji: "🧑‍💼",
    label: "Secretary Routes",
    desc: "هر Route یه لیست فرستنده + گیرنده داره؛ پیام DM به چند تا منشی فوروارد می‌شه و جواب اون‌ها مستقیم برمی‌گرده.",
  },
  {
    href: "/note-watchlist",
    emoji: "🕵️",
    label: "Note Watchlist",
    desc: "مفاهیم global برای همه‌ی چت‌ها (با aliases) — جدا از auto_extract_notes هر چت. اگه پیامی به مفهومی اشاره کنه، توی Notes + کانال notes_inbox ثبت می‌شه.",
  },
  {
    href: "/follow-up",
    emoji: "⏰",
    label: "Follow-up",
    desc: "چت‌هایی که جوابشون رو ندادی — با فیلتر بر اساس وضعیت، جستجو، و دکمه اجرای فوری cron.",
  },
  {
    href: "/chat-profiles",
    emoji: "👤",
    label: "Chat Profiles",
    desc: "قالب‌های تنظیمات follow-up (کاری / دوستانه / صمیمی / پاسخ سریع / ...). هر چت رو می‌تونی به یه پروفایل assign کنی.",
  },
  {
    href: "/debug-log",
    emoji: "🪵",
    label: "Debug Log",
    desc: "هر Update که Telegram به webhook فرستاده — با تایم، چت، نوع، payload کامل. مخصوصاً MessageReactionUpdated برای دیباگ ری‌اکشن.",
  },
  {
    href: "/ask",
    emoji: "🔎",
    label: "Ask",
    desc: "سوال طبیعی از همه‌ی پیام‌ها (مثلاً «ساعت کاری بچه‌ها رو بگو»)",
  },
  {
    href: "/monitored",
    emoji: "📸",
    label: "IG Monitor",
    desc: "اکانت‌های اینستاگرام که هر ۵ دقیقه چک می‌شن برای استوری جدید",
  },
  {
    href: "/groups",
    emoji: "📊",
    label: "Groups",
    desc: "خلاصه‌های روزانه‌ی گروه‌ها",
  },
  {
    href: "/functions",
    emoji: "🧩",
    label: "Functions",
    desc: "نقش هر چت (downloader, news, voice/video/photo storage, ...)",
  },
  {
    href: "/knowledge",
    emoji: "📘",
    label: "Knowledge",
    desc: "اصطلاحات و توضیحاتی که به AI تزریق می‌شه",
  },
  {
    href: "/notes",
    emoji: "📒",
    label: "Notes",
    desc: "تب «یادداشت‌ها» (استخراج‌شده از هر چت) + تب «مفاهیم» (global Watchlist) + تب «تنظیمات» پیشرفته (cooldown / digest / archive).",
  },
  {
    href: "/media-routing",
    emoji: "🛰",
    label: "Media routing",
    desc: "debug: چرا یه voice/video/photo توی کانال هدف کپی نشد",
  },
  {
    href: "/costs",
    emoji: "💵",
    label: "Costs",
    desc: "هزینه‌ی AI و توکن‌ها",
  },
  {
    href: "/audit",
    emoji: "🪵",
    label: "System Log",
    desc: "خطاهای سیستم + لاگ تغییرات audit. هر خطا دکمه کپی داره با stack trace کامل.",
  },
  {
    href: "/health",
    emoji: "🩺",
    label: "Health",
    desc: "وضعیت webhook، business connections، DB",
  },
];

// Admin-only tile — appended at the end of TILES when /api/admin/me
// confirms the current user is in admin_users. Mobile has no sidebar,
// so without this the operator can't reach /admin from the phone.
const ADMIN_TILE: (typeof TILES)[number] = {
  href: "/admin",
  emoji: "🛡",
  label: "Admin",
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
        title="Settings"
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
