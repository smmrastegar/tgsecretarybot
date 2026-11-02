"use client";

import { useCallback, useEffect, useState } from "react";

// The read-only group bot: which bot it is, whether Telegram lets it see every message, and when it last heard something.
type Info = { username: string; canReadAll: boolean; at: number; error: string | null; groups: number; lastMessageAt: number | null };

const ago = (ms: number | null) => {
  if (!ms) return "هنوز پیامی نگرفته";
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "همین الان" : m < 60 ? `${m} دقیقه پیش` : m < 1440 ? `${Math.round(m / 60)} ساعت پیش` : `${Math.round(m / 1440)} روز پیش`;
};

export default function ReaderBanner() {
  const [st, setSt] = useState<{ on: boolean; info: Info | null; chats: Record<string, { title: string | null; type: string; seenAt: number; ruleId: number | null }>; auto: string | null } | null>(null);
  const [dest, setDest] = useState("Bonak");
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/reader", { cache: "no-store" }); if (r.ok) setSt(await r.json()); }, []);
  useEffect(() => { void load(); const i = setInterval(() => void load(), 30000); return () => clearInterval(i); }, [load]);
  const save = async (t: string) => {
    setErr("");
    const r = await fetch("/api/reader", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) { setErr(j.error ?? "نشد"); return; }
    setToken(""); setOpen(false); await load();
  };
  if (!st) return null;
  const i = st.info;
  return (
    <div className="mb-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-7">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">👁 ربات خواندن گروه‌ها</span>
        {st.on && i ? <span className="text-[var(--color-text-dim)]" dir="ltr">@{i.username}</span> : <span className="text-[var(--color-text-dim)]">خاموش</span>}
        {st.on && i && <span className="text-[var(--color-text-dim)]">· آخرین پیام: {ago(i.lastMessageAt)}</span>}
        <span className="flex-1" />
        <button onClick={() => setOpen(!open)} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] text-xs">{st.on ? "تغییر / خاموش" : "روشن کردن"}</button>
      </div>
      {st.on && i && !i.canReadAll && <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-100 px-3 py-2 text-xs leading-6">حالت «Privacy» این بات روشن است؛ تلگرام فقط دستورها، منشن‌ها و ریپلای به خودش را نشان می‌دهد. برای دیدن همهٔ پیام‌ها: BotFather ← /setprivacy ← انتخاب بات ← Disable، بعد بات را از گروه حذف و دوباره اضافه کن (یا در گروه ادمینش کن).</div>}
      {st.on && i?.error && <div className="mt-2 text-xs text-red-300">خطا: {i.error}</div>}
      {open && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder="توکن بات (از BotFather)" autoComplete="off" className="flex-1 min-w-[12rem] text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 font-mono" />
          <button disabled={!token.trim()} onClick={() => void save(token.trim())} className="px-3 py-2 rounded-md bg-[var(--color-accent)] text-white text-xs disabled:opacity-40">ذخیره</button>
          {st.on && <button onClick={() => void save("")} className="px-3 py-2 rounded-md border border-rose-500/40 text-rose-200 text-xs">خاموش کن</button>}
          {err && <div className="w-full text-xs text-red-300">{err}</div>}
        </div>
      )}
      {st.on && st.auto && <div className="mt-2 text-xs text-emerald-200">⏳ اولین گروهی که بات در آن دیده شود خودکار به ربات تیکت وصل می‌شود (مقصد: {st.auto}).</div>}
      {st.on && Object.keys(st.chats).length > 0 && (
        <div className="mt-3 space-y-2">
          {Object.entries(st.chats).map(([id, c]) => (
            <div key={id} className="flex items-center gap-2 flex-wrap rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs">
              <span className="font-medium">{c.title ?? id}</span>
              <span className="text-[var(--color-text-dim)]">{c.type === "channel" ? "کانال" : "گروه"} · {ago(c.seenAt)}</span>
              <span className="flex-1" />
              {c.ruleId
                ? <><span className="text-emerald-200">✓ فوروارد به ربات تیکت</span><button onClick={async () => { await fetch(`/api/reader/route-chat?chatId=${id}`, { method: "DELETE" }); await load(); }} className="px-2.5 py-1 rounded-md border border-rose-500/40 text-rose-200">قطع</button></>
                : <><input value={dest} onChange={(e) => setDest(e.target.value)} dir="ltr" aria-label="مقصد" className="w-28 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1" />
                    <button onClick={async () => { const r = await fetch("/api/reader/route-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: Number(id), dest }) }); if (!r.ok) setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "نشد"); await load(); }} className="px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white">فوروارد به ربات تیکت</button></>}
            </div>
          ))}
        </div>
      )}
      {st.on && <div className="mt-1 text-xs text-[var(--color-text-dim)]">پیام‌های گروه‌ها و کانال‌هایی که این بات در آن‌هاست، در همین فهرست گروه‌ها و در «پیام‌ها» ثبت می‌شوند. این بات هرگز جواب نمی‌دهد و کاری نمی‌کند، فقط می‌خواند.</div>}
    </div>
  );
}
