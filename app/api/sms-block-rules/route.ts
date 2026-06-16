import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createSmsBlockRule, listSmsBlockRules } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rules = await listSmsBlockRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    exampleBody?: string;
    label?: string;
  };
  const example = (body.exampleBody ?? "").trim();
  if (!example) {
    return NextResponse.json({ error: "exampleBody required" }, { status: 400 });
  }
  const rule = await createSmsBlockRule({
    exampleBody: example,
    label: body.label?.trim() || null,
  });
  return NextResponse.json({ rule });
}
