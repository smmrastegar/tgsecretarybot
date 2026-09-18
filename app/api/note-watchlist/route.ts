import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  createNoteWatchItem,
  listNoteWatchFeedback,
  listNoteWatchItemsWithAliases,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const items = await listNoteWatchItemsWithAliases();
  // What the operator's 🚩/✅ presses taught each concept — shown on
  // the card so the learning is visible, not just stored.
  const fb = await listNoteWatchFeedback(items.map((it) => it.id)).catch(() => null);
  return NextResponse.json({
    items: items.map((it) => ({
      ...it,
      feedback: {
        rejected: fb?.get(it.id)?.rejected.map((r) => r.quote) ?? [],
        confirmed: fb?.get(it.id)?.confirmed.map((c) => c.quote) ?? [],
      },
    })),
  });
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
