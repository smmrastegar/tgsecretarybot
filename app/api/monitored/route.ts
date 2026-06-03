import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import {
  addMonitoredAccount,
  audit,
  listChatsByFunction,
  listMonitoredAccounts,
  listRecentMonitorEvents,
} from "@/lib/db";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(v: string | undefined, def: boolean): boolean {
  if (v == null) return def;
  return v.toLowerCase() === "true" || v === "1" || v.toLowerCase() === "on";
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [accounts, events, storages, downloaders, settings] = await Promise.all([
    listMonitoredAccounts({ platform: "instagram" }),
    listRecentMonitorEvents(100),
    listChatsByFunction("storage"),
    listChatsByFunction("downloader"),
    getSettings(),
  ]);
  const target = storages[0] ?? downloaders[0] ?? null;
  return NextResponse.json({
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
    defaults: {
      intervalMinutes: Number(settings.monitorDefaultIntervalMinutes) || 30,
      checkStories: parseBool(settings.monitorDefaultCheckStories, true),
      checkPosts: parseBool(settings.monitorDefaultCheckPosts, false),
      checkReels: parseBool(settings.monitorDefaultCheckReels, false),
      checkProfile: parseBool(settings.monitorDefaultCheckProfile, false),
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.add",
    target: account ? String(account.id) : null,
    details: { username },
  });
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];
  if (account && config.hikerApiKey) {
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
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return NextResponse.json({
    ok: true,
    account,
    detected,
    forwarded,
    errors: errors.slice(0, 5),
  });
}
