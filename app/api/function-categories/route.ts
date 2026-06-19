import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  createFunctionCategory,
  hasDb,
  listFunctionCategories,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const categories = await listFunctionCategories();
  return NextResponse.json({ categories });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    label?: string;
    emoji?: string | null;
    sortOrder?: number;
  };
  if (!body.slug || !body.label) {
    return NextResponse.json(
      { error: "slug + label required" },
      { status: 400 },
    );
  }
  const slug = body.slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const category = await createFunctionCategory({
    slug,
    label: body.label,
    emoji: body.emoji ?? null,
    sortOrder: body.sortOrder ?? 100,
  });
  return NextResponse.json({ ok: true, category });
}
