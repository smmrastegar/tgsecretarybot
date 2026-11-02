"use client";

import { useCallback, useEffect, useState } from "react";
import Section from "./Section";

// Share links made from the player: each opens only the songs it was made for. Switch one off here.
type Share = { id: number; kind: string; title: string; trackIds: number[]; visibility: "public" | "private"; createdAt: string; views: number; revoked: boolean; url: string };
const when = (iso: string) => new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });

export default function SharesCard({ onMessage }: { onMessage: (m: string) => void }) {
  const [rows, setRows] = useState<Share[]>([]);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/share", { cache: "no-store" });
    if (r.ok) setRows(((await r.json()) as { shares: Share[] }).shares.filter((s) => !s.revoked));
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (rows.length === 0) return null;
  return (
    <Section icon="🔗" title="لینک‌های اشتراک‌گذاری" summary={`${rows.length} لینک فعال`}>
      <p className="text-xs text-[var(--color-text-dim)] mb-3 leading-6">هر لینک فقط همان آهنگ یا آلبومی را باز می‌کند که برایش ساخته شده؛ هیچ‌چیز دیگری از کتابخانه یا پلیر دیده نمی‌شود. «عمومی» یعنی هر کس لینک را داشته باشد؛ «خصوصی» یعنی باید وارد My Music شود.</p>
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className="flex items-center gap-3 text-xs rounded-lg border border-[var(--color-border)] p-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{s.title}</div>
              <div className="text-[var(--color-text-dim)] mt-0.5">{s.visibility === "private" ? "🔒 خصوصی" : "🌐 عمومی"} · {s.trackIds.length} آهنگ · {s.views} بازدید · {when(s.createdAt)}</div>
            </div>
            <button onClick={() => { void navigator.clipboard.writeText(s.url); onMessage("لینک کپی شد"); }} className="shrink-0 px-3 py-1.5 rounded-md border border-[var(--color-border)]">کپی</button>
            <button onClick={async () => { const r = await fetch(`/api/music/share?id=${s.id}`, { method: "DELETE" }); onMessage(r.ok ? "لینک غیرفعال شد" : "نشد"); await load(); }} className="shrink-0 px-3 py-1.5 rounded-md border border-rose-500/40 text-rose-200">غیرفعال</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
