import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { audit, createMusicPin, deleteMusicPin, listMusicPins, listScAccountEntries, listSpotifyAccounts, updateMusicPin } from "@/lib/db";
import { DIRECT_ACCOUNT } from "@/lib/music-scope";
import { PIN_RE, pinConfigured } from "@/lib/music-pin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manage the numeric passwords for playlist.bz. Only a full dashboard session may — a PIN session cannot read or change them.
async function owner() {
  const s = await getCurrentSession();
  return s && !s.scope ? s : null;
}
const who = (s: { userId: number; username?: string | null; firstName?: string | null }) => ({ actorId: s.userId, actorName: s.username ?? s.firstName ?? null });
const BAD = "رمز باید فقط عدد و ۶ تا ۱۰ رقم باشد";

export async function GET(): Promise<NextResponse> {
  const s = await getCurrentSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (s.scope) return NextResponse.json({ configured: await pinConfigured(), canManage: false });
  const [pins, accts, scAccts] = await Promise.all([listMusicPins(), listSpotifyAccounts(), listScAccountEntries()]);
  const accounts = [...accts.map((a) => ({ id: a.id, name: a.displayName ?? a.spotifyUserId })), ...scAccts, DIRECT_ACCOUNT];
  return NextResponse.json({ configured: await pinConfigured(), canManage: true, pins, accounts }, { headers: { "Cache-Control": "no-store" } });
}

// POST { pin, label? } → a new password (several can exist).
export async function POST(request: Request): Promise<NextResponse> {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { pin?: unknown; label?: unknown; accountIds?: unknown; accountsMode?: unknown };
  const pin = typeof b.pin === "string" ? b.pin.trim() : "";
  if (!PIN_RE.test(pin)) return NextResponse.json({ error: BAD }, { status: 400 });
  const made = await createMusicPin(pin, typeof b.label === "string" ? b.label.trim() : "", { userId: s.userId, username: s.username ?? null, firstName: s.firstName ?? null });
  if (made && Array.isArray(b.accountIds)) await updateMusicPin(made.id, { accountIds: b.accountIds.map(Number), accountsMode: b.accountsMode === "all" ? "all" : "any" });
  if (!made) return NextResponse.json({ error: "این رمز از قبل هست" }, { status: 409 });
  await audit({ ...who(s), action: "auth.pin-add" });
  return NextResponse.json({ ok: true, id: made.id });
}

// PATCH { id, active?, label?, pin? }
export async function PATCH(request: Request): Promise<NextResponse> {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; active?: unknown; label?: unknown; pin?: unknown; accountIds?: unknown; accountsMode?: unknown };
  const id = Number(b.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (typeof b.pin === "string" && !PIN_RE.test(b.pin.trim())) return NextResponse.json({ error: BAD }, { status: 400 });
  const ok = await updateMusicPin(id, {
    active: typeof b.active === "boolean" ? b.active : undefined,
    label: typeof b.label === "string" ? b.label.trim() : undefined,
    pin: typeof b.pin === "string" ? b.pin.trim() : undefined,
    accountIds: Array.isArray(b.accountIds) ? b.accountIds.map(Number) : undefined,
    accountsMode: b.accountsMode === "all" || b.accountsMode === "any" ? b.accountsMode : undefined,
  });
  if (!ok) return NextResponse.json({ error: "این رمز از قبل هست" }, { status: 409 });
  await audit({ ...who(s), action: "auth.pin-update" });
  return NextResponse.json({ ok: true });
}

// DELETE ?id=… → remove one password.
export async function DELETE(request: Request): Promise<NextResponse> {
  const s = await owner();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteMusicPin(id);
  await audit({ ...who(s), action: "auth.pin-clear" });
  return NextResponse.json({ ok: true });
}
