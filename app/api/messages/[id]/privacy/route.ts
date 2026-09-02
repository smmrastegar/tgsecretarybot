import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { hasDb, sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/messages/[id]/privacy   body: { private?: boolean; revealed?: boolean }
//   - private=true  → is_private_conversation=TRUE, revealed cleared (hide).
//   - private=false → is_private_conversation=FALSE, revealed cleared (drop the marker).
//   - revealed=false → just clear privateRevealedAt (re-hide a revealed body)
//     without touching the private flag itself.
// Used by the /messages UI to manually correct or toggle privacy when
// the AI classifier got it wrong on a particular message.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  if (!hasDb()) {
    return NextResponse.json({ error: "no db" }, { status: 500 });
  }
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    private?: boolean;
    revealed?: boolean;
  };
  // Build the UPDATE based on which fields were sent.
  if (body.private === true) {
    await sql()`UPDATE messages_log
      SET is_private_conversation = TRUE, private_revealed_at = NULL
      WHERE id = ${id}`;
  } else if (body.private === false) {
    await sql()`UPDATE messages_log
      SET is_private_conversation = FALSE, private_revealed_at = NULL
      WHERE id = ${id}`;
  } else if (body.revealed === false) {
    await sql()`UPDATE messages_log
      SET private_revealed_at = NULL
      WHERE id = ${id}`;
  } else {
    return NextResponse.json(
      { error: "send {private: true|false} or {revealed: false}" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
