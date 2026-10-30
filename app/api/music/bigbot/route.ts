import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { getAllSettings, setSetting } from "@/lib/db";
import { bigBotInfo, localServerUp } from "@/lib/big-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The large-file bot (files over 20 MB): its Telegram app id/hash and bot token live here, never in the repo, and are never sent back to the browser.
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const s = await getAllSettings();
  const status = (await fs.readFile("/var/lib/tgsb-tools/botapi.status", "utf8").catch(() => "")).trim().slice(0, 300);
  const up = await localServerUp();
  return NextResponse.json({
    has: { apiId: !!s.tgBotApiId, apiHash: !!s.tgBotApiHash, token: !!s.tgBigBotToken },
    apiId: s.tgBotApiId ?? "", // the id is not a secret (the hash is)
    localServer: up,
    bot: up ? await bigBotInfo() : null,
    setupStatus: status,
  }, { headers: { "Cache-Control": "no-store" } });
}

// POST { apiId?, apiHash?, token? }: only the fields that are sent (and not empty) change.
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { apiId?: string; apiHash?: string; token?: string };
  const apiId = String(b.apiId ?? "").trim(), apiHash = String(b.apiHash ?? "").trim(), token = String(b.token ?? "").trim();
  if (apiId && !/^\d{3,12}$/.test(apiId)) return NextResponse.json({ error: "api_id باید فقط عدد باشد" }, { status: 400 });
  if (apiHash && !/^[0-9a-f]{32}$/i.test(apiHash)) return NextResponse.json({ error: "api_hash باید ۳۲ حرف (۰-۹ و a-f) باشد" }, { status: 400 });
  if (token && !/^\d{6,12}:[\w-]{30,}$/.test(token)) return NextResponse.json({ error: "توکن بات درست به نظر نمی‌رسد (شکل: عدد:حروف)" }, { status: 400 });
  if (apiId) await setSetting("tgBotApiId", apiId);
  if (apiHash) await setSetting("tgBotApiHash", apiHash);
  if (token) { await setSetting("tgBigBotToken", token); await setSetting("tgBigBotCloudOut", ""); await setSetting("tgBigBotOffset", "0"); }
  return NextResponse.json({ ok: true });
}
