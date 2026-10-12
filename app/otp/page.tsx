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
  via: string | null;
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
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
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
                body: `${top.via ? `از ${top.via.replace(/^پیامک\s*/, "")} · ` : ""}${cleanSender(top.sender) || "پیامک"} — کلیک = کپی`,
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

  // Touch-sized (>= 40 px) header controls; the page also runs as an installed app / menu-bar companion.
  const ctl = "min-h-10 rounded-xl border border-slate-700 bg-slate-800 text-sm px-3";

  return (
    <div
      dir="rtl"
      style={{ background: "#0f172a", color: "#e2e8f0", minHeight: "100dvh", fontFamily: "Vazirmatn, -apple-system, system-ui, sans-serif" }}
      className="flex flex-col"
    >
      <header className="px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-slate-800">
        <div className="flex items-center justify-between gap-3 flex-wrap max-w-xl mx-auto w-full">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden>🔑</span>
              <h1 className="text-base font-semibold text-slate-100">کدهای یک‌بارمصرف</h1>
            </div>
            <div className="mt-0.5 text-xs text-slate-400 flex items-center gap-1.5">
              <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${error ? "bg-rose-400" : "bg-emerald-400"}`} />
              {error ? "ارتباط قطع است" : "به‌روزرسانی هر ۴ ثانیه"}
              {loaded && items.length > 0 && <span className="ms-2 text-slate-300">{fa(items.length)} کد</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={hours}
              aria-label="بازه‌ی زمانی"
              onChange={(e) => {
                const h = Number(e.target.value);
                setHours(h);
                try { localStorage.setItem("otp.hours", String(h)); } catch {}
              }}
              className={ctl}
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
              className={`${ctl} min-w-10 !px-2`}
              title="صدای دریافت کد"
              aria-label={sound ? "خاموش کردن صدا" : "روشن کردن صدا"}
              aria-pressed={sound}
            >
              {sound ? "🔔" : "🔕"}
            </button>
            {notif === "default" && (
              <button onClick={askNotif} className="min-h-10 px-3 rounded-xl bg-amber-500 text-slate-900 text-sm font-medium">
                فعال‌سازی اعلان
              </button>
            )}
            {notif === "denied" && <span className="text-xs text-rose-300">اعلان‌ها مسدود شده</span>}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-5 gap-5">
        {error && (
          <div role="alert" className="w-full max-w-xl rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-center">
            <div className="text-sm text-rose-200">دریافت کدها ناموفق بود. خودکار دوباره تلاش می‌شود.</div>
            <div className="mt-2 flex justify-center">
              <button onClick={() => void load()} className="min-h-10 px-4 rounded-xl border border-rose-400/50 text-rose-100 text-sm">تلاش دوباره</button>
            </div>
          </div>
        )}
        {!loaded && !error ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">در حال بارگذاری…</div>
        ) : !latest ? (
          !error && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 text-sm gap-2 max-w-xs">
              <div className="text-5xl" aria-hidden>📭</div>
              <div className="font-medium text-slate-300">در {fa(hours)} ساعت گذشته کدی نیامده.</div>
              <div className="text-xs leading-6 text-slate-500">این صفحه باز بمونه؛ اولین کد که بیاد همین‌جا درشت میاد و با یک کلیک کپی می‌شه.</div>
            </div>
          )
        ) : (
          <button
            onClick={() => void copy(latest.code)}
            className="w-full max-w-xl [container-type:inline-size] rounded-3xl bg-slate-800/70 border border-slate-700 hover:border-amber-400 active:scale-[0.99] transition px-4 py-7 text-center shadow-xl"
            title="کلیک = کپی"
          >
            <div className="text-slate-400 text-sm mb-4 leading-6">
              {latest.via ? <span className="text-amber-200">از {latest.via.replace(/^پیامک\s*/, "")} · </span> : null}
              {cleanSender(latest.sender) || "پیامک"} · {ago(latest.at, now)}
            </div>
            <div
              dir="ltr"
              className="font-black tracking-[0.14em] text-amber-300 leading-none select-none whitespace-nowrap"
              // sized from the card's own width and the code length, so 4..8 digits always fit on one line
              style={{ fontSize: `clamp(30px, ${(94 / (Math.max(latest.code.length, 4) * 0.9)).toFixed(1)}cqw, 120px)`, fontVariantNumeric: "tabular-nums" }}
            >
              {latest.code}
            </div>
            <div className="mt-5 inline-flex items-center min-h-10 px-4 rounded-full bg-amber-400/10 text-amber-200 text-sm">کلیک یا Enter = کپی</div>
            {latest.codes.length > 1 && (
              <div className="text-slate-400 text-sm mt-3">کدهای دیگر همین پیام: <span dir="ltr">{latest.codes.slice(1).join("، ")}</span></div>
            )}
          </button>
        )}

        {rest.length > 0 && (
          <div className="w-full max-w-xl grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rest.map((it) => (
              <button
                key={it.id}
                onClick={() => void copy(it.code)}
                className="min-h-[72px] text-center rounded-2xl bg-slate-800/40 border border-slate-800 hover:border-slate-600 active:bg-slate-800 px-4 py-3 transition"
                title={it.text}
              >
                <div dir="ltr" className="font-bold text-2xl tracking-widest text-slate-100" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {it.code}
                </div>
                <div className="text-xs text-slate-400 mt-1 leading-5">
                  <span className="block truncate">{it.via ? `${it.via.replace(/^پیامک\s*/, "")} · ` : ""}{cleanSender(it.sender) || "پیامک"}</span>
                  <span className="block">{ago(it.at, now)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <footer className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs leading-6 text-slate-500 text-center border-t border-slate-800">
        نصب به‌عنوان اپ: Safari ← File ← Add to Dock · Chrome ← آیکون نصب در نوار آدرس
      </footer>

      {toast && (
        <div role="status" className="fixed bottom-[max(2rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-900 font-semibold px-5 py-2.5 rounded-full shadow-lg text-sm">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
