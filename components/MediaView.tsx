"use client";

import { useState } from "react";

// Renders the actual media for a logged message by streaming it from
// /api/messages/[id]/media. We lazy-load (a button → fetch) so opening
// a long chat doesn't hammer Telegram's getFile for every photo at
// once. Once opened, the media stays visible until the operator
// dismisses it with ✕ — that way you can scroll past and come back
// without re-fetching.
const IMAGE_KINDS = new Set(["photo", "sticker"]);
const VIDEO_KINDS = new Set(["video", "video_note", "animation"]);
const AUDIO_KINDS = new Set(["voice", "audio"]);

type LoadState = "idle" | "loading" | "loaded" | "error";

export default function MediaView({
  messageId,
  kind,
}: {
  messageId: number;
  kind: string | null;
}) {
  const [state, setState] = useState<LoadState>("idle");
  // Cache-buster so retry forces a fresh load on the <img>/<video>/<audio>.
  const [nonce, setNonce] = useState(0);
  if (!kind) return null;

  const src = `/api/messages/${messageId}/media${nonce > 0 ? `?n=${nonce}` : ""}`;
  const downloadSrc = `/api/messages/${messageId}/media?download=1`;

  const isImage = IMAGE_KINDS.has(kind);
  const isSticker = kind === "sticker";
  const isVideo = VIDEO_KINDS.has(kind);
  const isAudio = AUDIO_KINDS.has(kind);

  if (state === "idle") {
    return (
      <button
        onClick={() => setState("loading")}
        className="mt-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center gap-1"
      >
        {isImage
          ? isSticker
            ? "😀 نمایش استیکر"
            : "🖼 نمایش عکس"
          : isVideo
            ? "▶️ پخش ویدیو"
            : isAudio
              ? "🔊 پخش صدا"
              : "⬇️ دانلود فایل"}
      </button>
    );
  }

  // Loading + error + loaded states share the same wrapper so the
  // close button always sits in the same place.
  const close = () => setState("idle");
  const retry = () => {
    setNonce((n) => n + 1);
    setState("loading");
  };

  const wrapperClass =
    "mt-1 relative inline-block max-w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40";

  const closeButton = (
    <button
      onClick={close}
      aria-label="بستن"
      className="absolute top-1 left-1 z-10 w-6 h-6 rounded-full bg-black/70 hover:bg-black text-white text-[12px] flex items-center justify-center"
    >
      ✕
    </button>
  );

  if (state === "error") {
    return (
      <div className={wrapperClass + " min-w-[180px] min-h-[80px]"}>
        {closeButton}
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-[11px]">
          <div className="text-red-300">⚠️ بارگذاری نشد</div>
          <div className="flex gap-2">
            <button
              onClick={retry}
              className="px-2 py-1 rounded-md border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30"
            >
              🔄 تلاش مجدد
            </button>
            <a
              href={downloadSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              ⬇️ دانلود
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Loading spinner — same wrapper, centered.
  const loadingOverlay = state === "loading" && (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-md">
      <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (isImage) {
    return (
      <div className={wrapperClass + " min-w-[120px] min-h-[80px]"}>
        {closeButton}
        {loadingOverlay}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="media"
          className={`max-h-72 rounded-md ${isSticker ? "p-2 bg-[var(--color-surface-2)]/60" : ""}`}
          loading="eager"
          onLoad={() => setState("loaded")}
          onError={() => setState("error")}
          style={
            state === "loading" ? { opacity: 0.3, minWidth: 120, minHeight: 80 } : undefined
          }
        />
      </div>
    );
  }
  if (isVideo) {
    return (
      <div className={wrapperClass + " min-w-[200px] min-h-[120px]"}>
        {closeButton}
        {loadingOverlay}
        <video
          src={src}
          controls
          playsInline
          className="max-h-72 max-w-full rounded-md"
          onLoadedData={() => setState("loaded")}
          onError={() => setState("error")}
          style={state === "loading" ? { opacity: 0.3 } : undefined}
        />
      </div>
    );
  }
  if (isAudio) {
    return (
      <div className={wrapperClass + " w-full max-w-xs p-2"}>
        {closeButton}
        {loadingOverlay}
        <audio
          src={src}
          controls
          className="w-full mt-4"
          onLoadedData={() => setState("loaded")}
          onError={() => setState("error")}
        />
      </div>
    );
  }
  // Documents / unknown: just a download link, no preview needed.
  return (
    <a
      href={downloadSrc}
      className="mt-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center gap-1"
    >
      ⬇️ دانلود فایل
    </a>
  );
}
