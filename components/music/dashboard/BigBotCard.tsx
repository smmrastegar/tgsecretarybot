"use client";

import { useCallback, useEffect, useState } from "react";
import Section, { Pill } from "./Section";

// Files over 20 MB: a second bot + Telegram's local Bot API server. The secrets are typed here once; they are stored on the server and never shown again.
type St = { has: { apiId: boolean; apiHash: boolean; token: boolean }; apiId: string; localServer: boolean; bot: { username: string } | null; setupStatus: string };
const field = "w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3";
const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] disabled:opacity-50";

export default function BigBotCard() {
  const [st, setSt] = useState<St | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/music/bigbot", { cache: "no-store" });
    if (r.ok) { const j = (await r.json()) as St; setSt(j); setApiId((v) => v || j.apiId); } else if (r.status === 401 || r.status === 403) setDenied(true);
  }, []);
  useEffect(() => { void load(); const i = setInterval(() => void load(), 20000); return () => clearInterval(i); }, [load]);
  if (denied || !st) return null;
  const complete = st.has.apiId && st.has.apiHash && st.has.token;
  const state = !complete ? "تنظیم نشده" : st.localServer ? (st.bot ? `فعال — @${st.bot.username}` : "سرور محلی بالاست؛ توکن بات را بررسی کن") : "در حال ساخت سرور محلی…";
  async function save() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/music/bigbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiId, apiHash, token }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (r.ok) { setApiHash(""); setToken(""); setNote("ذخیره شد. تا چند دقیقهٔ دیگر ساخت سرور محلی شروع می‌شود (حدود ۲۰ تا ۶۰ دقیقه)."); void load(); } else setNote(j.error ?? "ذخیره نشد");
    } catch { setNote("اتصال برقرار نشد"); }
    setBusy(false);
  }
  return (
    <Section icon="📦" title="فایل‌های حجیم (بیشتر از ۲۰MB)" summary={state} badge={complete && st.localServer && st.bot ? <Pill tone="ok">فعال</Pill> : complete ? <Pill tone="warn">در حال راه‌اندازی</Pill> : undefined}>
      <div className="space-y-3 text-xs leading-6 text-[var(--color-text-dim)]">
        <p>ربات تلگرام فقط تا ۲۰MB فایل می‌گیرد. برای فایل‌های بزرگ‌تر یک بات دوم (ادمین کانال My Music) از طریق سرور محلی Bot API کار می‌کند. هر سه مقدار را یک بار اینجا بزن؛ ذخیره می‌شوند و دوباره نمایش داده نمی‌شوند.</p>
        <ol className="list-decimal pr-5 space-y-1">
          <li><b>api_id</b> و <b>api_hash</b>: در my.telegram.org ← API development tools (بعد از ساخت اپ، همان صفحه نشان می‌دهد).</li>
          <li><b>توکن بات دوم</b>: از BotFather؛ این بات را ادمین کانال My Music کن (حق پاک‌کردن پیام لازم نیست).</li>
        </ol>
      </div>
      <div className="mt-3 space-y-2">
        <input dir="ltr" inputMode="numeric" value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="api_id (عدد)" aria-label="api_id" className={field} />
        <input dir="ltr" type="password" autoComplete="off" value={apiHash} onChange={(e) => setApiHash(e.target.value)} placeholder={st.has.apiHash ? "api_hash ذخیره شده — برای تغییر دوباره بزن" : "api_hash (۳۲ حرف)"} aria-label="api_hash" className={field} />
        <input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={st.has.token ? "توکن بات ذخیره شده — برای تغییر دوباره بزن" : "توکن بات دوم"} aria-label="bot token" className={field} />
        <div className="flex justify-end"><button onClick={() => void save()} disabled={busy || !(apiId || apiHash || token)} className={btn}>{busy ? "…" : "ذخیره"}</button></div>
      </div>
      {note && <div role="status" className="mt-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs leading-6">{note}</div>}
      {st.setupStatus && <p dir="ltr" className="mt-2 text-[11px] text-[var(--color-text-dim)] break-words">{st.setupStatus}</p>}
    </Section>
  );
}
