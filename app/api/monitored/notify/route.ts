import { NextResponse } from "next/server";
import { getBot } from "@/lib/bot";
import {
  audit,
  getMonitoredAccount,
  listMonitoredAccounts,
} from "@/lib/db";
import {
  getExternalMonitorConfig,
  markNotified,
  verifySignature,
} from "@/lib/external-monitor";
import { getActiveKey, HikerOutOfCreditsError } from "@/lib/hikerapi";
import { HikerApprovalNeededError } from "@/lib/hikerapi-budget";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { runWithTenant } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Webhook target for the external change-detector.
// Body: { username, kind?, detectedAt?, hint? }
// Auth:  X-Signature: hex(HMAC_SHA256(rawBody, monitorExternalSecret))
//
// We look the username up across ALL tenants — multiple owners may
// monitor the same account, and each should get their own download.
// Each tenant gets its own runWithTenant so budget gates fire per
// tenant correctly.
export async function POST(request: Request): Promise<NextResponse> {
  const cfg = await getExternalMonitorConfig();
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "external monitor disabled" },
      { status: 503 },
    );
  }
  if (!cfg.secret) {
    return NextResponse.json(
      { error: "monitorExternalSecret not configured" },
      { status: 503 },
    );
  }
  // We need the raw body to verify the signature — Next caches the
  // body once read, so we read it as text and parse manually.
  const raw = await request.text();
  const signature = request.headers.get("x-signature");
  if (
    !verifySignature({ body: raw, signature, secret: cfg.secret })
  ) {
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401 },
    );
  }
  let body: {
    username?: string;
    kind?: "story" | "post" | "reel" | "mentioned";
    detectedAt?: string;
    hint?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const username = (body.username ?? "").trim().toLowerCase();
  if (!username || !/^[a-z0-9._]+$/.test(username)) {
    return NextResponse.json({ error: "username invalid" }, { status: 400 });
  }
  const kind = body.kind ?? "story";

  // Find every tenant that's tracking this username.
  const accounts = await listMonitoredAccounts({
    platform: "instagram",
  });
  const matches = accounts.filter(
    (a) => a.username === username && a.enabled,
  );
  if (matches.length === 0) {
    // External service is watching something we no longer care about.
    // Tell them so they can drop it (we don't 404 because that would
    // make them retry).
    return NextResponse.json({
      ok: true,
      handled: false,
      reason: "no enabled tenant tracks this username",
    });
  }

  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      { error: "HIKER_API_KEY not configured for any tenant" },
      { status: 503 },
    );
  }

  await markNotified(username);
  await audit({
    actorId: null,
    actorName: "external-monitor",
    action: "monitor.external_notify",
    target: username,
    details: { kind, detectedAt: body.detectedAt, tenantCount: matches.length },
  });

  let totalDetected = 0;
  let totalForwarded = 0;
  const errors: string[] = [];
  const perTenant: Array<{
    tenantId: number;
    detected: number;
    forwarded: number;
    errors: string[];
  }> = [];

  for (const acc of matches) {
    const tenantId = acc.tenantId;
    if (tenantId == null) {
      errors.push(`${acc.id}: missing tenant`);
      continue;
    }
    const result = await runWithTenant(tenantId, async () => {
      const fresh = await getMonitoredAccount(acc.id, tenantId);
      if (!fresh) return null;
      const target = await resolveTargetChat();
      if (!target) {
        return { detected: 0, forwarded: 0, errors: ["no target chat"] };
      }
      try {
        // Only fetch the kind they told us changed. Saves $$ on the
        // other endpoints we'd skip anyway.
        return await processAccount({
          account: fresh,
          target,
          bot: getBot(),
          kindOverrides: {
            story: kind === "story",
            post: kind === "post",
            reel: kind === "reel",
            mentioned: kind === "mentioned",
          },
          storiesLimit: 5,
          postsLimit: 3,
          reelsLimit: 3,
          mentionedLimit: 3,
        });
      } catch (err) {
        if (err instanceof HikerOutOfCreditsError) {
          return {
            detected: 0,
            forwarded: 0,
            errors: [`hiker out of credits: ${err.message}`],
          };
        }
        if (err instanceof HikerApprovalNeededError) {
          return {
            detected: 0,
            forwarded: 0,
            errors: [`approval needed: ${err.message}`],
          };
        }
        return {
          detected: 0,
          forwarded: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        };
      }
    });
    if (!result) continue;
    totalDetected += result.detected;
    totalForwarded += result.forwarded;
    errors.push(...result.errors);
    perTenant.push({
      tenantId,
      detected: result.detected,
      forwarded: result.forwarded,
      errors: result.errors,
    });
  }

  return NextResponse.json({
    ok: true,
    handled: true,
    username,
    kind,
    totalDetected,
    totalForwarded,
    tenants: perTenant,
    errors: errors.slice(0, 20),
  });
}
