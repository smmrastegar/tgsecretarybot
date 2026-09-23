"use client";

import { useEffect, useState } from "react";

// One button: mints/reuses the OtpBar token and hands it to the app via
// the otpbar:// scheme. The token is shown as a fallback for copying.
export default function OtpPairPage() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [base, setBase] = useState<string>("");
  const [auto, setAuto] = useState(false);

  async function pair() {
    setState("busy");
    setErr(null);
    try {
      const r = await fetch("/api/otp/pair", { method: "POST" });
      const j = (await r.json()) as { token?: string; base?: string; error?: string };
      if (!r.ok || !j.token) throw new Error(j.error ?? `HTTP ${r.status}`);
      setToken(j.token);
      setBase(j.base ?? "");
      setState("done");
      window.location.href = `otpbar://pair?base=${encodeURIComponent(j.base ?? "")}&token=${encodeURIComponent(j.token)}`;
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auto") === "1") {
      setAuto(true);
      void pair();
    }
  }, []);

  return (
    <div dir="rtl" style={{ background: "#0f172a", color: "#e2e8f0", minHeight: "100dvh" }} className="flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl bg-slate-800/70 border border-slate-700 p-6 text-center space-y-4">
        <div className="text-5xl">🔑</div>
        <h1 className="text-xl font-semibold">اتصال OtpBar به این حساب</h1>
        <p className="text-sm text-slate-400">
          با زدن دکمه، یک کلید اختصاصی برای اپ منوبار ساخته و مستقیم به اپ داده می‌شود. چیزی لازم نیست کپی کنی.
        </p>
        {state !== "done" && (
          <button
            onClick={pair}
            disabled={state === "busy"}
            className="w-full py-3 rounded-2xl bg-amber-500 text-slate-900 font-bold text-lg disabled:opacity-50"
          >
            {state === "busy" ? "در حال اتصال…" : auto ? "دوباره وصل کن" : "اتصال OtpBar"}
          </button>
        )}
        {state === "done" && (
          <div className="space-y-3">
            <div className="text-emerald-300 font-medium">✓ کلید به اپ فرستاده شد. اگر مک پرسید «Open OtpBar?» تأیید کن.</div>
            <button onClick={pair} className="text-xs text-slate-400 underline">دوباره بفرست</button>
            <details className="text-xs text-slate-400">
              <summary>اگر خودکار وصل نشد</summary>
              <div className="mt-2 text-right space-y-1">
                <div>در اپ: راست‌کلیک روی 🔑 ← تنظیمات… و این دو را وارد کن:</div>
                <div dir="ltr" className="font-mono break-all bg-slate-900 rounded p-2">{base}</div>
                <div dir="ltr" className="font-mono break-all bg-slate-900 rounded p-2 select-all">{token}</div>
              </div>
            </details>
          </div>
        )}
        {err && <div className="text-rose-300 text-sm">{err}</div>}
      </div>
    </div>
  );
}
