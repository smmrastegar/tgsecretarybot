import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, bulkMarkMessagesHandled } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    op?: "handle" | "unhandle";
    ids?: number[];
  };
  const op = body.op;
  const ids = Array.isArray(body.ids)
    ? body.ids
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!op || ids.length === 0) {
    return NextResponse.json(
      { error: "op + ids[] required" },
      { status: 400 },
    );
  }
  const affected = await bulkMarkMessagesHandled(
    ids,
    session.userId,
    op === "handle",
  );
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: `messages.bulk_${op}`,
    target: ids.length === 1 ? String(ids[0]) : null,
    details: { count: ids.length, affected },
  });
  return NextResponse.json({ ok: true, affected });
}
