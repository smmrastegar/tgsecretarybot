// Channel files over 20 MB: Telegram lets a bot download only 20 MB through its public Bot API, so a SECOND bot (an admin of the
// channel) talks to a local Bot API server (deploy/botapi-setup.sh, 127.0.0.1:8081, no size limit) and hands those files to the same
// intake pipeline. The main bot keeps doing everything else. A file id only works for the bot that saw the post, hence the separate id.
import { promises as fs } from "node:fs";
import { attachBigFile, getAllSettings, setSetting } from "./db";
import { intakeChatId } from "./music-intake";
import { reportInfo, reportWarn } from "./report";

const LOCAL = "http://127.0.0.1:8081";
export const BIG_LIMIT = 20 * 1024 * 1024;

export type BigConfig = { apiId: string; apiHash: string; token: string };
export async function bigConfig(): Promise<BigConfig | null> {
  const s = await getAllSettings();
  const apiId = (s.tgBotApiId ?? "").trim(), apiHash = (s.tgBotApiHash ?? "").trim(), token = (s.tgBigBotToken ?? "").trim();
  return apiId && apiHash && token ? { apiId, apiHash, token } : null;
}

async function local<T>(token: string, method: string, params: Record<string, unknown> = {}, ms = 30_000): Promise<T> {
  const r = await fetch(`${LOCAL}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout(ms) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

/** Is the local Bot API server answering? (any HTTP answer means yes) */
export async function localServerUp(): Promise<boolean> {
  try { await fetch(`${LOCAL}/`, { signal: AbortSignal.timeout(3000) }); return true; } catch { return false; }
}

/** The second bot's name, for the dashboard (null when the local server is down or the token is wrong). */
export async function bigBotInfo(): Promise<{ username: string } | null> {
  const c = await bigConfig();
  if (!c) return null;
  try { const me = await local<{ username?: string }>(c.token, "getMe", {}, 8000); return { username: me.username ?? "?" }; } catch { return null; }
}

/** A bot that was used on Telegram's public servers must be logged out there once before a local server may take it over. */
async function ensureLoggedOutFromCloud(token: string): Promise<boolean> {
  const s = await getAllSettings();
  if (s.tgBigBotCloudOut === token.slice(0, 12)) return true;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/logOut`, { method: "POST", signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error_code?: number; description?: string };
    // 401 / "Logged out" / a 429 saying it is in the middle of it: all mean it is (or is about to be) off the public server
    if (j.ok || j.error_code === 401 || /logged out|already/i.test(j.description ?? "")) { await setSetting("tgBigBotCloudOut", token.slice(0, 12)); return true; }
    reportWarn("music", `large-file bot: logOut from the public server said: ${j.description ?? r.status}`);
  } catch (e) { reportWarn("music", "large-file bot: logOut failed:", e); }
  return false;
}

type Post = { message_id: number; chat: { id: number }; audio?: { file_id: string; file_name?: string; file_size?: number; duration?: number; title?: string; performer?: string }; document?: { file_id: string; file_name?: string; file_size?: number; mime_type?: string } };

/** Cron step: ask the large-file bot for new channel posts; every audio file over 20 MB is handed to the intake. Never throws. */
export async function bigBotStep(): Promise<number> {
  let handed = 0;
  try {
    const c = await bigConfig();
    if (!c) return 0;
    const chat = await intakeChatId();
    if (!chat) return 0;
    if (!(await localServerUp())) return 0; // not installed yet (or still building): nothing to do
    if (!(await ensureLoggedOutFromCloud(c.token))) return 0;
    const s = await getAllSettings();
    const offset = Number(s.tgBigBotOffset || 0);
    const updates = await local<Array<{ update_id: number; channel_post?: Post }>>(c.token, "getUpdates", { offset: offset || undefined, limit: 50, timeout: 0, allowed_updates: ["channel_post"] });
    let last = offset;
    for (const u of updates) {
      last = Math.max(last, u.update_id + 1);
      const m = u.channel_post;
      if (!m || m.chat.id !== chat) continue;
      const a = m.audio, d = m.document;
      const doc = d && ((d.mime_type ?? "").startsWith("audio/") || /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i.test(d.file_name ?? "")) ? d : null;
      const f = a ?? doc;
      if (!f || (f.file_size ?? 0) <= BIG_LIMIT) continue; // smaller files are the main bot's job
      const id = await attachBigFile({ chatId: m.chat.id, messageId: m.message_id, fileId: f.file_id, fileName: f.file_name ?? null, fileSize: f.file_size ?? null, durationS: a?.duration ?? null, tgTitle: a?.title ?? null, tgPerformer: a?.performer ?? null });
      if (id) { handed++; reportInfo("music", `large-file bot: channel post ${m.message_id} (${Math.round((f.file_size ?? 0) / 1048576)} MB) handed to the intake as #${id}`); }
    }
    if (last !== offset) await setSetting("tgBigBotOffset", String(last));
    if (handed > 0) { const { intakeStep } = await import("./music-intake"); void intakeStep(2).catch(() => {}); }
  } catch (e) { reportWarn("music", "large-file bot step failed:", e); }
  return handed;
}

/** Download a file the large-file bot saw: the local server answers getFile with a path on this machine's disk. */
export async function downloadBigFile(fileId: string): Promise<{ data: Uint8Array; name: string }> {
  const c = await bigConfig();
  if (!c) throw new Error("the large-file bot is not configured");
  const f = await local<{ file_path?: string }>(c.token, "getFile", { file_id: fileId }, 120_000);
  if (!f.file_path) throw new Error("getFile gave no path");
  const data = new Uint8Array(await fs.readFile(f.file_path));
  return { data, name: f.file_path.split("/").pop() ?? "audio.mp3" };
}
