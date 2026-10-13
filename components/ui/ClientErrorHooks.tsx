"use client";

import { useEffect } from "react";
import { reportClient } from "@/lib/client-report";

/** Reports uncaught errors and unhandled promise rejections from this page (mounted once in the root layout). */
export default function ClientErrorHooks() {
  useEffect(() => { // the Android app stores a native crash and hands it over on the next start
    try { const c = (window as unknown as { AndroidMusic?: { lastCrash?: () => string } }).AndroidMusic?.lastCrash?.(); if (c) reportClient("android-crash", c.split("\n")[0] || "native crash", c.slice(0, 600)); } catch { /* old app */ }
  }, []);
  useEffect(() => {
    const onError = (ev: ErrorEvent) => { if (ev.error || ev.message) reportClient("window.onerror", ev.error ?? ev.message, ev.filename ? `${ev.filename}:${ev.lineno}` : undefined); };
    const onRejection = (ev: PromiseRejectionEvent) => reportClient("unhandledrejection", ev.reason ?? "unhandled rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
