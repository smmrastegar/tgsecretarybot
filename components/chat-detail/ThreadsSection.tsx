"use client";

import { useCallback, useState } from "react";
import MediaView from "@/components/MediaView";
import EmptyState from "@/components/ui/EmptyState";
import Section from "@/components/ui/Section";
import { relTime } from "@/lib/format";
import { Chip, Note, btnCls, fa, inputCls } from "./shared";
import type { ThreadGroup } from "./types";

type Win = "recent24h" | "recent7d" | "all";

// Conversation threads of this chat (a silence longer than the gap starts a new one) with on-demand AI
// summaries. Loaded only when asked, like before.
export default function ThreadsSection({ chatId }: { chatId: number }) {
  const [threads, setThreads] = useState<ThreadGroup[] | null>(null);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState(false);
  const [threadGap, setThreadGap] = useState(5);
  const [threadWindow, setThreadWindow] = useState<Win>("recent24h");
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [summarizing, setSummarizing] = useState<Set<number>>(new Set());
  const [savedActions, setSavedActions] = useState<Set<string>>(new Set());

  const loadThreads = useCallback(
    async (gap: number, window: Win) => {
      if (!Number.isFinite(chatId)) return;
      setThreadsLoading(true);
      setThreadsError(false);
      const sinceHours = window === "recent24h" ? 24 : window === "recent7d" ? 24 * 7 : 0;
      try {
        const r = await fetch(`/api/chats/${chatId}/threads?gap=${gap}&limit=500&sinceHours=${sinceHours}`);
        if (r.ok) {
          const j = (await r.json()) as { threads: ThreadGroup[] };
          setThreads(j.threads);
        } else setThreadsError(true);
      } catch {
        setThreadsError(true);
      } finally {
        setThreadsLoading(false);
      }
    },
    [chatId],
  );

  async function summarizeThread(threadNo: number, force = false) {
    if (summarizing.has(threadNo)) return;
    setSummarizing((prev) => new Set(prev).add(threadNo));
    try {
      const r = await fetch(`/api/chats/${chatId}/threads/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadNo, gapMinutes: threadGap, force }),
      });
      if (r.ok) {
        // Reload threads so we pick up the new persisted summary + stale flag rather than tracking it locally.
        await loadThreads(threadGap, threadWindow);
      }
    } finally {
      setSummarizing((prev) => {
        const next = new Set(prev);
        next.delete(threadNo);
        return next;
      });
    }
  }

  async function addActionFromSummary(threadNo: number, title: string) {
    const key = `${threadNo}::${title}`;
    if (savedActions.has(key)) return;
    const r = await fetch(`/api/chats/${chatId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind: "action" }),
    });
    if (r.ok) setSavedActions((prev) => new Set(prev).add(key));
  }

  const reload = () => loadThreads(threadGap, threadWindow);

  return (
    <Section icon="🧵" title="Thread‌ها" summary="گفتگو به بخش‌های پشت‌سرهم؛ خلاصه‌ی هر کدوم با AI"
      badge={threads ? <Chip>{fa(threads.length)}</Chip> : undefined}>
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
        هر فاصله‌ی سکوتِ بیشتر از چند دقیقه یه thread جدید درست می‌کنه. خلاصه‌ی هر کدوم رو با AI بگیر — اکشن‌های پیشنهادی به Actions اضافه می‌شن.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select aria-label="بازه‌ی زمانی" value={threadWindow} className={inputCls}
          onChange={(e) => {
            const w = e.target.value as Win;
            setThreadWindow(w);
            void loadThreads(threadGap, w);
          }}>
          <option value="recent24h">۲۴ ساعت اخیر</option>
          <option value="recent7d">۷ روز اخیر</option>
          <option value="all">همه</option>
        </select>
        <select aria-label="فاصله‌ی سکوت" value={threadGap} className={inputCls} title="فاصله‌ی سکوت برای جدا کردن threadها"
          onChange={(e) => {
            const g = Number(e.target.value);
            setThreadGap(g);
            void loadThreads(g, threadWindow);
          }}>
          <option value="2">gap ۲ دقیقه</option>
          <option value="5">gap ۵ دقیقه</option>
          <option value="15">gap ۱۵ دقیقه</option>
          <option value="60">gap ۱ ساعت</option>
        </select>
      </div>
      <button type="button" onClick={reload} disabled={threadsLoading} className={`${btnCls} w-full mt-2`}>
        {threadsLoading ? "در حال بارگذاری…" : threads ? "بازخوانی" : "بارگذاری thread‌ها"}
      </button>

      <div className="mt-4">
        {threadsError && (
          <EmptyState icon="⚠️" title="thread‌ها بارگذاری نشدن" action={<button type="button" onClick={reload} className={btnCls}>تلاش دوباره</button>} />
        )}
        {!threadsError && !threads && !threadsLoading && (
          <EmptyState icon="🧵" title="هنوز thread‌ها لود نشدن" hint="روی «بارگذاری thread‌ها» بزن." />
        )}
        {!threadsError && threads && threads.length === 0 && (
          <EmptyState icon="🧵" title={threadWindow === "all" ? "پیامی در این چت نیست." : "توی این بازه‌ی زمانی thread‌ای نیست."}
            hint={threadWindow === "all" ? undefined : "فیلتر رو روی «همه» بذار یا بازه‌ی بزرگ‌تر انتخاب کن."} />
        )}
        {threads && threads.length > 0 && (
          <div className="flex flex-col gap-3">
            {threads.map((t) => {
              const expanded = expandedThreads.has(t.threadNo);
              const started = new Date(t.startedAt);
              const durationMin = Math.round((new Date(t.endedAt).getTime() - started.getTime()) / 60000);
              const sum = t.summary;
              const summarising = summarizing.has(t.threadNo);
              const summariseLabel = summarising ? "در حال خلاصه‌سازی…" : !sum ? "خلاصه کن" : sum.stale ? "🔄 به‌روزرسانی خلاصه" : "✓ خلاصه‌سازی دوباره";
              return (
                <div key={t.threadNo} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
                  <div className="text-sm font-medium">{started.toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" })}</div>
                  <div className="text-xs text-[var(--color-text-dim)]">→ {relTime(t.endedAt)}</div>
                  <div className="text-xs leading-6 text-[var(--color-text-dim)] mt-1" dir="auto">
                    {fa(t.messageCount)} پیام · {fa(durationMin)} دقیقه · {t.senders.join("، ")}
                    {sum?.stale && <span className="text-amber-400"> · پیام جدید بعد از خلاصه</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 [justify-content:left]">
                    <button type="button" onClick={() => summarizeThread(t.threadNo, sum?.stale ?? false)} disabled={summarising} className={btnCls}>{summariseLabel}</button>
                    <button type="button" aria-expanded={expanded} className={btnCls}
                      onClick={() => setExpandedThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.threadNo)) next.delete(t.threadNo);
                        else next.add(t.threadNo);
                        return next;
                      })}>{expanded ? "بستن" : "نمایش"}</button>
                  </div>
                  {sum && (
                    <div className="mt-3 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl p-3 text-start">
                      <div dir="auto" className="whitespace-pre-wrap leading-7">{sum.summary}</div>
                      {sum.topics.length > 0 && (
                        <div dir="auto" className="mt-2 text-xs leading-6 text-[var(--color-text-dim)]">موضوعات: {sum.topics.join(" · ")}</div>
                      )}
                      {sum.actionItems.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs text-[var(--color-text-dim)] mb-1.5">اکشن‌های پیشنهادی — کلیک کن تا به Actions اضافه بشه:</div>
                          <div className="flex flex-col gap-1.5">
                            {sum.actionItems.map((a, i) => {
                              const saved = savedActions.has(`${t.threadNo}::${a}`);
                              return (
                                <button key={i} type="button" dir="auto" onClick={() => addActionFromSummary(t.threadNo, a)} disabled={saved}
                                  className={`min-h-11 px-3 py-2 rounded-xl border text-xs leading-5 text-start ${saved
                                    ? "border-emerald-700 bg-emerald-900/40 text-emerald-300 cursor-default"
                                    : "border-[var(--color-border)] active:bg-[var(--color-surface)]"}`}>
                                  {saved ? "✓ " : "+ "}{a}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="mt-2 text-xs text-[var(--color-text-dim)]">
                        {sum.stale ? "خلاصه‌ی قبلی — پیام‌های جدیدتری اضافه شده‌ان" : `خلاصه‌ی ${relTime(sum.createdAt)}`}
                      </div>
                    </div>
                  )}
                  {expanded && (
                    <div className="mt-3 flex flex-col gap-2 text-start">
                      {t.messages.length === 0 && <Note>پیامی برای نمایش نیست.</Note>}
                      {t.messages.map((m) => (
                        <div key={m.id} className={`text-sm p-3 rounded-xl border ${m.fromOwner ? "border-blue-900/40 bg-blue-900/10" : "border-[var(--color-border)] bg-[var(--color-surface-2)]/40"}`}>
                          <div className="flex justify-between gap-2 text-xs text-[var(--color-text-dim)]">
                            <span className="min-w-0 truncate">
                              {m.fromOwner ? "شما" : m.senderName}
                              {m.urgent && <span className="ms-1"><Chip tone="danger">فوری</Chip></span>}
                            </span>
                            <span className="shrink-0">{relTime(m.createdAt)}</span>
                          </div>
                          <div dir="auto" className="mt-1 whitespace-pre-wrap leading-7 [overflow-wrap:anywhere]">
                            {m.mediaKind && <span className="text-[var(--color-text-dim)]">[{m.mediaKind}] </span>}
                            {m.transcript ? m.transcript : m.mediaDescription ? m.mediaDescription : m.messageText || "(بدون متن)"}
                          </div>
                          {m.mediaKind && <MediaView messageId={m.id} kind={m.mediaKind} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}
