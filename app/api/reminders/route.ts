import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { listExtractedItems } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") ?? "upcoming";
  const priority = url.searchParams.get("priority");
  const items = await listExtractedItems({
    upcoming: filter === "upcoming",
    doneOnly: filter === "done",
    priority: priority && priority !== "all" ? priority : null,
  });
  return NextResponse.json({ items });
}
