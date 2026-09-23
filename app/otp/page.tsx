"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// OTP board: the newest verification code huge, one click (or tap, or
// Enter) copies it; the rest listed below. Polls every few seconds and
// fires a desktop notification for each new code. Installable as a
// standalone app from Safari ("Add to Dock") or Chrome ("Install").

type Item = {
  id: string;
  code: string;
  codes: string[];
  sender: string | null;
  text: string;
  at: string;
  source: "sms" | "feed";
};

const fa = (v: number | string) => String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".charAt(Number(d)));

function ago(iso: string, now: number): string {
  const t = Date.parse(iso.replace(" ", "T"));
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${fa(s)} ثانیه پیش`;
  const m = Math.round(s / 60);
  if (m < 60) return `${fa(m)} دقیقه پیش`;
  const h = Math.round(m / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  return `${fa(Math.round(h / 24))} روز پیش`;
}

function cleanSender(s: string | null): string {
  if (!s) return "";
  return s.replace(/^[☎️📨📱\s]+/u, "").trim();
}

async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function OtpBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [now, setNow] = useState(Date.now());
  const [hours, setHours] = useState(24);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notif, setNotif] = useState<NotificationPermission | "unsupported">("default");
  const [sound, setSound] = useState(true);
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    setNotif(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    try {
      const h = Number(localStorage.getItem("otp.hours"));
      if (h > 0) setHours(h);
      setSound(localStorage.getItem("otp.sound") !== "0");
    } catch {}
  }, []);

  const beep = useCallback(() => {
    if (!sound) return;
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.12);
    } catch {}
  }, [sound]);

  const showToast = useCallback((s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(null), 1400);
  }, []);

  const copy = useCallback(
    async (code: string) => {
      const ok = await copyText(code);
      showToast(ok ? `${fa(code)} کپی شد` : "کپی نشد");
    },
    [showToast],
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/otp/recent?hours=${hours}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { items: Item[] };
      const list = j.items ?? [];
      setItems(list);
      setError(null);
      setNow(Date.now());
      if (seen.current == null) {
        seen.current = new Set(list.map((i) => i.id));
      } else {
        const fresh = list.filter((i) => !seen.current!.has(i.id));
        for (const i of fresh) seen.current.add(i.id);
        if (fresh.length > 0) {
          beep();
          const top = fresh[0]!;
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const n = new Notification(top.code, {
                body: `کد از ${cleanSender(top.sender) || "پیامک"} — کلیک = کپی`,
                tag: top.id,
                requireInteraction: true,
                silent: true,
              });
              n.onclick = () => {
                window.focus();
                void copy(top.code);
                n.close();
              };
            } catch {}
          }
        }
      }
    } catch (e) {
      setError(String(e));
    }
  }, [hours, beep, copy]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(tick);
    };
  }, [load]);

  // Enter / Space copies the newest code; Escape clears the toast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && items[0] && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        void copy(items[0].code);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, copy]);

  async function askNotif() {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setNotif(p);
  }

  const latest = items[0];
  const rest = items.slice(1);

  return (
    <div
      dir="rtl"
      style={{ background: "#0f172a", color: "#e2e8f0", minHeight: "100dvh", fontFamily: "Vazirmatn, -apple-system, system-ui, sans-serif" }}
      className="flex flex-col"
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-slate-400 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-base">🔑</span>
          <span className="font-semibold text-slate-200">کدهای یک‌بارمصرف</span>
          <span className="hidden sm:inline">· به‌روزرسانی هر ۴ ثانیه</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => {
              const h = Number(e.target.value);
              setHours(h);
              try { localStorage.setItem("otp.hours", String(h)); } catch {}
            }}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs"
          >
            <option value={1}>۱ ساعت</option>
            <option value={6}>۶ ساعت</option>
            <option value={24}>۲۴ ساعت</option>
            <option value={72}>۳ روز</option>
          </select>
          <button
            onClick={() => {
              setSound((s) => {
                try { localStorage.setItem("otp.sound", s ? "0" : "1"); } catch {}
                return !s;
              });
            }}
            className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800"
            title="صدای دریافت کد"
          >
            {sound ? "🔔" : "🔕"}
          </button>
          {notif === "default" && (
            <button onClick={askNotif} className="px-2 py-1 rounded-md bg-amber-500 text-slate-900 font-medium">
              فعال‌سازی اعلان
            </button>
          )}
          {notif === "denied" && <span className="text-rose-300">اعلان‌ها مسدود شده</span>}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-6 gap-6">
        {error && <div className="text-rose-300 text-sm">{error}</div>}
        {!latest ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
            <div className="text-5xl">📭</div>
            <div>در {fa(hours)} ساعت گذشته کدی نیامده.</div>
            <div className="text-xs">این صفحه باز بمونه؛ اولین کد که بیاد همین‌جا درشت میاد و با یک کلیک کپی می‌شه.</div>
          </div>
        ) : (
          <button
            onClick={() => void copy(latest.code)}
            className="w-full max-w-xl rounded-3xl bg-slate-800/70 border border-slate-700 hover:border-amber-400 active:scale-[0.99] transition px-6 py-8 text-center shadow-xl"
            title="کلیک = کپی"
          >
            <div className="text-slate-400 text-sm mb-3">
              {cleanSender(latest.sender) || "پیامک"} · {ago(latest.at, now)}
            </div>
            <div
              dir="ltr"
              className="font-black tracking-[0.18em] text-amber-300 leading-none select-none"
              style={{ fontSize: "clamp(56px, 14vw, 128px)", fontVariantNumeric: "tabular-nums" }}
            >
              {latest.code}
            </div>
            <div className="text-slate-500 text-xs mt-4">کلیک یا Enter = کپی</div>
            {latest.codes.length > 1 && (
              <div className="text-slate-400 text-xs mt-2">کدهای دیگر همین پیام: {latest.codes.slice(1).join("، ")}</div>
            )}
          </button>
        )}

        {rest.length > 0 && (
          <div className="w-full max-w-xl grid gap-2 sm:grid-cols-2">
            {rest.map((it) => (
              <button
                key={it.id}
                onClick={() => void copy(it.code)}
                className="text-right rounded-2xl bg-slate-800/40 border border-slate-800 hover:border-slate-600 px-4 py-3 transition"
                title={it.text}
              >
                <div dir="ltr" className="font-bold text-2xl tracking-widest text-slate-100 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {it.code}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 flex justify-between gap-2">
                  <span className="truncate">{cleanSender(it.sender) || "پیامک"}</span>
                  <span className="shrink-0">{ago(it.at, now)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className="px-4 py-2 text-[11px] text-slate-500 text-center border-t border-slate-800">
        نصب به‌عنوان اپ: Safari ← File ← Add to Dock · Chrome ← آیکون نصب در نوار آدرس
      </footer>

      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-900 font-semibold px-4 py-2 rounded-full shadow-lg text-sm">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
