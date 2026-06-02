"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { Card, PageTitle } from "@/components/Card";

const SAMPLES = [
  "ساعت کاری همه‌ی بچه‌ها رو بهم بگو، به ترتیب چت‌ها",
  "این هفته کی چی ازم خواسته؟",
  "هر کسی چه پروژه‌ای دستشه؟",
  "خلاصه‌ی همه‌ی گروه‌های خبری امروز",
];

export default function AskPage() {
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), days }),
      });
      const j = (await r.json()) as {
        answer?: string;
        scannedMessages?: number;
        error?: string;
      };
      if (!r.ok) {
        setError(j.error ?? `error ${r.status}`);
      } else {
        setAnswer(j.answer ?? "");
        setScanned(j.scannedMessages ?? 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <PageTitle
        title="🔎 پرسش از پیام‌ها"
        subtitle="هر سوالی به زبان طبیعی بپرس — AI پیام‌های اخیر همه‌ی چت‌ها رو می‌خونه و جواب فارسی می‌ده."
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
          <button
            onClick={ask}
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
        <Card>
          <div className="text-[11px] text-[var(--color-text-dim)] mb-2">
            بر اساس {scanned} پیام اخیر
          </div>
          <div
            dir="auto"
            className="text-sm whitespace-pre-wrap break-words leading-relaxed"
          >
            {answer || "(پاسخی نیست)"}
          </div>
        </Card>
      )}
    </Shell>
  );
}
