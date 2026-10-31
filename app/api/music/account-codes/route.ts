import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { listScAccountEntries, listSpotifyAccounts } from "@/lib/db";
import { DIRECT_ACCOUNT } from "@/lib/music-scope";
import { getAccountCodes, setAccountCode } from "@/lib/music-account-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → every account with the code the owner typed for it (null = automatic). PATCH { id, code } sets one ("" = back to automatic).
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const [spotify, sc, codes] = await Promise.all([listSpotifyAccounts(), listScAccountEntries(), getAccountCodes()]);
  const accounts = [...spotify.map((a) => ({ id: a.id, name: a.displayName ?? a.spotifyUserId })), ...sc, DIRECT_ACCOUNT].map((a) => ({ id: a.id, name: a.name, code: codes[String(a.id)] ?? null }));
  return NextResponse.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; code?: unknown };
  const id = Number(b.id);
  if (!Number.isInteger(id) || id < 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await setAccountCode(id, typeof b.code === "string" ? b.code : "");
  return NextResponse.json({ ok: true });
}
