"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog } from "@/components/ui/Dialogs";

// Single owner-reference-photo block. The primary UX is file upload —
// the bytes land in owner_assets (BYTEA) and the image-gen path
// prefers them. The advanced "use a URL instead" disclosure stays
// for power users who'd rather host their photo themselves. We
// consciously avoid showing both as peer options in the generic
// settings list because that confused the operator.
// Rendered inside a Section of the settings page (which supplies the title), so it has no card of its own.

const btn = "min-h-11 px-4 rounded-xl border border-[var(--color-border)] text-sm active:bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)] disabled:opacity-50";

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
    if (!(await confirmDialog("عکس آپلودی پاک بشه؟", { danger: true, confirmLabel: "پاک کن" }))) return;
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
    <div>
      <h3 className="text-sm font-semibold mb-1">🖼 عکس مرجع صاحب (تولید عکس AI)</h3>
      <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-3">
        عکس مرجع تو که AI به‌عنوان «همون آدم» توی تولید عکس‌ها استفاده می‌کنه.
        وقتی کسی توی چت ai_chat (با تیک «🖼 تولید عکس من») ازت عکس خواست،
        Gemini با این عکس به‌عنوان anchor یه عکس تازه می‌سازه. حداکثر 5MB.
      </p>
      <div className="flex justify-center mb-3">
        {hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/settings/owner-photo?t=${nonce}`}
            alt="عکس مرجع صاحب"
            className="w-28 h-28 rounded-2xl object-cover border border-[var(--color-border)] bg-[var(--color-surface-2)]"
          />
        ) : (
          <div className="w-28 h-28 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center justify-center text-xs text-[var(--color-text-dim)]">
            (هنوز ست نشده)
          </div>
        )}
      </div>
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
          className="min-h-11 px-5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "در حال آپلود…" : hasPhoto ? "تعویض عکس" : "آپلود عکس"}
        </button>
        {hasPhoto && (
          <button type="button" onClick={remove} disabled={busy} className={btn}>
            پاک کن
          </button>
        )}
      </div>
      {err && <div className="mt-2 text-xs leading-5 text-red-300">{err}</div>}

      <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setUrlMode((v) => !v)}
          aria-expanded={urlMode}
          className="min-h-11 px-3 text-xs text-[var(--color-text-dim)] hover:text-white"
        >
          {urlMode ? "▾ روش URL" : "▸ یا اگه ترجیح می‌دی URL بدی…"}
        </button>
        {urlMode && (
          <div className="mt-1">
            <p className="text-xs leading-6 text-[var(--color-text-dim)] mb-2">
              اگه آپلود کنی این فیلد نادیده گرفته می‌شه — آپلود همیشه اولویت داره.
            </p>
            <input
              type="text"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/me.jpg"
              aria-label="آدرس عکس"
              className="w-full min-h-11 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl px-3 mb-2"
            />
            <div className="flex gap-2">
              <button type="button" onClick={saveUrl} disabled={savingUrl} className={btn}>
                {savingUrl ? "…" : "ذخیره URL"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
