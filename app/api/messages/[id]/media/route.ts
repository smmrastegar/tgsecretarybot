import { requireSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { getMessageForTranscript } from "@/lib/db";
import { downloadTelegramFile } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Telegram's file CDN returns application/octet-stream for almost
// everything, and the browser needs a real type to render an <img> /
// <audio> / <video>. We map by the media_kind we stored plus the
// file extension from the file_path.
function guessMime(
  kind: string | null,
  fileName: string,
  serverMime: string,
): string {
  if (serverMime && serverMime !== "application/octet-stream") {
    return serverMime;
  }
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    pdf: "application/pdf",
  };
  if (byExt[ext]) return byExt[ext];
  // Fall back by kind.
  switch (kind) {
    case "photo":
      return "image/jpeg";
    case "sticker":
      return "image/webp";
    case "animation":
      return "video/mp4";
    case "video":
    case "video_note":
      return "video/mp4";
    case "voice":
      return "audio/ogg";
    case "audio":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession();
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const { id } = await ctx.params;
  const messageId = Number(id);
  if (!Number.isFinite(messageId)) {
    return new Response("invalid id", { status: 400 });
  }
  const row = await getMessageForTranscript(messageId);
  if (!row || !row.mediaFileId) {
    return new Response("no media", { status: 404 });
  }

  let file;
  try {
    file = await downloadTelegramFile(config.telegramBotToken, row.mediaFileId);
  } catch (err) {
    return new Response(`download failed: ${String(err).slice(0, 200)}`, {
      status: 502,
    });
  }

  const mime = guessMime(row.mediaKind, file.name, file.mime);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": mime,
    // File ids are stable per chat, cache aggressively in the browser.
    "Cache-Control": "private, max-age=86400",
    "Content-Length": String(file.data.byteLength),
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${file.name}"`;
  }
  return new Response(Buffer.from(file.data), { status: 200, headers });
}
