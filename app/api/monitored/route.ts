import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import {
  addMonitoredAccount,
  audit,
  listChatsByFunction,
  listMonitoredAccounts,
  listRecentMonitorEvents,
} from "@/lib/db";
import { getActiveKey, HikerOutOfCreditsError } from "@/lib/hikerapi";
import { HikerApprovalNeededError } from "@/lib/hikerapi-budget";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { getSettings } from "@/lib/settings";
import { requireTenant } from "@/lib/tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { registerAccount } from "@/lib/external-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v == null) return def;
  return v.toLowerCase() === "true" || v === "1" || v.toLowerCase() === "on";
}

export async function GET(): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const [accounts, events, storages, downloaders, settings] = await Promise.all([
    listMonitoredAccounts({ platform: "instagram", tenantId: tenant.id }),
    listRecentMonitorEvents(100, tenant.id),
    listChatsByFunction("storage", tenant.id),
    listChatsByFunction("downloader", tenant.id),
    getSettings(),
  ]);
  const target = storages[0] ?? downloaders[0] ?? null;
  return NextResponse.json({
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
    accounts,
    events,
    storageChats: storages.map((c) => ({
      chatId: c.chatId,
      chatTitle: c.chatTitle,
      firstName: c.firstName,
      lastName: c.lastName,
      nickname: c.nickname,
    })),
    downloaderChats: downloaders.map((c) => ({
      chatId: c.chatId,
      chatTitle: c.chatTitle,
      firstName: c.firstName,
      lastName: c.lastName,
      nickname: c.nickname,
    })),
    targetChatId: target?.chatId ?? null,
    defaults: {
      intervalMinutes:
        Number(settings.monitorDefaultIntervalMinutes) || 30,
      checkStories: parseBool(settings.monitorDefaultCheckStories, true),
      checkPosts: parseBool(settings.monitorDefaultCheckPosts, false),
      checkReels: parseBool(settings.monitorDefaultCheckReels, false),
      checkProfile: parseBool(settings.monitorDefaultCheckProfile, false),
      checkMentioned: parseBool(settings.monitorDefaultCheckMentioned, false),
    },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let tenant;
  try {
    tenant = await requireTenant(session);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 403 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
  };
  const username = (body.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username || !/^[a-z0-9._]+$/.test(username)) {
    return NextResponse.json({ error: "username invalid" }, { status: 400 });
  }
  const settings = await getSettings();
  const account = await addMonitoredAccount({
    platform: "instagram",
    username,
    tenantId: tenant.id,
    defaults: {
      intervalMinutes: Number(settings.monitorDefaultIntervalMinutes) || 30,
      checkStories: parseBool(settings.monitorDefaultCheckStories, true),
      checkPosts: parseBool(settings.monitorDefaultCheckPosts, false),
      checkReels: parseBool(settings.monitorDefaultCheckReels, false),
      checkProfile: parseBool(settings.monitorDefaultCheckProfile, false),
      checkMentioned: parseBool(settings.monitorDefaultCheckMentioned, false),
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.add",
    target: account ? String(account.id) : null,
    details: { username, tenantId: tenant.id },
  });
  // Tell the external change-detector to watch this username.
  // Fire-and-forget — failure is logged but doesn't block the add.
  registerAccount({ username }).catch((err) =>
    console.warn("[external-monitor] register failed:", err),
  );
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];
  let outOfCredits: { message: string; billingUrl: string } | null = null;
  let approvalNeeded: HikerApprovalNeededError | null = null;
  const { key } = await getActiveKey();
  if (account && key) {
    await runWithTenant(tenant.id, async () => {
      const target = await resolveTargetChat();
      if (target) {
        try {
          const result = await processAccount({
            account,
            target,
            bot: getBot(),
            forceAllKinds: true,
            postsLimit: 3,
            reelsLimit: 0,
          });
          detected = result.detected;
          forwarded = result.forwarded;
          errors.push(...result.errors);
        } catch (err) {
          if (err instanceof HikerOutOfCreditsError) {
            outOfCredits = { message: err.message, billingUrl: err.billingUrl };
            errors.push(`HikerAPI out of credits: ${err.message}`);
          } else if (err instanceof HikerApprovalNeededError) {
            approvalNeeded = err;
            errors.push(err.message);
          } else {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
    });
  }
  return NextResponse.json({
    ok: true,
    account,
    detected,
    forwarded,
    errors: errors.slice(0, 5),
    ...(outOfCredits
      ? {
          outOfCredits: true,
          billingUrl: (outOfCredits as { billingUrl: string }).billingUrl,
        }
      : {}),
    ...(approvalNeeded
      ? {
          approvalNeeded: true,
          spentUsd: (approvalNeeded as HikerApprovalNeededError).spentUsd,
          approvedUsd: (approvalNeeded as HikerApprovalNeededError).approvedUsd,
          nextThresholdUsd: (approvalNeeded as HikerApprovalNeededError)
            .nextThresholdUsd,
          budgetUsd: (approvalNeeded as HikerApprovalNeededError).budgetUsd,
          reason: (approvalNeeded as HikerApprovalNeededError).reason,
        }
      : {}),
  });
}
