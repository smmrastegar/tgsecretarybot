"use client";

// Browser-side error reporting: whatever crashes on a phone ends up in the System Log (source "client").
// Quiet by design: at most 8 reports per page load, the same error only once, and it never throws.
const seen = new Set<string>();
let sent = 0;

export function reportClient(kind: string, error: unknown, extra?: string): void {
  try {
    if (sent >= 8) return;
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })());
    const key = `${kind}|${e.message}|${(e.stack ?? "").split("\n")[1] ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key); sent++;
    const body = JSON.stringify({ kind, message: e.message.slice(0, 500), stack: (extra && kind === "android-crash" ? extra : e.stack ?? "").slice(0, 1800), path: location.pathname.replace(/\/player\/[^/]+/, "/player/<token>").slice(0, 120), extra: extra?.slice(0, 200), ua: navigator.userAgent.slice(0, 160), online: navigator.onLine });
    if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }))) void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* reporting must never break the page */ }
}
