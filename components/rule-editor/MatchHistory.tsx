"use client";

import type { RefObject } from "react";
import { relTime, truncate } from "@/lib/format";
import { btnGhost, Chip, fa, Note, type Match, type Recipient } from "./shared";

export type MatchFilter = "active" | "partial" | "done" | "expired";

// Four mutually-exclusive states:
//  done    → every recipient got it (historical; can't re-run)
//  partial → SOME got it but not all (the delivered went; the rest
//            won't once the window passes)
//  active  → nobody got it yet, still inside the window (pending — the
//            only ones that can still fire on their own)
//  expired → nobody got it AND past the window (fully dead)
export function matchStatus(m: Match, recipients: Recipient[], windowSeconds: number | null): MatchFilter {
  const windowMs = (windowSeconds ?? 0) * 1000;
  const pastWindow = windowMs > 0 && Date.now() - new Date(m.matchedAt).getTime() > windowMs;
  const deliveredSet = new Set(m.forwardedTo);
  // Paused recipients aren't expected to receive — not getting to them
  // is NOT "incomplete". Judge completeness against ACTIVE recipients.
  const active = recipients.filter((r) => !r.paused);
  const got = active.filter((r) => deliveredSet.has(r.recipientChatId)).length;
  if (active.length > 0 && got === active.length) return "done";
  if (got > 0) return "partial";
  return pastWindow ? "expired" : "active";
}

const EMPTY_TEXT: Record<MatchFilter, string> = {
  expired: "هیچ تطبیق منقضی‌ای نیست.",
  partial: "هیچ تطبیق ناقصی نیست.",
  done: "هنوز چیزی کامل تحویل نشده.",
  active: "تطبیق فعالی نیست — چیزی در حال انتظارِ ارسال نیست. تب‌های دیگه رو ببین.",
};

export default function MatchHistory({
  matches, recipients, windowSeconds, filter, onFilter, hasMore, loadingMore, error, sentinelRef, onLoadMore, forceStatus, onForceSend,
}: {
  matches: Match[];
  recipients: Recipient[];
  windowSeconds: number | null;
  filter: MatchFilter;
  onFilter: (f: MatchFilter) => void;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  forceStatus: { matchId: number; msg: string; ok: boolean } | null;
  onForceSend: (matchId: number) => void;
}) {
  const by = (f: MatchFilter) => matches.filter((m) => matchStatus(m, recipients, windowSeconds) === f);
  const groups = { active: by("active"), partial: by("partial"), done: by("done"), expired: by("expired") };
  const visible = groups[filter];
  const tabs: Array<{ key: MatchFilter; label: string }> = [
    { key: "active", label: `🟢 فعال (${fa(groups.active.length)})` },
    { key: "partial", label: `⚠️ ناقص (${fa(groups.partial.length)})` },
    { key: "done", label: `✓ انجام‌شده (${fa(groups.done.length)})` },
    { key: "expired", label: `⌛ منقضی (${fa(groups.expired.length)})` },
  ];

  const footer = error ? (
    <div className="mt-3 p-3 rounded-xl bg-red-900/30 border border-red-800 text-xs text-red-200 flex flex-col gap-2 items-center">
      <span className="leading-6">⚠ {error}</span>
      <div className="flex gap-2">
        <button onClick={onLoadMore} className="min-h-10 px-4 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs">
          🔄 دوباره امتحان کن
        </button>
      </div>
    </div>
  ) : hasMore ? (
    <div ref={sentinelRef} className="text-center text-xs text-[var(--color-text-dim)] py-3">
      {loadingMore ? "⏳ در حال بارگذاری بیشتر…" : "اسکرول کن تا بقیه بیاد"}
    </div>
  ) : (
    matches.length > 10 && (
      <div className="text-center text-xs text-[var(--color-text-dim)] py-3">· پایان لیست ({fa(matches.length)} match) ·</div>
    )
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onFilter(t.key)}
            className={`min-h-11 px-2 rounded-xl border text-xs ${
              filter === t.key ? "bg-[var(--color-accent)] text-white border-transparent" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-[var(--color-text-dim)] py-2">هنوز هیچ پیامی به این rule نخورده.</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-sm text-[var(--color-text-dim)] leading-7">{EMPTY_TEXT[filter]}</p>
          {hasMore && !error && (
            <div className="flex gap-2">
              <button onClick={onLoadMore} disabled={loadingMore} className={btnGhost}>
                {loadingMore ? "…" : "بارگذاری بیشتر"}
              </button>
            </div>
          )}
          {error && footer}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {visible.map((m) => {
              const deliveredSet = new Set(m.forwardedTo);
              const rowsByRecipient = recipients.map((r) => ({
                recipientChatId: r.recipientChatId,
                label: r.recipientLabel,
                paused: r.paused,
                got: deliveredSet.has(r.recipientChatId),
                err: m.forwardErrors?.[String(r.recipientChatId)] ?? null,
              }));
              // Completeness ignores paused recipients — they're not
              // expected to receive, so a paused non-delivery isn't
              // "ناقص".
              const activeRows = rowsByRecipient.filter((r) => !r.paused);
              const total = activeRows.length;
              const gotCount = activeRows.filter((r) => r.got).length;
              const allDelivered = total > 0 && gotCount === total;
              const partial = gotCount > 0 && gotCount < total;
              // Past the window a match can NEVER be delivered again —
              // not auto-released, and force-send is refused server-
              // side. `expired` = not-fully-delivered AND past window;
              // it drives the "no more sending" note + hidden button.
              const windowMs = (windowSeconds ?? 0) * 1000;
              const pastWindow = windowMs > 0 && Date.now() - new Date(m.matchedAt).getTime() > windowMs;
              const expired = !allDelivered && pastWindow;
              return (
                <div key={m.id} className="p-3 rounded-xl bg-[var(--color-surface-2)] text-xs flex flex-col gap-2">
                  <div className="text-xs text-[var(--color-text-dim)]">
                    {m.senderName} · {relTime(m.matchedAt)}
                  </div>
                  <div>
                    {allDelivered ? (
                      <Chip tone="ok">✓ همه گرفتن ({fa(gotCount)}/{fa(total)})</Chip>
                    ) : partial ? (
                      <Chip tone="bad">
                        ⚠️ ناقص ({fa(gotCount)}/{fa(total)}){pastWindow ? " — بقیه دیگه نمی‌ره" : ""}
                      </Chip>
                    ) : pastWindow ? (
                      <Chip>⌛ منقضی — دیگه ارسال نمی‌شه</Chip>
                    ) : (
                      <Chip tone="warn">⏸ نگه‌داشته (gate)</Chip>
                    )}
                  </div>
                  {rowsByRecipient.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {rowsByRecipient.map((r) => (
                        <span
                          key={r.recipientChatId}
                          title={r.paused ? "این گیرنده متوقفه" : r.err ?? undefined}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs max-w-full ${
                            r.got
                              ? "bg-emerald-900/40 text-emerald-200"
                              : r.paused
                                ? "bg-amber-500/10 text-amber-200/70 line-through"
                                : r.err
                                  ? "bg-red-900/40 text-red-200"
                                  : "bg-[var(--color-surface)] text-[var(--color-text-dim)]"
                          }`}
                        >
                          <span className="shrink-0">{r.got ? "✓" : r.paused ? "⏸" : expired ? "⌛" : r.err ? "✗" : "⏸"}</span>
                          <span className="truncate">{r.label ? `${r.label}` : String(r.recipientChatId)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* text-start: the message body is data, centred lines are unreadable */}
                  <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="whitespace-pre-wrap break-words text-start leading-6 p-2.5 rounded-lg bg-[var(--color-surface)]">
                    {truncate(m.messageText, 200)}
                  </div>
                  {m.formattedText && (
                    <div className="pt-2 border-t border-[var(--color-border)]">
                      <div className="text-xs text-[var(--color-text-dim)] mb-1">خروجی format شده:</div>
                      <div dir="auto" style={{ unicodeBidi: "plaintext" }} className="whitespace-pre-wrap break-words text-start leading-6">
                        {m.formattedText}
                      </div>
                    </div>
                  )}
                  {expired && (
                    <div className="text-xs leading-6 text-[var(--color-text-dim)]">⌛ منقضی — پنجره‌ی زمانی گذشته، دیگه قابل ارسال نیست.</div>
                  )}
                  {!allDelivered && !expired && (
                    <>
                      <div className="flex gap-2">
                        <button onClick={() => onForceSend(m.id)} className={btnGhost}>
                          🚀 ارسال اجباری به نگرفته‌ها
                        </button>
                      </div>
                      {forceStatus && forceStatus.matchId === m.id && <Note tone={forceStatus.ok ? "ok" : "bad"}>{forceStatus.msg}</Note>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {footer}
        </>
      )}
    </div>
  );
}
