import { NextResponse } from "next/server";
import { listUploadWaiting } from "@/lib/db";
import { editAccess, notFound } from "@/lib/music-token";
import { cleanTagText } from "@/lib/music-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → songs sent to the channel that the bot could not download (over Telegram's 20 MB limit), waiting for their file.
export async function GET(request: Request): Promise<Response> {
  if (!(await editAccess(request))) return notFound();
  const rows = await listUploadWaiting();
  return NextResponse.json({
    items: rows.map((r) => {
      const t = r.tags as { title?: string | null; artist?: string | null } | null;
      return { id: r.id, fileName: r.fileName, sizeMb: Math.round((r.fileSize ?? 0) / 1048576), title: cleanTagText(t?.title ?? r.tgTitle) ?? (r.fileName ?? "").replace(/\.[a-z0-9]+$/i, ""), artist: cleanTagText(t?.artist ?? r.tgPerformer) ?? "" };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
