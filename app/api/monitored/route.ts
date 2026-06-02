import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addMonitoredAccount,
  audit,
  listMonitoredAccounts,
  listRecentMonitorEvents,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [accounts, events] = await Promise.all([
    listMonitoredAccounts({ platform: "instagram" }),
    listRecentMonitorEvents(100),
  ]);
  return NextResponse.json({ accounts, events });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
  };
  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username || !/^[a-z0-9._]+$/.test(username)) {
    return NextResponse.json(
      { error: "username invalid" },
      { status: 400 },
    );
  }
  const account = await addMonitoredAccount({
    platform: "instagram",
    username,
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.add",
    target: account ? String(account.id) : null,
    details: { username },
  });
  return NextResponse.json({ ok: true, account });
}
