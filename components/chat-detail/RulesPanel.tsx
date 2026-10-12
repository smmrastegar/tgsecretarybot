"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActionRow, Note, btnPrimaryCls, inputCls } from "./shared";

type RuleOpt = { id: number; name: string };
type Subscription = {
  id: number;
  name: string;
  description: string;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
};

// Manages which rules this chat is a recipient of. The operator picks any rule from a dropdown to subscribe
// the chat; existing subscriptions show as rows with a ✕ to detach.
export default function RulesPanel({ chatId }: { chatId: number }) {
  const [all, setAll] = useState<RuleOpt[]>([]);
  const [mine, setMine] = useState<Subscription[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([fetch("/api/rules"), fetch(`/api/chats/${chatId}/rules`)]);
    if (r1.ok) {
      const j = (await r1.json()) as { rules: RuleOpt[] };
      setAll(j.rules ?? []);
    }
    if (r2.ok) {
      const j = (await r2.json()) as { rules: Subscription[] };
      setMine(j.rules ?? []);
    }
  }, [chatId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await fetch(`/api/chats/${chatId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: Number(picked) }),
      });
      setPicked("");
      load();
    } finally {
      setBusy(false);
    }
  }, [chatId, picked, load]);

  const remove = useCallback(
    async (ruleId: number) => {
      setBusy(true);
      try {
        await fetch(`/api/chats/${chatId}/rules?ruleId=${ruleId}`, { method: "DELETE" });
        load();
      } finally {
        setBusy(false);
      }
    },
    [chatId, load],
  );

  const available = all.filter((r) => !mine.some((m) => m.id === r.id));

  return (
    <div>
      <div className="text-sm font-semibold leading-6">📐 این چت گیرنده‌ی این rule هاست</div>
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mt-0.5 mb-3">
        وقتی پیامی به یکی از این rule‌ها بخوره، خودکار به این چت فوروارد می‌شه (مگه gate درخواست ست شده باشه که توی پروفایل rule می‌بینی).
      </p>
      {mine.length === 0 ? (
        <Note>هیچ rule‌ای متصل نیست.</Note>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {mine.map((r) => {
            const gated = r.requestTrigger && r.requestTrigger.trim() && r.requestWindowSeconds && r.requestWindowSeconds > 0;
            return (
              <div key={r.id} className="min-h-14 flex items-center gap-2 ps-4 pe-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <a href={`/rules/${r.id}`} className="min-w-0 flex-1 min-h-14 flex items-center justify-center text-sm" dir="auto"><span className="truncate">{r.name}</span></a>
                {gated && <span className="text-amber-300 shrink-0" title={`gate: ${r.requestWindowSeconds}s`}>⏸</span>}
                <button type="button" onClick={() => remove(r.id)} disabled={busy} aria-label={`جدا کردن ${r.name}`}
                  className="shrink-0 w-11 h-11 grid place-items-center rounded-xl text-[var(--color-text-dim)] active:text-red-300 disabled:opacity-50">✕</button>
              </div>
            );
          })}
        </div>
      )}
      {available.length > 0 ? (
        <>
          <select aria-label="انتخاب rule" value={picked} onChange={(e) => setPicked(e.target.value)} className={inputCls}>
            <option value="">— rule رو انتخاب کن —</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <ActionRow>
            <button type="button" onClick={add} disabled={!picked || busy} className={btnPrimaryCls}>+ اضافه</button>
          </ActionRow>
        </>
      ) : all.length > 0 ? (
        <Note>همه‌ی rule‌ها متصل شدن.</Note>
      ) : (
        <Note>
          هنوز rule‌ای نساختی — برو{" "}
          <Link href="/rules" className="underline inline-block py-3 -my-3" dir="ltr">/rules</Link>.
        </Note>
      )}
    </div>
  );
}
