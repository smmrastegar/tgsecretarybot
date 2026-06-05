"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";

// Single owner-reference-photo block. The primary UX is file upload —
// the bytes land in owner_assets (BYTEA) and the image-gen path
// prefers them. The advanced "use a URL instead" disclosure stays
// for power users who'd rather host their photo themselves. We
// consciously avoid showing both as peer options in the generic
// settings list because that confused the operator.

export default function OwnerPhotoUploader() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [nonce, setNonce] = useState(0);
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);

  const probe = useCallback(async () => {
    try {
      const r = await fetch(`/api/settings/owner-photo?probe=1&t=${Date.now()}`);
      setHasPhoto(r.ok);
    } catch {
      setHasPhoto(false);
    }
  }, []);

  const loadUrl = useCallback(async () => {
    try {
      const r = await fetch("/api/settings");
      if (!r.ok) return;
      const j = (await r.json()) as { values?: { ownerPhotoUrl?: string } };
      setUrl(j.values?.ownerPhotoUrl ?? "");
    } catch {}
  }, []);

  useEffect(() => {
    probe();
    loadUrl();
  }, [probe, loadUrl]);

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
    if (!confirm("عکس آپلودی پاک بشه؟")) return;
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

  const saveUrl = useCallback(async () => {
    setSavingUrl(true);
    setErr(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerPhotoUrl: url }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save failed (${r.status})`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingUrl(false);
    }
  }, [url]);

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-1">
        🖼 Owner reference photo (تولید عکس AI)
      </h2>
      <p className="text-[11px] text-[var(--color-text-dim)] mb-3">
        عکس مرجع تو که AI به‌عنوان «همون آدم» توی تولید عکس‌ها استفاده می‌کنه.
        وقتی کسی توی چت ai_chat (با تیک «🖼 تولید عکس من») ازت عکس خواست،
        Gemini با این عکس به‌عنوان anchor یه عکس تازه می‌سازه. حداکثر 5MB.
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
          {err && <div className="text-[11px] text-red-300">{err}</div>}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setUrlMode((v) => !v)}
          className="text-[10px] text-[var(--color-text-dim)] hover:text-white"
        >
          {urlMode ? "▾ روش URL" : "▸ یا اگه ترجیح می‌دی URL بدی…"}
        </button>
        {urlMode && (
          <div className="mt-2">
            <p className="text-[10px] text-[var(--color-text-dim)] mb-2">
              اگه آپلود کنی این فیلد نادیده گرفته می‌شه — آپلود همیشه اولویت داره.
            </p>
            <div className="flex gap-2 items-center flex-wrap">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/me.jpg"
                className="flex-1 min-w-[200px] text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-2 py-1.5"
              />
              <button
                type="button"
                onClick={saveUrl}
                disabled={savingUrl}
                className="text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
              >
                {savingUrl ? "…" : "ذخیره URL"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
