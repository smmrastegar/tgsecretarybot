"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Top-of-window navigation indicator. We track pathname only (NOT
// useSearchParams) so this component doesn't trip Next.js's "wrap
// in Suspense for searchParams" requirement and can't crash on
// initial CSR. Clicks on internal links flip the bar on; the
// pathname-change useEffect flips it off once the new page has
// actually mounted.
//
// Multiple clicks during an in-flight navigation simply reset the
// "started at" timestamp — the bar stays on, target chooses the
// last clicked URL.

export default function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const safetyTimer = useRef<number | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (a.target === "_blank") return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
        setActive(true);
        if (safetyTimer.current) window.clearTimeout(safetyTimer.current);
        // Safety net — if the navigation hangs (e.g. mid-render
        // suspend never resolves), drop the bar after 10s so the
        // UI doesn't look stuck forever. The actual pathname-change
        // effect below normally clears it well before that.
        safetyTimer.current = window.setTimeout(() => {
          setActive(false);
        }, 10_000);
      } catch {
        // ignore
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    // Pathname changed → the new page mounted. Drop the bar.
    setActive(false);
    if (safetyTimer.current) {
      window.clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  }, [pathname]);

  if (!active) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 overflow-hidden pointer-events-none">
      <div
        className="h-full bg-[var(--color-accent)] animate-pulse"
        style={{
          width: "100%",
          transform: "translateZ(0)",
        }}
      />
    </div>
  );
}
