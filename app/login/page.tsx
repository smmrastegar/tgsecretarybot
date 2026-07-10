"use client";

import Script from "next/script";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthUser) => void;
  }
}

type TelegramAuthUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.onTelegramAuth = async (user) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `login failed (${res.status})`);
        }
        router.replace(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPending(false);
      }
    };
    return () => {
      delete window.onTelegramAuth;
    };
  }, [next, router]);

  const botUsername =
    process.env.NEXT_PUBLIC_BOT_USERNAME ?? "smmrchatbot";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
          tgsecretarybot
        </div>
        <h1 className="text-2xl font-semibold mt-1">ورود با تلگرام</h1>
        <p className="text-sm text-[var(--color-text-dim)] mt-3 leading-relaxed">
          از همون اکانت تلگرامی استفاده کن که از طریق Telegram Business →
          Chatbots به ربات وصل کردی. فقط اکانت‌های وصل‌شده به این داشبورد
          دسترسی دارن.
        </p>

        <div ref={widgetRef} className="mt-6 flex justify-center">
          <Script
            src="https://telegram.org/js/telegram-widget.js?22"
            strategy="afterInteractive"
            data-telegram-login={botUsername}
            data-size="large"
            data-onauth="onTelegramAuth(user)"
            data-request-access="write"
            data-userpic="false"
          />
        </div>

        {pending && (
          <p className="text-sm text-[var(--color-text-dim)] mt-4 text-center">
            در حال تأیید…
          </p>
        )}
        {error && (
          <div className="mt-4 p-3 rounded-md bg-red-900/30 border border-red-900 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="mt-6 pt-6 border-t border-[var(--color-border)] text-xs text-[var(--color-text-dim)] leading-relaxed">
          <p className="mb-2 font-medium text-[var(--color-text)]">
            ویجت کار نمی‌کنه؟ به‌جاش از لینک جادویی استفاده کن.
          </p>
          <p>
            تلگرام رو باز کن، به{" "}
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              @{botUsername}
            </a>{" "}
            پیام{" "}
            <code className="bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">/login</code>{" "}
            رو بفرست، و روی لینکی که ربات جواب می‌ده بزن. مشکلات ورود با شماره
            (مثلاً بعضی کشورها / محدودیت‌ها) رو دور می‌زنه.
          </p>
        </div>
      </div>
    </div>
  );
}
