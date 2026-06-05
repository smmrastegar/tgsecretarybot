"use client";

import { useEffect, useState } from "react";

// Floating debug widget that wraps the global fetch and records the
// duration of every API call the current page made. Activated by
// adding ?debug=1 to any URL. Useful for the user to figure out
// "why is this page so slow" and paste the breakdown back.
//
// We also surface Server-Timing values when the backend ships them.

type CallRecord = {
  id: number;
  url: string;
  method: string;
  startedAt: number;
  durationMs: number;
  status: number;
  ok: boolean;
  serverTiming: string | null;
  contentLength: number | null;
};

let nextId = 0;
const records: CallRecord[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function installFetchInterceptor() {
  if (typeof window === "undefined") return;
  if ((window as unknown as { __dbgFetchInstalled?: boolean }).__dbgFetchInstalled)
    return;
  (window as unknown as { __dbgFetchInstalled?: boolean }).__dbgFetchInstalled =
    true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = init?.method ?? "GET";
    const id = ++nextId;
    const startedAt = performance.now();
    try {
      const res = await orig(input, init);
      const durationMs = performance.now() - startedAt;
      const contentLength = res.headers.get("content-length");
      records.unshift({
        id,
        url,
        method,
        startedAt: Date.now(),
        durationMs,
        status: res.status,
        ok: res.ok,
        serverTiming: res.headers.get("server-timing"),
        contentLength: contentLength ? Number(contentLength) : null,
      });
      if (records.length > 50) records.pop();
      notify();
      return res;
    } catch (err) {
      const durationMs = performance.now() - startedAt;
      records.unshift({
        id,
        url,
        method,
        startedAt: Date.now(),
        durationMs,
        status: 0,
        ok: false,
        serverTiming: null,
        contentLength: null,
      });
      notify();
      throw err;
    }
  };
}

export default function DebugTimings() {
  const [enabled, setEnabled] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Activation: ?debug=1 in the URL (one-off) OR a persistent
    // localStorage flag set by the toggle in /settings (admin-only).
    const sp = new URLSearchParams(window.location.search);
    const fromUrl = sp.get("debug") === "1";
    const fromStorage = window.localStorage.getItem("debug") === "1";
    if (fromUrl || fromStorage) {
      installFetchInterceptor();
      setEnabled(true);
      if (fromUrl && !fromStorage) {
        // Sticky once the URL flag landed once.
        window.localStorage.setItem("debug", "1");
      }
    }
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
    // Also react to localStorage changes from other tabs / the
    // settings toggle.
    function onStorage(e: StorageEvent) {
      if (e.key !== "debug") return;
      if (e.newValue === "1") {
        installFetchInterceptor();
        setEnabled(true);
      } else {
        setEnabled(false);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (!enabled) return null;

  const recent = records.slice(0, 30);
  const total = recent.reduce((a, r) => a + r.durationMs, 0);
  const slowest = [...recent].sort((a, b) => b.durationMs - a.durationMs)[0];

  return (
    <div className="fixed bottom-3 right-3 z-[70] max-w-md max-h-[60vh] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-3 text-[10px]">
      <div className="flex items-center justify-between mb-1 sticky top-0 bg-[var(--color-surface)] -mx-3 px-3 pb-1 border-b border-[var(--color-border)]">
        <span className="font-semibold">🔬 Debug timings</span>
        <button
          onClick={() => {
            setEnabled(false);
            if (typeof window !== "undefined") {
              window.localStorage.removeItem("debug");
            }
          }}
          className="text-[var(--color-text-dim)] hover:text-white px-1"
        >
          ✕
        </button>
      </div>
      <div className="text-[9px] text-[var(--color-text-dim)] mb-1">
        {recent.length} fetch · مجموع {total.toFixed(0)}ms · کندترین:{" "}
        {slowest ? `${slowest.durationMs.toFixed(0)}ms (${shortUrl(slowest.url)})` : "—"}
      </div>
      <button
        onClick={() => {
          const text = recent
            .map(
              (r) =>
                `${r.durationMs.toFixed(0).padStart(5)}ms · ${r.method} · ${r.status} · ${shortUrl(r.url)}${r.serverTiming ? ` · st: ${r.serverTiming}` : ""}`,
            )
            .join("\n");
          navigator.clipboard?.writeText(text).catch(() => {});
        }}
        className="text-[9px] mb-1 px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
      >
        📋 کپی برای فرستادن
      </button>
      <div className="flex flex-col gap-0.5 font-mono">
        {recent.map((r) => {
          const tone =
            r.durationMs > 1500
              ? "text-red-300"
              : r.durationMs > 700
                ? "text-amber-300"
                : "text-[var(--color-text-dim)]";
          return (
            <div key={r.id} className="flex items-center gap-1.5">
              <span className={`tabular-nums ${tone}`}>
                {r.durationMs.toFixed(0).padStart(5)}ms
              </span>
              <span className="text-[var(--color-text-dim)]">{r.method}</span>
              <span
                className={
                  r.ok ? "text-emerald-400" : "text-red-400"
                }
              >
                {r.status || "?"}
              </span>
              <span dir="ltr" className="flex-1 truncate" title={r.url}>
                {shortUrl(r.url)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u, "http://x");
    return url.pathname + (url.search ? url.search.slice(0, 50) : "");
  } catch {
    return u.slice(0, 60);
  }
}
