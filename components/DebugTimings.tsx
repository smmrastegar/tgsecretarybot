"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Floating debug widget that wraps the global fetch and records the
// duration of every API call the current page made. Toggled by the
// admin-only switch on /settings (sticky via localStorage) or by
// adding ?debug=1 to any URL (one-off).
//
// Draggable by the header bar; remembers position + minimised state
// across reloads in localStorage. ✕ closes (and clears the global
// debug flag); — minimises to a small pill that re-expands on click.

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

type Pos = { x: number; y: number };

function loadPos(): Pos | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("debug.pos");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Pos;
    if (typeof j.x === "number" && typeof j.y === "number") return j;
  } catch {}
  return null;
}

function savePos(p: Pos) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("debug.pos", JSON.stringify(p));
}

function loadMinimised(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("debug.min") === "1";
}

function saveMinimised(v: boolean) {
  if (typeof window === "undefined") return;
  if (v) window.localStorage.setItem("debug.min", "1");
  else window.localStorage.removeItem("debug.min");
}

export default function DebugTimings() {
  const [enabled, setEnabled] = useState(false);
  const [, setTick] = useState(0);
  const [pos, setPos] = useState<Pos | null>(null);
  const [minimised, setMinimised] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const fromUrl = sp.get("debug") === "1";
    const fromStorage = window.localStorage.getItem("debug") === "1";
    if (fromUrl || fromStorage) {
      installFetchInterceptor();
      setEnabled(true);
      if (fromUrl && !fromStorage) {
        window.localStorage.setItem("debug", "1");
      }
    }
    setPos(loadPos());
    setMinimised(loadMinimised());
    const cb = () => setTick((t) => t + 1);
    listeners.add(cb);
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

  // Drag handlers. Use pointerdown/move/up so it works on touch + mouse.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't start a drag if the user clicked one of the header buttons.
      const target = e.target as HTMLElement;
      if (target.closest("button")) return;
      e.preventDefault();
      const rect = widgetRef.current?.getBoundingClientRect();
      const origX =
        pos?.x ?? (rect ? window.innerWidth - rect.right + rect.width : 12);
      const origY =
        pos?.y ?? (rect ? window.innerHeight - rect.bottom + rect.height : 12);
      // Switch from bottom/right anchoring to top/left on first drag.
      const startLeft = rect ? rect.left : window.innerWidth - origX;
      const startTop = rect ? rect.top : window.innerHeight - origY;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: startLeft,
        origY: startTop,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [pos],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const rect = widgetRef.current?.getBoundingClientRect();
      const w = rect?.width ?? 320;
      const h = rect?.height ?? 60;
      const nx = Math.max(0, Math.min(window.innerWidth - w, d.origX + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - h, d.origY + dy));
      setPos({ x: nx, y: ny });
    },
    [],
  );
  const onPointerUp = useCallback(() => {
    if (dragRef.current && pos) savePos(pos);
    dragRef.current = null;
  }, [pos]);

  if (!enabled) return null;

  const recent = records.slice(0, 30);
  const total = recent.reduce((a, r) => a + r.durationMs, 0);
  const slowest = [...recent].sort((a, b) => b.durationMs - a.durationMs)[0];

  // Style: when we have a saved position, use top/left. Otherwise
  // anchor to bottom-right.
  const positionStyle: React.CSSProperties = pos
    ? { top: pos.y, left: pos.x, right: "auto", bottom: "auto" }
    : { bottom: 12, right: 12 };

  if (minimised) {
    return (
      <div
        ref={widgetRef}
        style={{ ...positionStyle, position: "fixed", zIndex: 70 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="cursor-grab active:cursor-grabbing select-none flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg text-[10px]"
      >
        <span
          className={
            slowest && slowest.durationMs > 1500
              ? "text-red-300"
              : slowest && slowest.durationMs > 700
                ? "text-amber-300"
                : "text-emerald-300"
          }
        >
          🔬
        </span>
        <span className="tabular-nums">
          {recent.length} · {total.toFixed(0)}ms
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMinimised(false);
            saveMinimised(false);
          }}
          className="text-[var(--color-text-dim)] hover:text-white"
          aria-label="expand"
        >
          🗖
        </button>
      </div>
    );
  }

  return (
    <div
      ref={widgetRef}
      style={{
        ...positionStyle,
        position: "fixed",
        zIndex: 70,
        width: 360,
        maxWidth: "calc(100vw - 24px)",
      }}
      className="max-h-[60vh] overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-3 text-[10px]"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center justify-between mb-1 sticky top-0 bg-[var(--color-surface)] -mx-3 -mt-3 px-3 pt-3 pb-1 border-b border-[var(--color-border)] cursor-grab active:cursor-grabbing select-none"
      >
        <span className="font-semibold">🔬 Debug timings</span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMinimised(true);
              saveMinimised(true);
            }}
            aria-label="minimise"
            className="text-[var(--color-text-dim)] hover:text-white px-1"
          >
            ━
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEnabled(false);
              if (typeof window !== "undefined") {
                window.localStorage.removeItem("debug");
              }
            }}
            aria-label="close"
            className="text-[var(--color-text-dim)] hover:text-white px-1"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="text-[9px] text-[var(--color-text-dim)] mt-2 mb-1">
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
