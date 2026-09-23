import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSessionOr401 } from "@/lib/auth";
import { config } from "@/lib/config";
import { audit, listChatsByFunction, listCodeFeeds, upsertCodeFeed } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL = "OtpBar (Mac)";

// Pairing for the Mac menu-bar app: with a dashboard session, hand
// back a code-feed token dedicated to OtpBar (created on first use,
// reused afterwards) plus the server base URL. The /otp/pair page
// turns that into an otpbar:// link the app registers for, so the
// owner never sees or types a token.
export async function POST(): Promise<NextResponse> {
  const guard = await requireSessionOr401();
  if (guard) return guard;
  const feeds = await listCodeFeeds();
  let feed = feeds.find((f) => f.label === LABEL && f.enabled) ?? null;
  if (!feed) {
    // Watch the same chat the first enabled feed watches, else the SMS
    // inbox; the OTP API unions all sources anyway, the chat only has
    // to exist for the row.
    const inbox = (await listChatsByFunction("sms_inbox").catch(() => []))[0];
    const chatId = feeds.find((f) => f.enabled)?.chatId ?? inbox?.chatId ?? 0;
    if (!chatId) {
      return NextResponse.json({ error: "no SMS chat configured (code feed or sms_inbox)" }, { status: 400 });
    }
    const token = randomBytes(24).toString("base64url");
    const id = await upsertCodeFeed({
      token,
      label: LABEL,
      chatId,
      windowSeconds: 86400,
      format: "json",
      codesOnly: true,
      allowedIps: [],
      enabled: true,
    });
    feed = (await listCodeFeeds()).find((f) => f.id === id) ?? null;
    await audit({ actorId: null, action: "otp.pair.create", target: String(id) });
  }
  if (!feed) return NextResponse.json({ error: "could not create feed" }, { status: 500 });
  const base = (config.publicAppUrl || "https://bot.text.bz").replace(/\/$/, "");
  return NextResponse.json({ token: feed.token, base });
}
