"use client";

import { useCallback, useEffect, useState } from "react";
import Section from "./Section";
import { AccountBadge, accountCodes } from "@/components/music/app/SourceMarks";

// The short code beside every song's source in the player. Worked out automatically; type your own here and it wins everywhere
// (the dashboard, every link, the Android app). Clear the box to go back to automatic.
type Acc = { id: number; name: string; code: string | null };

export default function AccountCodesCard({ onMessage }: { onMessage: (m: string) => void }) {
  const [accts, setAccts] = useState<Acc[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/music/account-codes", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { accounts: Acc[] };
    setAccts(j.accounts); setDraft({});
  }, []);
  useEffect(() => { void load(); }, [load]);

  const auto = accountCodes(accts.map((a) => ({ id: a.id, name: a.name })));
  const shown = (a: Acc) => (draft[a.id] ?? a.code ?? "").toUpperCase();
  const save = async (a: Acc) => {
    const v = (draft[a.id] ?? a.code ?? "").replace(/\s+/g, "").slice(0, 4).toUpperCase();
    if (v === (a.code ?? "")) { setDraft((d) => { const n = { ...d }; delete n[a.id]; return n; }); return; }
    const r = await fetch("/api/music/account-codes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id, code: v }) });
    onMessage(r.ok ? (v ? `کد «${a.name}» شد ${v}` : `کد «${a.name}» دوباره خودکار شد`) : "ذخیره نشد");
    await load();
  };

  if (accts.length === 0) return null;
  return (
    <Section icon="🔤" title="کد کوتاه حساب‌ها" summary={`${accts.filter((a) => a.code).length} دستی · بقیه خودکار`}>
      <p className="text-xs text-[var(--color-text-dim)] mb-3 leading-6">کنار هر آهنگ، آیکن برنامه و یک کد کوتاه (تا ۴ حرف) نشان می‌دهد آهنگ از کدام حساب آمده. خودکار ساخته می‌شود؛ هر کدی اینجا بنویسی جایش می‌نشیند، همه‌جا در پلیر (همهٔ لینک‌ها و اپ اندروید). خالی بگذاری دوباره خودکار می‌شود.</p>
      <div className="space-y-2">
        {accts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0"><AccountBadge account={{ id: a.id, name: a.name }} code={a.code ?? auto.get(a.id) ?? "?"} size={16} textClass="text-sm font-semibold" /></span>
            <span className="flex-1 min-w-0 truncate text-[var(--color-text-dim)]" title={a.name}>{a.name}</span>
            <input value={shown(a)} onChange={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.value.replace(/\s+/g, "").slice(0, 4) }))} onBlur={() => void save(a)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              dir="ltr" maxLength={4} placeholder={auto.get(a.id) ?? "—"} aria-label={`کد ${a.name}`}
              className="w-20 text-center uppercase font-mono text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5" />
          </div>
        ))}
      </div>
    </Section>
  );
}
