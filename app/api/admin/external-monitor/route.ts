import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  externalHealthCheck,
  getExternalMonitorConfig,
  listSubscriptions,
} from "@/lib/external-monitor";
import { requireAdmin } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await requireAdmin(session);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const cfg = await getExternalMonitorConfig();
  const health = await externalHealthCheck();
  const subs = await listSubscriptions();
  const active = subs.filter((s) => s.unregisteredAt == null).length;
  const totalNotifications = subs.reduce((a, s) => a + s.notifyCount, 0);
  return NextResponse.json({
    ok: true,
    config: {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl || null,
      secretConfigured: !!cfg.secret,
    },
    health,
    stats: {
      activeSubscriptions: active,
      totalSubscriptions: subs.length,
      totalNotificationsReceived: totalNotifications,
    },
    subscriptions: subs.slice(0, 200),
  });
}
