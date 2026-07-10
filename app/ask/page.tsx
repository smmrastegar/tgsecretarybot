"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle, Badge } from "@/components/Card";
import { relTime } from "@/lib/format";

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
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await fetch("/api/ask");
    if (r.ok) {
      const j = (await r.json()) as { items: HistoryItem[] };
      setHistory(j.items);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

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
    if (!confirm("این پرسش حذف بشه؟")) return;
    await fetch(`/api/ask/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setAnswer(null);
      setSelectedId(null);
    }
    await loadHistory();
  }

  return (
    <Shell>
      <PageTitle
        title="🔎 پرسش از پیام‌ها"
        subtitle="هر سوالی به زبان طبیعی بپرس — AI پیام‌های اخیر همه‌ی چت‌ها رو می‌خونه و جواب فارسی می‌ده. نتایج ذخیره می‌شه و نتایج تکراری از cache میاد."
      />

      <Card className="mb-4">
        <label className="block text-xs text-[var(--color-text-dim)] mb-1">
          سوال یا prompt شما
        </label>
        <textarea
          dir="auto"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="مثلاً: ساعت کاری همه‌ی بچه‌ها رو بهم بگو، به ترتیب چت‌ها"
          className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
          <span className="text-[var(--color-text-dim)]">بازه‌ی زمانی:</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          >
            <option value="1">۲۴ ساعت اخیر</option>
            <option value="7">۷ روز اخیر</option>
            <option value="30">۳۰ روز اخیر</option>
            <option value="90">۹۰ روز اخیر</option>
            <option value="365">یک سال اخیر</option>
          </select>
          {answer !== null && cached && (
            <button
              onClick={() => ask(true)}
              disabled={loading || !prompt.trim()}
              className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              🔄 اجرای مجدد (cache رو دور بزن)
            </button>
          )}
          <button
            onClick={() => ask(false)}
            disabled={loading || !prompt.trim()}
            className="ml-auto text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90"
          >
            {loading ? "در حال جستجو…" : "بپرس"}
          </button>
        </div>
      </Card>

      <Card className="mb-4 !p-3">
        <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
          نمونه سوال (کلیک کن):
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s}
              dir="auto"
              onClick={() => setPrompt(s)}
              className="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] text-left"
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {error && (
        <Card className="mb-4 border-red-800">
          <div className="text-red-300 text-sm">{error}</div>
        </Card>
      )}

      {answer !== null && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="neutral">{scanned} پیام اسکن‌شده</Badge>
              {cached ? (
                <Badge tone="info">💾 از cache</Badge>
              ) : (
                <Badge tone="success">⚡ تازه ساخته شد</Badge>
              )}
            </div>
          </div>
          <div
            dir="auto"
            className="text-sm whitespace-pre-wrap break-words leading-relaxed"
          >
            {answer || "(پاسخی نیست)"}
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <div className="text-sm font-medium mb-2">📚 پرسش‌های قبلی</div>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-3">
            هر پرسش با همراه پاسخش ذخیره می‌شه. کلیک کن تا باز شه.
          </div>
          <div className="flex flex-col gap-1.5">
            {history.map((it) => (
              <div
                key={it.id}
                className={`text-xs p-2 rounded-md border ${
                  selectedId === it.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                    : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                <div className="flex justify-between gap-2 flex-wrap">
                  <button
                    dir="auto"
                    onClick={() => openSaved(it)}
                    className="text-right flex-1 min-w-0"
                  >
                    <div className="font-medium break-words">
                      {it.prompt}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-dim)] mt-0.5">
                      {it.scannedMessages} پیام · {it.days} روز · {relTime(it.createdAt)}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSaved(it.id)}
                    className="text-[10px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-red-900/40 shrink-0 self-start"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Shell>
  );
}
