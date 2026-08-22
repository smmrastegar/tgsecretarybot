import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  listLinkDownloaders,
  upsertLinkDownloader,
  deleteLinkDownloader,
  audit,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireSession();
  return NextResponse.json({ ok: true, downloaders: await listLinkDownloaders(true) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  const b = (await request.json().catch(() => ({}))) as {
    id?: number; label?: string; kind?: string;
    botId?: number | string; hosts?: string; enabled?: boolean;
  };
  const label = (b.label ?? "").toString().trim();
  const botId = Number(b.botId);
  // Hosts are stored bare ("instagram.com"); strip any scheme/path the
  // operator pastes so matching stays on the hostname alone.
  const hosts = String(b.hosts ?? "")
    .split(/[,\s]+/)
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "")
    .map((h) => h.replace(/^\.+/, "").replace(/^www\./, ""))
    .filter(Boolean);
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  if (!Number.isFinite(botId) || botId <= 0) {
    return NextResponse.json({ error: "valid bot id required" }, { status: 400 });
  }
  if (hosts.length === 0) {
    return NextResponse.json({ error: "at least one host required" }, { status: 400 });
  }
  await upsertLinkDownloader({
    id: b.id,
    label,
    kind: (b.kind ?? label).toString().trim().toLowerCase() || "custom",
    botId,
    hosts,
    enabled: b.enabled !== false,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: b.id ? "link_downloader.update" : "link_downloader.create",
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await deleteLinkDownloader(id);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "link_downloader.delete",
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
