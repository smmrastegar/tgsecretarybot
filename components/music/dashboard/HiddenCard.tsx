"use client";

import { useCallback, useEffect, useState } from "react";
import Section from "./Section";

// Songs hidden from the player (with the reason asked at the time). Hidden songs are out of every list, playlist, mix and link; bring them back here.
type Row = { id: number; title: string | null; artist: string | null; hiddenAt: string; hiddenReason: string };

export default function HiddenCard({ onMessage, onChanged }: { onMessage: (m: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/hidden", { cache: "no-store" });
    if (r.ok) setRows(((await r.json()) as { tracks: Row[] }).tracks);
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (rows.length === 0) return null;
  return (
    <Section icon="🙈" title="آهنگ‌های مخفی‌شده" summary={`${rows.length} آهنگ · از همه‌جا پنهان`}>
      <p className="text-xs text-[var(--color-text-dim)] mb-3 leading-6">این آهنگ‌ها از پلیر، پلی‌لیست‌ها، جستجو و همهٔ لینک‌ها بیرون‌اند ولی پاک نشده‌اند. از داخل پلیر (Settings → Hidden songs) هم می‌توانی ویرایش یا برگردانی‌شان.</p>
      <div className="space-y-2">
        {rows.map((t) => (
          <div key={t.id} className="flex items-center gap-3 text-xs rounded-lg border border-[var(--color-border)] p-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{t.title ?? "—"} <span className="text-[var(--color-text-dim)] font-normal">· {t.artist}</span></div>
              <div className="text-[var(--color-text-dim)] mt-0.5">«{t.hiddenReason || "بدون دلیل"}»</div>
            </div>
            <button onClick={async () => { const r = await fetch(`/api/music/hidden?id=${t.id}`, { method: "DELETE" }); onMessage(r.ok ? "آهنگ برگشت" : "برنگشت"); await load(); onChanged(); }} className="shrink-0 px-3 py-1.5 rounded-md border border-[var(--color-border)]">برگردان</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
