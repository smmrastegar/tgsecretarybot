import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createNoteWatchItem, listNoteWatchItems } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = await listNoteWatchItems();
  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    concept?: string;
    description?: string;
    enabled?: boolean;
  };
  const concept = (body.concept ?? "").trim();
  if (!concept) {
    return NextResponse.json({ error: "concept required" }, { status: 400 });
  }
  const item = await createNoteWatchItem({
    concept,
    description: body.description?.trim() || null,
    enabled: body.enabled ?? true,
  });
  return NextResponse.json({ item });
}
