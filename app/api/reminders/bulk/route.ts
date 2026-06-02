import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  audit,
  bulkDeleteExtracted,
  bulkMarkExtractedDone,
  bulkSetExtractedKind,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set([
  "event",
  "task",
  "reminder",
  "deadline",
  "decision",
  "note",
  "action",
]);

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    op?: "done" | "undone" | "delete" | "set_kind";
    ids?: number[];
    kind?: string;
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

  let affected = 0;
  if (op === "done") {
    affected = await bulkMarkExtractedDone(ids, true);
  } else if (op === "undone") {
    affected = await bulkMarkExtractedDone(ids, false);
  } else if (op === "delete") {
    affected = await bulkDeleteExtracted(ids);
  } else if (op === "set_kind") {
    const kind = (body.kind ?? "").trim();
    if (!ALLOWED_KINDS.has(kind)) {
      return NextResponse.json(
        { error: `invalid kind; allowed: ${[...ALLOWED_KINDS].join(", ")}` },
        { status: 400 },
      );
    }
    affected = await bulkSetExtractedKind(ids, kind);
  } else {
    return NextResponse.json({ error: "unknown op" }, { status: 400 });
  }

  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: `action.bulk_${op}`,
    target: ids.length === 1 ? String(ids[0]) : null,
    details: { count: ids.length, affected, op, kind: body.kind },
  });

  return NextResponse.json({ ok: true, affected });
}
