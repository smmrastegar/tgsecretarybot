"use client";

import Script from "next/script";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthUser) => void;
  }
}

type TelegramAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  // Numeric password: the way in on playlist.bz (also reachable anywhere with ?pin=1).
  const [pinMode, setPinMode] = useState<boolean | null>(null); // null until the host is known (so the Telegram widget never loads on playlist.bz)
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  useEffect(() => { setPinMode(/(^|\.)playlist\.bz$/.test(window.location.hostname) || params.get("pin") === "1"); }, [params]);
  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setPinBusy(true);
    try {
      const r = await fetch("/api/auth/pin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? `خطا (${r.status})`);
      router.replace(next === "/" ? "/music" : next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setPinBusy(false); setPin("");
    }
  }

  // "Login with Telegram" button: open the bot with a one-time start link, then poll.
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "expired">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [left, setLeft] = useState(300);
  const nonce = useRef<string | null>(null);
  const deadline = useRef(0);

  async function startTelegram() {
    setError(null); setPhase("starting");
    // Open a tab synchronously (keeps the click's permission), point it at Telegram once we have the link.
    const tab = window.open("", "_blank");
    try {
      const r = await fetch("/api/auth/tg-start", { method: "POST" });
      const d = (await r.json()) as { nonce?: string; url?: string; error?: string; expiresIn?: number };
      if (!r.ok || !d.nonce || !d.url) throw new Error(d.error ?? `خطا (${r.status})`);
      nonce.current = d.nonce; setLink(d.url);
      deadline.current = Date.now() + (d.expiresIn ?? 300) * 1000; setLeft(d.expiresIn ?? 300);
      if (tab) tab.location.href = d.url; else window.location.href = d.url;
      setPhase("waiting");
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : String(err)); setPhase("idle");
    }
  }

  useEffect(() => {
    if (phase !== "waiting") return;
    let stop = false;
    const tick = async () => {
      if (stop || !nonce.current) return;
      const secs = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) { setPhase("expired"); return; }
      try {
        const r = await fetch(`/api/auth/tg-poll?nonce=${encodeURIComponent(nonce.current)}`, { cache: "no-store" });
        const d = (await r.json()) as { status?: string };
        if (d.status === "ok") { stop = true; router.replace(next); return; }
        if (d.status === "expired" || d.status === "unknown") { setPhase("expired"); return; }
      } catch { /* offline for a moment: keep trying */ }
    };
    const i = setInterval(() => void tick(), 1500);
    const vis = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(i); document.removeEventListener("visibilitychange", vis); };
  }, [phase, next, router]);

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `login failed (${res.status})`);
        }
        router.replace(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPending(false);
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, [next, router]);

  const botUsername =
    process.env.NEXT_PUBLIC_BOT_USERNAME ?? "smmrchatbot";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
          tgsecretarybot
        </div>
        {pinMode && (
          <form onSubmit={(e) => void submitPin(e)} className="mt-3 mb-8">
            <h1 className="text-2xl font-semibold">ورود به پلیر</h1>
            <p className="text-sm text-[var(--color-text-dim)] mt-2">رمز عددی‌ات را بزن.</p>
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" pattern="[0-9]*" autoComplete="current-password" autoFocus dir="ltr" aria-label="رمز عددی" placeholder="••••••"
              className="mt-4 w-full h-14 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] px-4 text-center text-2xl tracking-[0.4em] tabular-nums" />
            <button type="submit" disabled={pinBusy || pin.length < 6} className="mt-3 w-full h-12 rounded-xl bg-[#2AABEE] text-white font-semibold disabled:opacity-50">{pinBusy ? "…" : "ورود"}</button>
            <div className="mt-6 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-dim)]">یا با تلگرام (داشبورد کامل روی دامنهٔ اصلی):</div>
          </form>
        )}
        <h1 className="text-2xl font-semibold mt-1">ورود با تلگرام</h1>
        <p className="text-sm text-[var(--color-text-dim)] mt-3 leading-relaxed">
          از همون اکانت تلگرامی استفاده کن که از طریق Telegram Business →
          Chatbots به ربات وصل کردی. فقط اکانت‌های وصل‌شده به این داشبورد
          دسترسی دارن.
        </p>

        {phase === "waiting" ? (
          <div className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm leading-7">
            <div className="flex items-center gap-3 font-medium">
              <span className="inline-block w-4 h-4 rounded-full border-2 border-[#2AABEE] border-t-transparent animate-spin" aria-hidden />
              منتظر تأیید در تلگرام…
              <span className="ms-auto tabular-nums text-[var(--color-text-dim)]" dir="ltr">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
            </div>
            <ol className="mt-3 list-decimal ps-5 text-[var(--color-text-dim)]">
              <li>تلگرام باز می‌شه و چت ربات رو نشون می‌ده.</li>
              <li>روی <b className="text-[var(--color-text)]">Start</b> بزن.</li>
              <li>برگرد همین‌جا؛ خودکار وارد می‌شی.</li>
            </ol>
            <div className="mt-4 flex gap-2">
              {link && <a href={link} target="_blank" rel="noreferrer" className="flex-1 text-center py-2.5 rounded-lg bg-[#2AABEE] text-white font-medium">باز کردن دوباره تلگرام</a>}
              <button onClick={() => { setPhase("idle"); nonce.current = null; }} className="px-4 py-2.5 rounded-lg border border-[var(--color-border)]">انصراف</button>
            </div>
          </div>
        ) : (
          <>
            <button onClick={() => void startTelegram()} disabled={phase === "starting" || pending}
              className="mt-6 w-full h-14 rounded-xl bg-[#2AABEE] hover:bg-[#229ED9] active:scale-[.99] transition text-white text-base font-semibold inline-flex items-center justify-center gap-3 disabled:opacity-60">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M21.4 3.6 2.9 10.7c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8L22.8 5c.3-1.3-.5-1.9-1.4-1.4ZM8.2 13l9.9-6.2c.5-.3.9-.1.5.2l-8.1 7.3-.3 3.4-2-4.7Z"/></svg>
              {phase === "starting" ? "در حال آماده‌سازی…" : phase === "expired" ? "زمان تمام شد؛ دوباره تلاش کن" : "ورود با تلگرام"}
            </button>
            <p className="mt-2 text-xs text-center text-[var(--color-text-dim)]">فقط یک بار Start بزن؛ بدون کد و بدون شماره.</p>
          </>
        )}

        {pinMode === false && (
        <details className="mt-6 text-xs text-[var(--color-text-dim)]">
          <summary className="cursor-pointer select-none">روش‌های دیگر ورود</summary>
          <div ref={widgetRef} className="mt-4 flex justify-center">
            <Script
              src="https://telegram.org/js/telegram-widget.js?22"
              strategy="afterInteractive"
              data-telegram-login={botUsername}
              data-size="large"
              data-onauth="onTelegramAuth(user)"
              data-request-access="write"
              data-userpic="false"
            />
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-dim)] leading-relaxed">
          <p className="mb-2 font-medium text-[var(--color-text)]">
            ویجت کار نمی‌کنه؟ به‌جاش از لینک جادویی استفاده کن.
          </p>
          <p>
            تلگرام رو باز کن، به{" "}
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              @{botUsername}
            </a>{" "}
            پیام{" "}
            <code className="bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">/login</code>{" "}
            رو بفرست، و روی لینکی که ربات جواب می‌ده بزن. مشکلات ورود با شماره
            (مثلاً بعضی کشورها / محدودیت‌ها) رو دور می‌زنه.
          </p>
        </div>
        </details>
        )}

        {pending && (
          <p className="text-sm text-[var(--color-text-dim)] mt-4 text-center">
            در حال تأیید…
          </p>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-md bg-red-900/30 border border-red-900 text-sm text-red-300">
            {error}
          </div>
        )}


      </div>
    </div>
  );
}
