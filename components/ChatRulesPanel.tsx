"use client";

import { useCallback, useEffect, useState } from "react";

type Rule = { id: number; name: string };
type Subscription = {
  id: number;
  name: string;
  description: string;
  requestTrigger: string | null;
  requestWindowSeconds: number | null;
};

// Manages which rules this chat is a recipient of. Mounted on
// /chats/[id]. The operator picks any rule from a dropdown to subscribe
// the chat; existing subscriptions show as chips with a ✕ to detach.
export default function ChatRulesPanel({ chatId }: { chatId: number }) {
  const [all, setAll] = useState<Rule[]>([]);
  const [mine, setMine] = useState<Subscription[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch("/api/rules"),
      fetch(`/api/chats/${chatId}/rules`),
    ]);
    if (r1.ok) {
      const j = (await r1.json()) as { rules: Rule[] };
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
        await fetch(`/api/chats/${chatId}/rules?ruleId=${ruleId}`, {
          method: "DELETE",
        });
        load();
      } finally {
        setBusy(false);
      }
    },
    [chatId, load],
  );

  const available = all.filter((r) => !mine.some((m) => m.id === r.id));

  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
      <div className="text-xs font-medium mb-1.5">
        📐 این چت گیرنده‌ی این rule هاست
      </div>
      <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
        وقتی پیامی به یکی از این rule‌ها بخوره، خودکار به این چت فوروارد می‌شه
        (مگه gate درخواست ست شده باشه که توی پروفایل rule می‌بینی).
      </p>
      {mine.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
          هیچ rule‌ای متصل نیست.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {mine.map((r) => {
            const gated =
              r.requestTrigger &&
              r.requestTrigger.trim() &&
              r.requestWindowSeconds &&
              r.requestWindowSeconds > 0;
            return (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)]"
              >
                <a href={`/rules/${r.id}`} className="hover:underline">
                  {r.name}
                </a>
                {gated && (
                  <span
                    className="text-amber-300"
                    title={`gate: ${r.requestWindowSeconds}s`}
                  >
                    ⏸
                  </span>
                )}
                <button
                  onClick={() => remove(r.id)}
                  disabled={busy}
                  className="text-[var(--color-text-dim)] hover:text-red-300 ml-0.5"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}
      {available.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1"
          >
            <option value="">— rule رو انتخاب کن —</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={add}
            disabled={!picked || busy}
            className="text-[11px] px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white disabled:opacity-50"
          >
            + اضافه
          </button>
        </div>
      ) : all.length > 0 ? (
        <p className="text-[10px] text-[var(--color-text-dim)]">
          همه‌ی rule‌ها متصل شدن.
        </p>
      ) : (
        <p className="text-[10px] text-[var(--color-text-dim)]">
          هنوز rule‌ای نساختی — برو{" "}
          <a href="/rules" className="underline">
            /rules
          </a>
          .
        </p>
      )}
    </div>
  );
}
