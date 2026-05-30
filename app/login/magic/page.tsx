"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function MagicLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  useEffect(() => {
    if (token && !autoSubmitted) {
      setAutoSubmitted(true);
      void confirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function confirm() {
    if (!token) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `failed (${res.status})`);
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
          tgsecretarybot
        </div>
        <h1 className="text-2xl font-semibold mt-1">Confirm login</h1>
        <p className="text-sm text-[var(--color-text-dim)] mt-3 leading-relaxed">
          {token
            ? "Verifying your one-time link from Telegram…"
            : "No token in URL. Send /login to the bot to get a fresh link."}
        </p>

        {error && (
          <div className="mt-5 p-3 rounded-md bg-red-900/30 border border-red-900 text-sm text-red-300">
            {error}
          </div>
        )}

        {token && !pending && error && (
          <button
            onClick={confirm}
            className="mt-5 w-full px-4 py-2 rounded-md bg-[var(--color-accent)] text-white"
          >
            Try again
          </button>
        )}

        {pending && (
          <p className="mt-5 text-sm text-[var(--color-text-dim)] text-center">
            signing you in…
          </p>
        )}

        <div className="mt-8 text-xs text-[var(--color-text-dim)] leading-relaxed">
          Magic links are valid for 5 minutes and one use only.
        </div>
      </div>
    </div>
  );
}
