"use client";

import { useState } from "react";

// Renders the actual media for a logged message by streaming it from
// /api/messages/[id]/media. We lazy-load (a button → fetch) so opening
// a long chat doesn't hammer Telegram's getFile for every photo at
// once. `kind` picks the right element: img / audio / video / link.
const IMAGE_KINDS = new Set(["photo", "sticker"]);
const VIDEO_KINDS = new Set(["video", "video_note", "animation"]);
const AUDIO_KINDS = new Set(["voice", "audio"]);

export default function MediaView({
  messageId,
  kind,
}: {
  messageId: number;
  kind: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!kind) return null;
  const src = `/api/messages/${messageId}/media`;
  const downloadSrc = `${src}?download=1`;

  // Documents / unknown kinds → always just a download link.
  const isImage = IMAGE_KINDS.has(kind);
  const isVideo = VIDEO_KINDS.has(kind);
  const isAudio = AUDIO_KINDS.has(kind);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center gap-1"
      >
        {isImage
          ? "🖼 نمایش عکس"
          : isVideo
            ? "▶️ پخش ویدیو"
            : isAudio
              ? "🔊 پخش صدا"
              : "⬇️ دانلود فایل"}
      </button>
    );
  }

  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img
          src={src}
          alt="media"
          className="mt-1 max-h-72 rounded-md border border-[var(--color-border)]"
          loading="lazy"
        />
      </a>
    );
  }
  if (isVideo) {
    return (
      <video
        src={src}
        controls
        playsInline
        className="mt-1 max-h-72 rounded-md border border-[var(--color-border)] max-w-full"
      />
    );
  }
  if (isAudio) {
    return <audio src={src} controls className="mt-1 w-full max-w-xs" />;
  }
  return (
    <a
      href={downloadSrc}
      className="mt-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] inline-flex items-center gap-1"
    >
      ⬇️ دانلود فایل
    </a>
  );
}
