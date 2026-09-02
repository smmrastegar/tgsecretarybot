import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  createNoteWatchItem,
  listNoteWatchItemsWithAliases,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const items = await listNoteWatchItemsWithAliases();
  return NextResponse.json({ items });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
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
