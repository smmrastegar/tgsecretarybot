"use client";

import Link from "next/link";
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
    desc: "آدرس‌ها، لوکیشن‌ها، شماره‌ها و نکات مهم استخراج‌شده از هر چت",
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
    emoji: "🕐",
    label: "Audit",
    desc: "لاگ تغییرات",
  },
  {
    href: "/health",
    emoji: "🩺",
    label: "Health",
    desc: "وضعیت webhook، business connections، DB",
  },
];

export default function SettingsTilesPage() {
  return (
    <Shell>
      <PageTitle
        title="Settings"
        subtitle="ابزارها و پنل‌های مدیریتی. روی هر کارت کلیک کن تا وارد بشی."
      />

      <DebugModeToggle />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {TILES.map((t) => (
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
