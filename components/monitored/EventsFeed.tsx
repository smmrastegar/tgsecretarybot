"use client";

import { useEffect, useRef } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { Chip } from "@/components/chat-detail/shared";
import { relTime } from "@/lib/format";
import { BTN, fa, type MonitorEvent } from "./shared";

// What kind of media a forwarded event points at, guessed from its Instagram permalink.
function kindOf(url: string | null): { icon: string; label: string } {
  if (!url) return { icon: "📎", label: "مورد" };
  if (/\/stories\//.test(url)) return { icon: "📸", label: "استوری" };
  if (/\/reels?\//.test(url)) return { icon: "🎬", label: "ریلز" };
  if (/\/p\//.test(url)) return { icon: "🖼", label: "پست" };
  return { icon: "📎", label: "مدیا" };
}

function statusChip(status: string) {
  if (status === "forwarded") return <Chip tone="success">ارسال شد</Chip>;
  if (status === "error") return <Chip tone="danger">خطا</Chip>;
  return <Chip tone="info">{status}</Chip>;
}

// The recent-events feed: one media card per event (kind tile, @account, when, status, open link). The list
// grows by itself when the sentinel scrolls into view; "نمایش بیشتر" does the same by hand.
export default function EventsFeed({
  events,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: MonitorEvent[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  // IntersectionObserver wired to a sentinel at the bottom of the
  // list. When the sentinel enters the viewport we call onLoadMore;
  // the parent debounces its own state so a second hit is ignored
  // until the first fetch is done.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && hasMore && !loadingMore) {
            onLoadMore();
          }
        }
      },
      { rootMargin: "120px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <section aria-label="رویدادهای اخیر">
      <h2 className="text-sm font-semibold text-center mb-3">📬 رویدادهای اخیر</h2>
      {events.length === 0 ? (
        <EmptyState
          icon="📬"
          title="هنوز رویدادی ثبت نشده."
          hint="وقتی استوری یا پست تازه‌ای پیدا و forward بشه، اینجا می‌آید."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => {
            const k = kindOf(e.storyUrl);
            return (
              <article
                key={e.id}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 min-w-0"
              >
                <div className="flex items-center gap-3 min-h-14">
                  <span
                    aria-hidden
                    className="grid place-items-center w-12 h-12 rounded-xl bg-[var(--color-surface-2)] text-2xl shrink-0"
                  >
                    {k.icon}
                  </span>
                  <div className="min-w-0 flex-1 text-center">
                    <div dir="ltr" className="text-sm font-semibold truncate">
                      @{e.username ?? e.accountId}
                    </div>
                    <div className="text-xs text-[var(--color-text-dim)] truncate">
                      {k.label} · {relTime(e.detectedAt)}
                      {e.forwardedAt && ` · ارسال ${relTime(e.forwardedAt)}`}
                    </div>
                  </div>
                  <div className="shrink-0">{statusChip(e.status)}</div>
                </div>
                {e.error && (
                  <p dir="auto" className="mt-2 text-xs leading-6 text-rose-300 text-center [overflow-wrap:anywhere]">
                    {e.error}
                  </p>
                )}
                {e.storyUrl && (
                  <div className="mt-2 flex items-center gap-2 [justify-content:left]">
                    <span dir="ltr" className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-dim)]">
                      {e.storyUrl.replace(/^https?:\/\/(www\.)?/, "")}
                    </span>
                    <a href={e.storyUrl} target="_blank" rel="noopener noreferrer" className={`${BTN} shrink-0`}>
                      ↗ باز کردن
                    </a>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {(hasMore || loadingMore) && (
        <div ref={sentinelRef} className="mt-3 flex justify-center text-xs text-[var(--color-text-dim)]">
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className={BTN}>
            {loadingMore ? "در حال بارگذاری…" : `نمایش بیشتر (${fa(events.length)} مورد تا الان)`}
          </button>
        </div>
      )}
    </section>
  );
}
