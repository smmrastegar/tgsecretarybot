"use client";

import { useCallback, useEffect, useState } from "react";

// Admin-only toggle that flips the debug overlay on/off persistently
// via localStorage. The DebugTimings widget listens for the storage
// change in the same tab through a custom event we fire here.
// Non-admins see nothing — the whole card is hidden.

export default function DebugModeToggle() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { admin?: boolean } | null) => {
        if (cancelled) return;
        setIsAdmin(!!j?.admin);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnabled(window.localStorage.getItem("debug") === "1");
  }, []);

  const toggle = useCallback(() => {
    if (typeof window === "undefined") return;
    if (enabled) {
      window.localStorage.removeItem("debug");
      setEnabled(false);
      // Re-dispatch a storage event for the in-tab DebugTimings
      // listener (the StorageEvent only fires across tabs, so we
      // fake one).
      window.dispatchEvent(
        new StorageEvent("storage", { key: "debug", newValue: null }),
      );
    } else {
      window.localStorage.setItem("debug", "1");
      setEnabled(true);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "debug", newValue: "1" }),
      );
    }
  }, [enabled]);

  if (isAdmin !== true) return null;

  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold mb-1">🔬 حالت Debug (ادمین)</h2>
      <p className="text-[11px] text-[var(--color-text-dim)] mb-2">
        وقتی روشن باشه، widget شناور پایین-راست هر fetch روی صفحه رو با
        duration و status نشون می‌ده. تا زمانی که خاموش نکنی روشن می‌مونه
        (توی localStorage). برای ادمین‌ها فقط ظاهر می‌شه.
      </p>
      <button
        onClick={toggle}
        className={`text-xs px-3 py-1.5 rounded-md border ${
          enabled
            ? "border-emerald-700 bg-emerald-900/30 text-emerald-300"
            : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
        }`}
      >
        {enabled ? "🟢 Debug روشنه — کلیک کن خاموش بشه" : "⚫ Debug خاموش — کلیک کن روشن بشه"}
      </button>
    </section>
  );
}
