"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";

// Uploader for the operator's reference photo used by ai_generate_photo.
// The file lives in owner_assets (BYTEA) — no URL hosting required.
// Preview re-loads from /api/settings/owner-photo with a cache-bust
// nonce so a fresh upload shows immediately.

export default function OwnerPhotoUploader() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [nonce, setNonce] = useState(0);
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const probe = useCallback(async () => {
    try {
      const r = await fetch(`/api/settings/owner-photo?probe=1&t=${Date.now()}`);
      setHasPhoto(r.ok);
    } catch {
      setHasPhoto(false);
    }
  }, []);

  useEffect(() => {
    probe();
  }, [probe]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setErr(null);
      try {
        const form = new FormData();
        form.append("photo", file);
        const r = await fetch("/api/settings/owner-photo", {
          method: "POST",
          body: form,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `upload failed (${r.status})`);
        }
        setNonce((n) => n + 1);
        setHasPhoto(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void upload(f);
      e.target.value = "";
    },
    [upload],
  );

  const remove = useCallback(async () => {
    if (!confirm("عکس پاک بشه؟")) return;
    setBusy(true);
    setErr(null);
    try {
      await fetch("/api/settings/owner-photo", { method: "DELETE" });
      setHasPhoto(false);
      setNonce((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-1">
        🖼 Owner reference photo (تولید عکس AI)
      </h2>
      <p className="text-[11px] text-[var(--color-text-dim)] mb-3">
        عکس مرجع تو رو که AI به‌عنوان «همون آدم» توی تولید عکس‌ها استفاده
        می‌کنه. هرجا کسی توی چت ai_chat (با تیک «🖼 تولید عکس من») ازت
        عکس خواست، Gemini با این عکس به‌عنوان anchor یه عکس تازه می‌سازه.
        حداکثر 5MB. نیازی به URL عمومی نیست — همینجا آپلود می‌شه.
      </p>
      <div className="flex items-start gap-3 flex-wrap">
        {hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/settings/owner-photo?t=${nonce}`}
            alt="owner reference"
            className="w-24 h-24 rounded-md object-cover border border-[var(--color-border)] bg-[var(--color-surface-2)]"
          />
        ) : (
          <div className="w-24 h-24 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center justify-center text-[10px] text-[var(--color-text-dim)]">
            (هنوز ست نشده)
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="hidden"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "در حال آپلود…" : hasPhoto ? "تعویض عکس" : "آپلود عکس"}
            </button>
            {hasPhoto && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                پاک کن
              </button>
            )}
          </div>
          {err && (
            <div className="text-[11px] text-red-300">{err}</div>
          )}
          <div className="text-[10px] text-[var(--color-text-dim)]">
            یا اگه ترجیح می‌دی URL بدی، فیلد «Owner photo URL» پایین رو
            پر کن — آپلود اولویت داره.
          </div>
        </div>
      </div>
    </Card>
  );
}
