"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import EmptyState from "@/components/ui/EmptyState";
import Section, { Pill } from "@/components/ui/Section";
import { confirmDialog } from "@/components/ui/Dialogs";
import { relTime } from "@/lib/format";

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

const SAMPLES = [
  "ساعت کاری همه‌ی بچه‌ها رو بهم بگو، به ترتیب چت‌ها",
  "این هفته کی چی ازم خواسته؟",
  "هر کسی چه پروژه‌ای دستشه؟",
  "خلاصه‌ی همه‌ی گروه‌های خبری امروز",
];

type HistoryItem = {
  id: number;
  prompt: string;
  answer: string;
  scannedMessages: number;
  days: number;
  createdAt: string;
};

export default function AskPage() {
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const r = await fetch("/api/ask");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { items: HistoryItem[] };
      setHistory(j.items);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // On a phone the answer lands below the fold; bring it into view when it changes.
  useEffect(() => {
    if (answer !== null || error) answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [answer, error, selectedId]);

  async function ask(force = false) {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSelectedId(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), days, force }),
      });
      const j = (await r.json()) as {
        id?: number;
        answer?: string;
        scannedMessages?: number;
        cached?: boolean;
        error?: string;
      };
      if (!r.ok) {
        setError(j.error ?? `error ${r.status}`);
      } else {
        setAnswer(j.answer ?? "");
        setScanned(j.scannedMessages ?? 0);
        setCached(Boolean(j.cached));
        setSelectedId(j.id ?? null);
        await loadHistory();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function openSaved(item: HistoryItem) {
    setPrompt(item.prompt);
    setDays(item.days);
    setAnswer(item.answer);
    setScanned(item.scannedMessages);
    setCached(true);
    setSelectedId(item.id);
    setError(null);
  }

  async function deleteSaved(id: number) {
    if (!(await confirmDialog("این پرسش حذف بشه؟", { danger: true, confirmLabel: "حذف" }))) return;
    await fetch(`/api/ask/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setAnswer(null);
      setSelectedId(null);
    }
    await loadHistory();
  }

  return (
    <Shell>
      <div className="md:max-w-3xl md:mx-auto">
        <PageTitle
          title="🔎 پرسش از پیام‌ها"
          subtitle="هر سوالی به زبان طبیعی بپرس — AI پیام‌های اخیر همه‌ی چت‌ها رو می‌خونه و جواب فارسی می‌ده. نتایج ذخیره می‌شه و نتایج تکراری از cache میاد."
        />

        <Card className="mb-3">
          <label htmlFor="ask-prompt" className="block text-sm font-medium mb-2">
            سوال یا prompt شما
          </label>
          <textarea
            id="ask-prompt"
            dir="auto"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="مثلاً: ساعت کاری همه‌ی بچه‌ها رو بهم بگو، به ترتیب چت‌ها"
            className="w-full min-h-28 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 py-2.5 text-base leading-7"
          />
          <label htmlFor="ask-days" className="block text-xs text-[var(--color-text-dim)] mt-3 mb-1.5">
            بازه‌ی زمانی
          </label>
          <select
            id="ask-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3"
          >
            <option value="1">۲۴ ساعت اخیر</option>
            <option value="7">۷ روز اخیر</option>
            <option value="30">۳۰ روز اخیر</option>
            <option value="90">۹۰ روز اخیر</option>
            <option value="365">یک سال اخیر</option>
          </select>
          <button
            type="button"
            onClick={() => ask(false)}
            disabled={loading || !prompt.trim()}
            className="mt-4 w-full min-h-12 rounded-xl bg-[var(--color-accent)] text-white text-base font-medium disabled:opacity-50 active:opacity-90"
          >
            {loading ? "در حال جستجو…" : "بپرس"}
          </button>
          {answer !== null && cached && (
            <div className="mt-2 flex">
              <button
                type="button"
                onClick={() => ask(true)}
                disabled={loading || !prompt.trim()}
                className="min-h-10 text-xs px-3 rounded-xl border border-[var(--color-border)] active:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                🔄 اجرای مجدد (cache رو دور بزن)
              </button>
            </div>
          )}
        </Card>

        <Section icon="💡" title="نمونه سوال" summary="روی یکی بزن تا در کادر بالا بنشیند" badge={<Pill>{fa(SAMPLES.length)}</Pill>}>
          <div className="-mx-4 -mb-4">
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                dir="auto"
                onClick={() => {
                  setPrompt(s);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="w-full min-h-14 px-4 py-2 text-sm leading-6 border-t first:border-t-0 border-[var(--color-border)] active:bg-[var(--color-surface-2)]"
              >
                {s}
              </button>
            ))}
          </div>
        </Section>

        <div ref={answerRef} className="scroll-mt-20">
          {loading && (
            <Card className="mb-3">
              <div role="status" className="text-sm text-[var(--color-text-dim)] leading-7">در حال جستجو در پیام‌ها…</div>
            </Card>
          )}

          {error && (
            <div role="alert" className="mb-3 rounded-2xl border border-red-800 bg-rose-500/10 px-4 py-3 text-center">
              <p dir="auto" className="text-sm text-red-300 leading-6 break-words">{error}</p>
              <div className="mt-2 flex">
                <button
                  type="button"
                  onClick={() => ask(false)}
                  disabled={loading || !prompt.trim()}
                  className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100 disabled:opacity-50"
                >
                  تلاش دوباره
                </button>
              </div>
            </div>
          )}

          {answer !== null && (
            <Card className="mb-3">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Badge tone="neutral">{fa(scanned)} پیام اسکن‌شده</Badge>
                {cached ? (
                  <Badge tone="info">💾 از cache</Badge>
                ) : (
                  <Badge tone="success">⚡ تازه ساخته شد</Badge>
                )}
              </div>
              {/* text-start on purpose: the answer is multi-line prose / bullet lists, which are unreadable centred. */}
              <div
                dir="auto"
                className="mt-3 text-sm whitespace-pre-wrap break-words leading-7 text-start"
              >
                {answer || "(پاسخی نیست)"}
              </div>
            </Card>
          )}
        </div>

        {historyError && (
          <div role="alert" className="mb-3 rounded-2xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-center">
            <p className="text-sm text-rose-200 leading-6">پرسش‌های قبلی بارگذاری نشد: {historyError}</p>
            <div className="mt-2 flex">
              <button type="button" onClick={loadHistory} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-sm text-rose-100">تلاش دوباره</button>
            </div>
          </div>
        )}

        {history.length > 0 ? (
          <Section
            icon="📚"
            title="پرسش‌های قبلی"
            summary="پرسش و پاسخ ذخیره‌شده"
            badge={<Pill>{fa(history.length)}</Pill>}
            defaultOpen
          >
            <ul className="-mx-4 -mb-4">
              {history.map((it) => (
                <li
                  key={it.id}
                  className={`flex items-stretch border-t first:border-t-0 border-[var(--color-border)] ${
                    selectedId === it.id ? "bg-[var(--color-accent)]/10" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openSaved(it)}
                    className="min-w-0 flex-1 min-h-16 px-4 py-2.5 text-center"
                  >
                    <span dir="auto" className="block text-sm font-medium leading-6 line-clamp-2 break-words">{it.prompt}</span>
                    <span className="block mt-0.5 text-xs text-[var(--color-text-dim)]">
                      {fa(it.scannedMessages)} پیام، {fa(it.days)} روز، {relTime(it.createdAt)}
                    </span>
                  </button>
                  <div className="grid place-items-center w-14 shrink-0">
                    <button
                      type="button"
                      onClick={() => deleteSaved(it.id)}
                      aria-label="حذف پرسش"
                      title="حذف"
                      className="w-11 h-11 rounded-xl border border-[var(--color-border)] active:bg-red-900/40"
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : (
          !historyError && (
            <EmptyState icon="📚" title="هنوز پرسشی ذخیره نشده" hint="اولین سوالت رو بالا بپرس؛ پرسش و پاسخ اینجا ذخیره می‌شه." />
          )
        )}
      </div>
    </Shell>
  );
}
