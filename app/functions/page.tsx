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
  | "summary_inbox"
  | "storage";

const ROLE_INFO: Record<
  FunctionRole,
  { title: string; description: string; emoji: string }
> = {
  downloader: {
    title: "بات‌های Downloader",
    emoji: "📥",
    description:
      "بات‌هایی که لینک اینستاگرام / یوتیوب / توییتر / ساندکلاد / اسپاتیفای می‌گیرن و فایل دانلود شده برمی‌گردونن.",
  },
  sms_inbox: {
    title: "کانال‌های SMS inbox",
    emoji: "📱",
    description: "کانال‌هایی که SMS گوشی توشون فوروارد می‌شه.",
  },
  download_archive: {
    title: "آرشیو دانلود",
    emoji: "🗄",
    description: "آرشیو محتوای دانلود‌شده. برای جست‌وجوی بعدی توی پیام‌های ذخیره شده.",
  },
  news: {
    title: "منابع خبری",
    emoji: "📰",
    description: "کانال‌ها و گروه‌های خبری مهم.",
  },
  summary_inbox: {
    title: "صندوق خلاصه‌ها",
    emoji: "📬",
    description: "کانال یا گروهی که خلاصه‌های auto-summary رو دریافت می‌کنه.",
  },
  storage: {
    title: "Storage (مدیای اینستاگرام)",
    emoji: "📦",
    description: "کانالی که استوری/پست/ریلز دانلودشده رو دریافت می‌کنه.",
  },
};

const ROLES_IN_ORDER: FunctionRole[] = [
  "downloader",
  "sms_inbox",
  "download_archive",
  "news",
  "summary_inbox",
  "storage",
];

type ChatBrief = {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

type Category = {
  slug: string;
  label: string;
  emoji: string | null;
  sortOrder: number;
  isBuiltin: boolean;
};

function chatLabel(c: ChatBrief): string {
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return full || c.chatTitle || `chat ${c.chatId}`;
}

export default function FunctionsPage() {
  const [byRole, setByRole] = useState<Record<
    FunctionRole,
    Record<string, ChatBrief[]>
  > | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [newCatSlug, setNewCatSlug] = useState("");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/functions");
    const j = (await r.json()) as {
      byRole: Record<FunctionRole, Record<string, ChatBrief[]>>;
      categories: Category[];
    };
    setByRole(j.byRole);
    setCategories(j.categories);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCategory = async () => {
    const slug = newCatSlug.trim();
    const label = newCatLabel.trim();
    if (!slug || !label) return;
    setCreating(true);
    try {
      await fetch("/api/function-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          label,
          emoji: newCatEmoji.trim() || null,
        }),
      });
      setNewCatSlug("");
      setNewCatLabel("");
      setNewCatEmoji("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const deleteCategory = async (slug: string) => {
    if (!confirm(`گروه «${slug}» پاک بشه؟ همه چت‌های این گروه برمی‌گردن به default.`)) return;
    await fetch(`/api/function-categories/${slug}`, { method: "DELETE" });
    await load();
  };

  const setCategory = async (chatId: number, role: FunctionRole, category: string) => {
    await fetch(`/api/chats/${chatId}/function-category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, category }),
    });
    await load();
  };

  // Sort categories: default first, then by sort_order.
  const sortedCats = [...categories].sort((a, b) => {
    if (a.slug === "default" && b.slug !== "default") return -1;
    if (b.slug === "default" && a.slug !== "default") return 1;
    return a.sortOrder - b.sortOrder;
  });

  return (
    <Shell>
      <PageTitle
        title="قابلیت‌ها"
        subtitle="هر نقش (downloader / news / ...) می‌تونه چند چت داشته باشه که توی گروه‌های متفاوت سازماندهی شدن. مثلاً «downloader» می‌تونه گروه «default»، «work»، «news» داشته باشه و هرکدوم چت‌های جدا."
      />

      <Card className="mb-3">
        <div className="text-xs font-medium mb-2">🏷 مدیریت گروه‌های Function</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {sortedCats.map((c) => (
            <span
              key={c.slug}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]"
            >
              <span>{c.emoji ?? "📂"}</span>
              <span>{c.label}</span>
              <span className="text-[var(--color-text-dim)]">({c.slug})</span>
              {!c.isBuiltin && (
                <button
                  onClick={() => deleteCategory(c.slug)}
                  className="text-red-300 hover:text-red-200 mr-1"
                  title="پاک کن"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            type="text"
            value={newCatEmoji}
            onChange={(e) => setNewCatEmoji(e.target.value)}
            placeholder="😀"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5 text-center"
          />
          <input
            type="text"
            value={newCatLabel}
            onChange={(e) => setNewCatLabel(e.target.value)}
            placeholder="اسم نمایش (مثلاً «خبری»)"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          />
          <input
            type="text"
            value={newCatSlug}
            onChange={(e) => setNewCatSlug(e.target.value)}
            placeholder="slug (مثلاً «news»)"
            dir="ltr"
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
          />
          <button
            onClick={createCategory}
            disabled={creating || !newCatSlug.trim() || !newCatLabel.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            + گروه
          </button>
        </div>
      </Card>

      {loading && <Card>بارگذاری…</Card>}
      {byRole && (
        <div className="flex flex-col gap-3">
          {ROLES_IN_ORDER.map((role) => {
            const info = ROLE_INFO[role];
            const groups = byRole[role] ?? {};
            const total = Object.values(groups).reduce(
              (n, arr) => n + arr.length,
              0,
            );
            // Render groups in category sort order; only render
            // categories that have at least one chat (less noise).
            const groupsToRender = sortedCats.filter(
              (c) => (groups[c.slug] ?? []).length > 0,
            );
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
                  <Badge tone="neutral">{total}</Badge>
                </div>
                {total === 0 ? (
                  <div className="text-[11px] text-[var(--color-text-dim)] italic">
                    هنوز چتی این نقش رو نداره.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {groupsToRender.map((c) => {
                      const chats = groups[c.slug] ?? [];
                      return (
                        <div key={c.slug}>
                          <div className="text-[11px] text-[var(--color-text-dim)] mb-1.5 flex items-center gap-1">
                            <span>{c.emoji ?? "📂"}</span>
                            <span className="font-medium">{c.label}</span>
                            <span className="opacity-60">({chats.length})</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {chats.map((cc) => (
                              <div
                                key={cc.chatId}
                                className="flex items-center gap-2 text-xs p-2 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                              >
                                <Link
                                  href={`/chats/${cc.chatId}`}
                                  className="flex-1 min-w-0"
                                >
                                  <div className="font-medium" dir="auto">
                                    {chatLabel(cc)}
                                  </div>
                                  <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                                    {chatTypeLabel(cc.chatType)} · id {cc.chatId}
                                  </div>
                                </Link>
                                <select
                                  value={c.slug}
                                  onChange={(e) =>
                                    setCategory(cc.chatId, role, e.target.value)
                                  }
                                  className="text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-1.5 py-1"
                                  title="منتقل کن به گروه دیگه"
                                >
                                  {sortedCats.map((opt) => (
                                    <option key={opt.slug} value={opt.slug}>
                                      {opt.emoji ?? "📂"} {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
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
