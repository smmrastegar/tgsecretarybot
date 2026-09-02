import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import {
  createChatProfile,
  hasDb,
  listChatProfiles,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  if (!hasDb()) return NextResponse.json({ profiles: [] });
  const profiles = await listChatProfiles();
  return NextResponse.json({ profiles });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  if (!hasDb()) {
    return NextResponse.json({ error: "DATABASE_URL not set" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    slug?: string;
    name?: string;
    emoji?: string | null;
    description?: string | null;
    followUpEnabled?: boolean;
    followUpThresholdHours?: number;
    followUpEscalateHours?: number;
    followUpTranscribeVoices?: boolean;
  };
  if (!body.slug || !body.name) {
    return NextResponse.json(
      { error: "slug + name required" },
      { status: 400 },
    );
  }
  const profile = await createChatProfile({
    slug: body.slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    name: body.name,
    emoji: body.emoji ?? null,
    description: body.description ?? null,
    followUpEnabled: body.followUpEnabled ?? true,
    followUpThresholdHours: Number(body.followUpThresholdHours ?? 2),
    followUpEscalateHours: Number(body.followUpEscalateHours ?? 12),
    followUpTranscribeVoices: Boolean(body.followUpTranscribeVoices ?? false),
    tenantId: null,
  });
  return NextResponse.json({ ok: true, profile });
}
