import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { requireSession } from "@/lib/auth";
import {
  audit,
  deleteOwnerAsset,
  getOwnerAsset,
  setOwnerAsset,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND = "photo";
const MAX_BYTES = 5 * 1024 * 1024;

// GET — stream the stored owner reference photo (the dashboard preview
// loads it via <img src="/api/settings/owner-photo">). 404 when none.
export async function GET(): Promise<Response> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const asset = await getOwnerAsset(KIND);
  if (!asset) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new Response(Buffer.from(asset.data), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "private, no-store",
    },
  });
}

// POST — multipart upload from the settings UI. Replaces any prior
// photo. Caps at 5MB so a 50MB selfie can't bloat the DB row.
export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "form field 'photo' (file) required" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `file too big — limit ${MAX_BYTES} bytes` },
      { status: 413 },
    );
  }
  const mime = file.type || "image/jpeg";
  if (!mime.startsWith("image/")) {
    return NextResponse.json(
      { error: `not an image (mime=${mime})` },
      { status: 400 },
    );
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  await setOwnerAsset({ kind: KIND, mime, data: buf });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "owner_asset.photo.upload",
    details: { bytes: buf.length, mime },
  });
  return NextResponse.json({ ok: true, bytes: buf.length, mime });
}

export async function DELETE(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await deleteOwnerAsset(KIND);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "owner_asset.photo.delete",
    details: {},
  });
  return NextResponse.json({ ok: true });
}
