import { createHash, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { InputFile } from "grammy";
import { NextResponse } from "next/server";
import { getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import { getAllSettings, setSetting } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { reportError, reportInfo } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by deploy/auto-deploy.sh (token = WEBHOOK_SECRET_TOKEN, like /api/deploy-status):
// when public/downloads/MyMusic.apk is a file the owner has not been sent yet, send it to the
// owner's Telegram chat (settings.ownerNotifyChatId) and remember its hash.
function authorized(request: Request): boolean {
  const expected = (config.webhookSecretToken ?? "").trim();
  const presented = (request.headers.get("x-deploy-token") ?? "").trim();
  if (!expected || presented.length !== expected.length) return false;
  try { return timingSafeEqual(Buffer.from(presented), Buffer.from(expected)); } catch { return false; }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const file = path.join(process.cwd(), "public", "downloads", "MyMusic.apk");
    const data = await fs.readFile(file);
    const sha = createHash("sha256").update(data).digest("hex");
    if ((await getAllSettings()).apkSentSha === sha) return NextResponse.json({ ok: true, sent: false });
    const chat = (await getSettings().catch(() => null))?.ownerNotifyChatId || "";
    if (!chat) return NextResponse.json({ ok: false, error: "no owner chat configured" }, { status: 409 });
    const gradle = await fs.readFile(path.join(process.cwd(), "android", "app", "build.gradle"), "utf8").catch(() => "");
    const ver = /versionName\s+'([^']+)'/.exec(gradle)?.[1] ?? "?";
    const code = /versionCode\s+(\d+)/.exec(gradle)?.[1] ?? "?";
    await getBot().api.sendDocument(chat, new InputFile(data, `MyMusic-${ver}.apk`), {
      caption: `📱 My Music برای اندروید — نسخه ${ver} (build ${code})\nروی نسخه‌ی قبلی نصب می‌شه؛ اگه نصب نشد، قبلی رو پاک کن.\nsha256: ${sha.slice(0, 12)}`,
    });
    await setSetting("apkSentSha", sha);
    reportInfo("apk", `MyMusic APK ${ver} (build ${code}) sent to the owner in Telegram`);
    return NextResponse.json({ ok: true, sent: true });
  } catch (err) {
    reportError("apk", "sending the APK to Telegram failed:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
