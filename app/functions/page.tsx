"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { chatTypeLabel } from "@/lib/format";

type FunctionRole =
  | "downloader"
  | "sms_inbox"
  | "download_archive"
  | "news"
  | "summary_inbox";

const ROLE_INFO: Record<
  FunctionRole,
  { title: string; description: string; emoji: string }
> = {
  downloader: {
    title: "Downloader bots",
    emoji: "📥",
    description:
      "بات‌هایی که لینک اینستاگرام / یوتیوب / توییتر / ساندکلاد / اسپاتیفای می‌گیرن و فایل دانلود شده برمی‌گردونن. وقتی بعداً «route to downloader» اضافه بشه، درخواست دانلود به یکی از این بات‌ها فوروارد می‌شه.",
  },
  sms_inbox: {
    title: "SMS inbox channels",
    emoji: "📱",
    description:
      "کانال‌هایی که SMS گوشی توشون فوروارد می‌شه. AI شماره‌ی فرستنده رو extract می‌کنه و امکان پاسخ از طریق وب‌سرویس SMS فراهم می‌شه.",
  },
  download_archive: {
    title: "Download archive",
    emoji: "🗄",
    description:
      "آرشیو محتوای دانلود‌شده (مثلاً اینستاگرام، توییتر). برای جست‌وجوی بعدی توی پیام‌های ذخیره شده.",
  },
  news: {
    title: "News sources",
    emoji: "📰",
    description:
      "کانال‌ها و گروه‌های خبری مهم. classifier importance رو bump می‌کنه و خلاصه‌های روزانه پررنگ‌تر هستن.",
  },
  summary_inbox: {
    title: "Summary inbox",
    emoji: "📬",
    description:
      "کانال یا گروهی که خلاصه‌های auto-summary از چت‌های ai_listen رو دریافت می‌کنه. فقط یکی استفاده می‌شه (آخرین به‌روزشده). توی همون پست خلاصه می‌تونی روی «جواب پیشنهادی» بزنی تا AI پاسخ رو برات بنویسه.",
  },
};

type ChatBrief = {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  functionConfig: Record<string, unknown> | null;
};

function chatLabel(c: ChatBrief): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return full || c.chatTitle || `chat ${c.chatId}`;
}

export default function FunctionsPage() {
  const [byRole, setByRole] = useState<Record<FunctionRole, ChatBrief[]> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/functions");
    const j = (await r.json()) as {
      byRole: Record<FunctionRole, ChatBrief[]>;
    };
    setByRole(j.byRole);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell>
      <PageTitle
        title="Functions"
        subtitle="هر چت می‌تونه یک نقش خاص داشته باشه (مثلاً «downloader» یا «news»). نقش هر چت رو از صفحه‌ی همون چت ست می‌کنی."
      />

      {loading && <Card>Loading…</Card>}
      {byRole && (
        <div className="flex flex-col gap-3">
          {(Object.keys(ROLE_INFO) as FunctionRole[]).map((role) => {
            const info = ROLE_INFO[role];
            const chats = byRole[role] ?? [];
            return (
              <Card key={role}>
                <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      {info.emoji} {info.title}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-dim)] mt-1">
                      {info.description}
                    </div>
                  </div>
                  <Badge tone="neutral">{chats.length}</Badge>
                </div>
                {chats.length === 0 ? (
                  <div className="text-[11px] text-[var(--color-text-dim)] italic">
                    هنوز چتی این نقش رو نداره.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {chats.map((c) => (
                      <Link
                        key={c.chatId}
                        href={`/chats/${c.chatId}`}
                        className="flex items-start justify-between gap-2 text-xs p-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                      >
                        <div className="min-w-0">
                          <div className="font-medium" dir="auto">
                            {chatLabel(c)}
                          </div>
                          <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                            {chatTypeLabel(c.chatType)} · id {c.chatId}
                          </div>
                        </div>
                        {c.functionConfig &&
                          Object.keys(c.functionConfig).length > 0 && (
                            <span className="text-[10px] text-[var(--color-text-dim)] truncate max-w-[40%]">
                              {JSON.stringify(c.functionConfig)}
                            </span>
                          )}
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
