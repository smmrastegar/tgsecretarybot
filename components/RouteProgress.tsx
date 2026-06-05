"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Tiny top-of-window progress bar that animates whenever the URL is
// about to change. Next.js routing in the App Router doesn't fire a
// "routeChangeStart" event we can hook into, but it DOES re-run the
// pathname/searchParams hooks once the new page finishes mounting.
// So we keep a ref to the previous URL and treat any mismatch between
// "user clicked a link" (intercepted at the link level via the
// document's click handler below) and "URL actually changed" as
// in-flight navigation.

export default function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const prevUrl = useRef<string>(`${pathname}?${searchParams?.toString() ?? ""}`);

  // Click on any <a href> or button that triggers navigation kicks off
  // the bar. We can't reliably detect router.push from useRouter, so
  // we intercept clicks at the document level.
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
      // Treat any internal link click as a navigation start. The
      // useEffect below clears it when the path actually changes.
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
      } catch {
        // ignore
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Whenever the pathname or query actually changes, stop the bar
  // — the new page has mounted.
  useEffect(() => {
    const url = `${pathname}?${searchParams?.toString() ?? ""}`;
    if (url !== prevUrl.current) {
      prevUrl.current = url;
      setActive(false);
    }
  }, [pathname, searchParams]);

  if (!active) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 bg-[var(--color-accent)] animate-pulse">
      <div
        className="h-full bg-[var(--color-accent)]/80 animate-[progress_1.2s_ease-in-out_infinite]"
        style={{
          width: "30%",
          animation:
            "progress 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate",
        }}
      />
      <style jsx>{`
        @keyframes progress {
          0% {
            transform: translateX(-100%);
            width: 30%;
          }
          50% {
            width: 70%;
          }
          100% {
            transform: translateX(330%);
            width: 30%;
          }
        }
      `}</style>
    </div>
  );
}
