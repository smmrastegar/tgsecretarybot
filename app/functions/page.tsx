"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";
import Section, { Pill } from "@/components/ui/Section";
import EmptyState from "@/components/ui/EmptyState";
import { confirmDialog } from "@/components/ui/Dialogs";
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

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const BTN = "min-h-11 px-4 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--color-accent)] text-white`;
const FIELD = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";

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
  const [err, setErr] = useState<string | null>(null);

  const [newCatSlug, setNewCatSlug] = useState("");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/functions");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        byRole: Record<FunctionRole, Record<string, ChatBrief[]>>;
        categories: Category[];
      };
      setByRole(j.byRole);
      setCategories(j.categories);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
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
    if (!(await confirmDialog(`گروه «${slug}» پاک بشه؟ همه چت‌های این گروه برمی‌گردن به default.`, { danger: true, confirmLabel: "پاک شود" }))) return;
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

      <Section
        icon="🏷"
        title="مدیریت گروه‌های Function"
        summary={`${fa(sortedCats.length)} گروه · ساخت و حذف گروه`}
      >
        <div className="flex flex-col gap-2 mb-4">
          {sortedCats.map((c) => (
            <div
              key={c.slug}
              className="flex items-center gap-2 min-h-12 px-3 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]"
            >
              <span aria-hidden className="text-lg shrink-0">{c.emoji ?? "📂"}</span>
              <span className="min-w-0 flex-1 text-center">
                <span className="block text-sm font-medium truncate">{c.label}</span>
                <span dir="ltr" className="block text-xs text-[var(--color-text-dim)] truncate">{c.slug}</span>
              </span>
              {!c.isBuiltin ? (
                <button
                  onClick={() => void deleteCategory(c.slug)}
                  aria-label={`پاک کردن ${c.label}`}
                  className="shrink-0 w-11 h-11 rounded-xl text-red-300 hover:bg-red-500/10"
                  title="پاک کن"
                >
                  ✕
                </button>
              ) : (
                <span className="shrink-0 w-11" aria-hidden />
              )}
            </div>
          ))}
        </div>
        <div className="text-sm font-medium mb-2">+ گروه جدید</div>
        <div className="grid grid-cols-1 gap-2">
          <input
            type="text"
            value={newCatEmoji}
            onChange={(e) => setNewCatEmoji(e.target.value)}
            placeholder="😀 ایموجی (اختیاری)"
            aria-label="ایموجی"
            className={`${FIELD} text-center`}
          />
          <input
            type="text"
            value={newCatLabel}
            onChange={(e) => setNewCatLabel(e.target.value)}
            placeholder="اسم نمایش (مثلاً «خبری»)"
            aria-label="اسم نمایش"
            className={FIELD}
          />
          <input
            type="text"
            value={newCatSlug}
            onChange={(e) => setNewCatSlug(e.target.value)}
            placeholder="slug (مثلاً «news»)"
            aria-label="slug"
            dir="ltr"
            className={FIELD}
          />
          <button
            onClick={createCategory}
            disabled={creating || !newCatSlug.trim() || !newCatLabel.trim()}
            className={`${BTN_PRIMARY} w-full`}
          >
            {creating ? "…" : "+ گروه"}
          </button>
        </div>
      </Section>

      {err ? (
        <Card>
          <p className="text-sm text-red-300">خطا در بارگذاری قابلیت‌ها: {err}</p>
          <div className="mt-3 flex">
            <button onClick={() => void load()} className={BTN_PRIMARY}>تلاش دوباره</button>
          </div>
        </Card>
      ) : loading && !byRole ? (
        <Card>
          <p className="text-sm text-[var(--color-text-dim)]">در حال بارگذاری…</p>
        </Card>
      ) : (
        byRole &&
        ROLES_IN_ORDER.map((role) => {
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
            <Section
              key={role}
              icon={info.emoji}
              title={info.title}
              summary={info.description}
              badge={<Pill tone={total === 0 ? "neutral" : "ok"}>{fa(total)}</Pill>}
            >
              <p className="text-xs text-[var(--color-text-dim)] leading-6 mb-4">
                {info.description}
              </p>
              {total === 0 ? (
                <EmptyState icon={info.emoji} title="هنوز چتی این نقش رو نداره." />
              ) : (
                <div className="flex flex-col gap-4">
                  {groupsToRender.map((c) => {
                    const chats = groups[c.slug] ?? [];
                    return (
                      <div key={c.slug}>
                        <div className="text-xs text-[var(--color-text-dim)] mb-2 flex items-center justify-center gap-1.5">
                          <span>{c.emoji ?? "📂"}</span>
                          <span className="font-medium">{c.label}</span>
                          <span className="opacity-70">({fa(chats.length)})</span>
                        </div>
                        <div className="flex flex-col gap-2">
                          {chats.map((cc) => (
                            <div
                              key={cc.chatId}
                              className="flex items-center gap-2 min-h-14 p-2 rounded-xl border border-[var(--color-border)]"
                            >
                              <Link
                                href={`/chats/${cc.chatId}`}
                                className="flex-1 min-w-0 self-stretch flex flex-col justify-center text-center hover:text-[var(--color-accent)]"
                              >
                                <div className="text-sm font-medium truncate" dir="auto">
                                  {chatLabel(cc)}
                                </div>
                                <div className="text-xs text-[var(--color-text-dim)] mt-0.5 truncate">
                                  {chatTypeLabel(cc.chatType)} · id {cc.chatId}
                                </div>
                              </Link>
                              <select
                                value={c.slug}
                                onChange={(e) =>
                                  setCategory(cc.chatId, role, e.target.value)
                                }
                                aria-label="منتقل کن به گروه دیگه"
                                className="shrink-0 w-28 min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-2"
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
            </Section>
          );
        })
      )}
    </Shell>
  );
}
