// Songs the owner sends BY HAND to the intake channel (settings.musicIntakeChat): each audio file is analysed, the bot
// proposes what song it is (Spotify first, confirmed by comparing the audio with the song's 30 s preview; otherwise iTunes /
// Deezer names and covers), the owner confirms in the bot, the song joins the library as a "Single" (source "manual"), and the
// channel keeps ONE tidy copy (right name, artist, cover) instead of the original upload.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { config } from "./config";
import {
  claimNextIntake, createManualTrack, expireBigWait, getAllSettings, getIntake, insertIntake, isAllowedUser, listBusinessConnections, photoBeforeIntake, saveIntakePhoto,
  setSetting, trackBySpotifyId, updateIntake, updateMusicTrack, type IntakeRow,
} from "./db";
import { MUSIC_DIR } from "./music";
import { ffmpegPath } from "./music-analysis";
import { lookupDeezer, lookupItunes, lookupLibrary, lookupSpotify, recognizeAudd, type Candidate } from "./music-lookup";
import { background } from "./background";
import { attachPendingLyrics } from "./music-lyrics";
import { cleanTagText, guessFromFileName, nameScore, nameWords, parseTitleArtist } from "./music-names";
import { fileScore, PREVIEW_BAD, PREVIEW_OK, previewScore } from "./music-preview";
import { pageMeta } from "./music-spotsaver";
import { reportWarn } from "./report";
import { downloadTelegramFile } from "./stt";

const INTAKE_DIR = path.join(MUSIC_DIR, "intake");
const MAX_BYTES = 20 * 1024 * 1024; // what a bot may download from Telegram
const AUDIO_EXT = /\.(mp3|flac|m4a|aac|ogg|opus|wav)$/i;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
const SRC_LABEL: Record<Candidate["source"], string> = { library: "کتابخانهٔ خودمان", spotify: "Spotify", itunes: "iTunes", deezer: "Deezer", audd: "AudD (شناسایی صدا)", tags: "تگ فایل / نام فایل" };

// ---------------------------------------------------------------- receiving

export async function intakeChatId(): Promise<number | null> {
  const v = Number(((await getAllSettings()).musicIntakeChat ?? "").trim());
  return Number.isFinite(v) && v !== 0 ? v : null;
}

/** A channel post with an audio file in the intake channel → queued for analysis. Returns true when it was one. */
export async function maybeEnqueueIntake(msg: Message): Promise<boolean> {
  const chat = await intakeChatId();
  if (!chat || msg.chat.id !== chat) return false;
  const a = msg.audio, d = msg.document;
  // A voice message is a short clip to identify ("which song is this?"), not a song to keep.
  if (msg.voice) {
    const v = msg.voice;
    const vid = await insertIntake({ chatId: msg.chat.id, messageId: msg.message_id, fileId: v.file_id, fileName: null, fileSize: v.file_size ?? null, durationS: v.duration ?? null, tgTitle: null, tgPerformer: null, kind: "voice" });
    if (vid) { const { background } = await import("./background"); background("musicIntake", intakeStep(1)); }
    return true;
  }
  // A picture posted in the channel (an album cover sent ahead of its songs) is remembered: the songs that follow can use it as their cover.
  const pic = msg.photo?.length ? msg.photo[msg.photo.length - 1]! : d && (d.mime_type ?? "").startsWith("image/") ? d : null;
  if (pic) { await saveIntakePhoto(msg.chat.id, msg.message_id, pic.file_id).catch(() => {}); return true; }
  const doc = d && ((d.mime_type ?? "").startsWith("audio/") || AUDIO_EXT.test(d.file_name ?? "")) ? d : null;
  const file = a ?? doc;
  if (!file) return false;
  const id = await insertIntake({
    chatId: msg.chat.id, messageId: msg.message_id, fileId: file.file_id, fileName: file.file_name ?? null, fileSize: file.file_size ?? null,
    durationS: a?.duration ?? null, tgTitle: a?.title ?? null, tgPerformer: a?.performer ?? null,
  });
  if (id) { const { background } = await import("./background"); background("musicIntake", intakeStep(1)); }
  return true;
}

// ---------------------------------------------------------------- analysis

export type Tags = { title: string | null; artist: string | null; album: string | null; date: string | null; durationS: number | null };

export function probe(file: string): Promise<Tags> {
  return new Promise(async (resolve) => {
    const child = spawn(await ffmpegPath(), ["-hide_banner", "-i", file, "-f", "ffmetadata", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { err += b.toString(); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    const done = () => {
      clearTimeout(timer);
      const g = (k: string) => new RegExp(`^${k}=(.*)$`, "im").exec(out)?.[1]?.trim() || null;
      const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      resolve({ title: g("title"), artist: g("artist"), album: g("album"), date: g("date") ?? g("year"), durationS: dm ? Math.round(Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])) : null });
    };
    child.on("close", done); child.on("error", done);
  });
}

async function runFfmpeg(args: string[], ms = 120_000): Promise<boolean> {
  return new Promise(async (resolve) => {
    const child = spawn(await ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), ms);
    child.on("close", (c) => { clearTimeout(timer); resolve(c === 0); });
    child.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}

const exists = async (p: string) => fs.stat(p).then((s) => s.size > 0).catch(() => false);

const keyOf = (c: Candidate) => `${nameWords(c.title).join(" ")}|${nameWords(c.artist).slice(0, 2).join(" ")}`;
const PRIORITY: Record<Candidate["source"], number> = { audd: 0, library: 0.5, spotify: 1, itunes: 2, deezer: 3, tags: 9 };

/** Merge look-alikes (same song from several catalogues): the best source keeps the lead, covers and preview are pooled. */
function merge(list: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const c of list) {
    const k = c.spotifyId ? `sp:${c.spotifyId}` : keyOf(c);
    const alt = [...by.entries()].find(([kk, v]) => kk === k || keyOf(v) === keyOf(c));
    if (!alt) { by.set(k, { ...c, covers: [...c.covers] }); continue; }
    const cur = alt[1];
    const better = PRIORITY[c.source] < PRIORITY[cur.source];
    const lead = better ? { ...c, covers: [...c.covers] } : cur;
    const other = better ? cur : c;
    lead.covers = [...new Set([...lead.covers, ...other.covers])];
    lead.previewUrl = lead.previewUrl ?? other.previewUrl;
    lead.spotifyId = lead.spotifyId ?? other.spotifyId;
    lead.album = lead.album ?? other.album; lead.releaseDate = lead.releaseDate ?? other.releaseDate; lead.durationS = lead.durationS ?? other.durationS;
    lead.name = Math.max(lead.name, other.name);
    by.set(alt[0], lead);
  }
  return [...by.values()];
}

type Known = { title: string | null; artist: string | null; text: string; album?: string | null };

/** Search the catalogues, score names, and confirm by audio where a preview exists. */
async function findCandidates(row: IntakeRow, file: string, known: Known, queries: string[], opts: { spotify: boolean }, trace: string[] = []): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const note = (src: string, q: string, r: Candidate[], err?: unknown) => trace.push(`${src} «${q}» → ${err ? `error ${String(err instanceof Error ? err.message : err).slice(0, 80)}` : `${r.length}: ${r.slice(0, 3).map((x) => `${x.title}—${x.artist}`).join(" | ")}`}`);
  if (opts.spotify) { const a = await recognizeAudd(file); note("audd", "(file)", a); found.push(...a); }
  // Our own library first: the same song is often already here (imported from an account) with the right names, album and cover.
  const lib = await lookupLibrary(known); note("library", known.text, lib); found.push(...lib);
  for (const q of queries.slice(0, 4)) {
    if (!opts.spotify) break;
    try { const r = await lookupSpotify(q); note("spotify", q, r); found.push(...r); } catch (e) { note("spotify", q, [], e); reportWarn("music", "intake: spotify search failed:", e); }
  }
  for (const q of queries.slice(0, 2)) {
    const [i, d] = [await lookupItunes(q), await lookupDeezer(q)];
    note("itunes", q, i); note("deezer", q, d); found.push(...i, ...d);
  }
  const cands = merge(found);
  for (const c of cands) if (c.source !== "audd" && c.source !== "library") c.name = nameScore(c, known);
  cands.sort((a, b) => b.name - a.name || PRIORITY[a.source] - PRIORITY[b.source]);
  // Audio check of the most promising ones (a preview that matches the file = it IS that recording).
  const started = Date.now();
  let checked = 0;
  for (const c of cands) {
    if (checked >= 5 || Date.now() - started > 150_000) break;
    if (c.name < 0.4 && cands.length > 3) continue;
    if (c.localPath) { c.audio = await fileScore(file, c.localPath).catch(() => null); checked++; continue; } // our own copy: compare the whole audio
    let url = c.previewUrl;
    if (!url && c.spotifyId) url = (await pageMeta(`https://open.spotify.com/track/${c.spotifyId}`).catch(() => null))?.previewUrl || null;
    if (!url) continue;
    c.previewUrl = url;
    c.audio = await previewScore(file, url).catch(() => null);
    checked++;
  }
  // verified by audio first (best match first), then unchecked, then weak audio; ties by name agreement and source.
  const rank = (c: Candidate) => ((c.audio ?? -1) >= PREVIEW_OK ? 3 : c.audio == null ? 2 : c.audio >= PREVIEW_BAD ? 1 : 0);
  cands.sort((a, b) => rank(b) - rank(a) || (rank(a) === 3 ? (b.audio ?? 0) - (a.audio ?? 0) : 0) || b.name - a.name || PRIORITY[a.source] - PRIORITY[b.source]);
  void row;
  const knowsSomething = !!(known.title || known.artist);
  // Unrelated search noise (the names do not agree and the audio did not confirm it) is not shown.
  return cands.filter((c) => (c.audio ?? -1) >= PREVIEW_OK || c.source === "audd" || !knowsSomething || c.name >= 0.4)
    .filter((c) => !(c.audio != null && c.audio < PREVIEW_BAD && c.name < 0.6)).slice(0, 8);
}

/** The picture the owner posted just before this file (an album cover): saved next to the intake files and offered as a cover — first for songs no catalogue vouches for. */
async function channelCoverFile(row: IntakeRow): Promise<string | null> {
  const ph = await photoBeforeIntake(row.id).catch(() => null);
  if (!ph) return null;
  const out = path.join(INTAKE_DIR, `photo-${ph.messageId}.jpg`);
  if (await exists(out)) return out;
  try {
    await fs.mkdir(INTAKE_DIR, { recursive: true });
    const f = await downloadTelegramFile(config.telegramBotToken, ph.fileId);
    await fs.writeFile(out, f.data);
    return out;
  } catch { return null; }
}

async function addChannelCover(row: IntakeRow, cands: Candidate[], fallback: Candidate | null): Promise<void> {
  const file = await channelCoverFile(row);
  if (!file) return;
  const ref = `file:${file}`;
  for (const c of [...cands, ...(fallback ? [fallback] : [])]) {
    const vouched = c.source === "audd" || (c.audio ?? -1) >= PREVIEW_OK || (c.spotifyId != null && c.name >= 0.85);
    if (c.covers.includes(ref)) continue;
    if (vouched) c.covers.push(ref); else c.covers.unshift(ref);
  }
}

/** The "I only know what the file says" fallback, always the last choice. */
function tagsCandidate(known: Known, tags: Tags, hasEmbedded: boolean, durationS: number | null): Candidate | null {
  const title = known.title ?? known.text;
  if (!title) return null;
  return { source: "tags", title, artist: known.artist ?? "Unknown", album: tags.album, releaseDate: tags.date?.slice(0, 10) ?? null, durationS, spotifyId: null, previewUrl: null, covers: hasEmbedded ? ["embedded"] : [], audio: null, name: 0 };
}

function knownFrom(row: IntakeRow, tags: Tags): Known {
  const g = guessFromFileName(row.fileName ?? "");
  const title = cleanTagText(tags.title ?? row.tgTitle) ?? g.title;
  const artist = cleanTagText(tags.artist ?? row.tgPerformer) ?? g.artist;
  return { title, artist, album: tags.album, text: [artist, title].filter(Boolean).join(" ") || (row.fileName ?? "").replace(/\.[a-z0-9]+$/i, "") };
}

function queriesFor(row: IntakeRow, known: Known): string[] {
  const g = guessFromFileName(row.fileName ?? "");
  const q = [
    known.title && known.artist ? `track:"${known.title}" artist:"${known.artist.split(/[,&]/)[0]!.trim()}"` : null,
    known.title && known.artist ? `${known.title} ${known.artist}` : null,
    known.artist ? `artist:"${known.artist.split(/[,&]/)[0]!.trim()}"` : null, // the artist's own songs: a differently spelled title is still found
    ...g.queries, known.title, known.text,
  ].filter((x): x is string => !!x && x.trim().length >= 2);
  return [...new Set(q)];
}

/** A voice clip: identified by audio recognition only (it carries no names). Needs settings.auddToken for clips shorter than the previews. */
async function analyzeVoice(row: IntakeRow, file: string): Promise<void> {
  const clip = path.join(INTAKE_DIR, `${row.id}.clip.mp3`);
  const ok = await runFfmpeg(["-i", file, "-t", "30", "-ac", "1", "-ar", "44100", clip], 60_000) && (await exists(clip));
  const hasToken = !!((await getAllSettings()).auddToken ?? "").trim();
  const cands = hasToken ? await recognizeAudd(ok ? clip : file) : [];
  const trace = [`audd ${hasToken ? "→ " + cands.length : "(no token configured)"}`];
  // confirm Spotify ones against the 30 s preview (the clip slides over it)
  for (const c of cands) {
    const url = c.previewUrl || (c.spotifyId ? (await pageMeta(`https://open.spotify.com/track/${c.spotifyId}`).catch(() => null))?.previewUrl : null);
    if (url) { c.previewUrl = url; c.audio = await previewScore(ok ? clip : file, url).catch(() => null); }
  }
  await updateIntake(row.id, { localPath: file, tags: { debug: trace, voice: true }, candidates: cands, idx: 0, coverIdx: 0, status: "pending", error: null });
  await sendCard(row.id);
}

async function analyze(row: IntakeRow): Promise<void> {
  if ((row.fileSize ?? 0) > MAX_BYTES && !row.bigFileId) {
    // With the large-file bot configured, park it quietly: that bot fetches it within a minute (and the owner is told only if it never does).
    const { bigConfig } = await import("./big-bot");
    if (await bigConfig()) { await updateIntake(row.id, { status: "bigwait", error: null }); return; }
    // Telegram lets a bot download only 20 MB: the song is not lost — it waits (named from its tags / file name, editable) for the file to be uploaded by hand.
    const k = knownFrom(row, { title: null, artist: null, album: null, date: null, durationS: null });
    await updateIntake(row.id, { status: "upload", error: null, tags: { title: k.title ?? k.text ?? null, artist: k.artist ?? null, upload: true } });
    await sendCard(row.id);
    return;
  }
  await fs.mkdir(INTAKE_DIR, { recursive: true });
  const f = row.bigFileId ? await (await import("./big-bot")).downloadBigFile(row.bigFileId) : await downloadTelegramFile(config.telegramBotToken, row.fileId);
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(row.fileName ?? f.name)?.[1] ?? "mp3").toLowerCase();
  const file = path.join(INTAKE_DIR, `${row.id}.${ext}`);
  await fs.writeFile(file, f.data);
  if (row.kind === "voice") { await analyzeVoice(row, file); return; }
  const tags = await probe(file);
  const embedded = path.join(INTAKE_DIR, `${row.id}.embedded.jpg`);
  const hasEmbedded = await runFfmpeg(["-i", file, "-an", "-frames:v", "1", embedded], 30_000) && (await exists(embedded));
  const known = knownFrom(row, tags);
  const trace: string[] = [];
  const cands = await findCandidates(row, file, known, queriesFor(row, known), { spotify: true }, trace);
  const fallback = tagsCandidate(known, tags, hasEmbedded, tags.durationS ?? row.durationS);
  if (hasEmbedded) for (const c of cands) if (!c.covers.includes("embedded")) c.covers.push("embedded");
  await addChannelCover(row, cands, fallback);
  if (fallback) {
    // A file whose own tags name BOTH the title and the artist already says what it is: those names lead, unless a catalogue entry
    // is clearly the same song (names agree, or the audio matched its preview) — then that richer entry stays first.
    const strong = cands[0] && ((cands[0].audio ?? -1) >= PREVIEW_OK || cands[0].source === "audd" || cands[0].name >= 0.85);
    if (tags.title && tags.artist && !strong) cands.unshift(fallback); else cands.push(fallback);
  }
  await updateIntake(row.id, { localPath: file, coverPath: hasEmbedded ? embedded : null, tags: { ...tags, debug: trace }, candidates: cands, idx: 0, coverIdx: 0, status: "pending", error: null });
  await sendCard(row.id);
}

/** Cron / right after a post: analyse queued files. Never throws. */
export async function intakeStep(max = 2): Promise<number> {
  let n = 0;
  try {
    for (const id of await expireBigWait()) await sendCard(id).catch(() => {}); // the large-file bot never delivered: ask for a hand upload
    for (; n < max; n++) {
      const row = await claimNextIntake();
      if (!row) break;
      try { await analyze(row); }
      catch (err) {
        reportWarn("music", `intake ${row.id} failed:`, err);
        await updateIntake(row.id, { status: "failed", error: String(err instanceof Error ? err.message : err).slice(0, 300) });
        await sendCard(row.id);
      }
    }
  } catch (err) { reportWarn("music", "intake step failed:", err); }
  return n;
}

// ---------------------------------------------------------------- the owner's card

async function ownerChat(): Promise<number | null> {
  const v = Number((await getAllSettings()).ownerNotifyChatId);
  if (Number.isFinite(v) && v !== 0) return v;
  return (await listBusinessConnections().catch(() => []))[0]?.userChatId ?? null;
}

const getBot = async () => (await import("./bot")).getBot();

function cardText(row: IntakeRow): string {
  const cands = row.candidates as Candidate[];
  const c = cands[row.idx % Math.max(1, cands.length)];
  if (!c) return "";
  const lines: string[] = [row.kind === "voice" ? `🎙 <b>ویس کانال «My Music» شناسایی شد</b> — درست است؟` : `🎵 <b>آهنگ تازه در «My Music»</b> — تأیید کن`, "", `<b>${esc(c.title)}</b>`, `👤 ${esc(c.artist)}`];
  const meta = [c.album && c.album !== c.title ? `💿 ${esc(c.album)}` : null, c.releaseDate ? esc(c.releaseDate.slice(0, 4)) : null].filter(Boolean).join(" · ");
  if (meta) lines.push(meta);
  let src = `🔗 منبع: ${SRC_LABEL[c.source]}${c.libraryId ? ` (آهنگ #${c.libraryId})` : ""}`;
  if (c.audio != null) src += c.audio >= PREVIEW_OK ? ` ✅ صدا با نمونهٔ ۳۰ثانیه‌ای می‌خواند (${Math.round(c.audio * 100)}٪)` : c.audio >= PREVIEW_BAD ? ` 🟡 شباهت صدا کم است (${Math.round(c.audio * 100)}٪)` : ` ❌ صدا نمی‌خواند (${Math.round(c.audio * 100)}٪)`;
  else if (c.source === "audd") src += " ✅";
  else if (c.source !== "tags") src += " · صدا قابل مقایسه نبود";
  lines.push(src);
  if (c.spotifyId) lines.push(`🎧 <a href="https://open.spotify.com/track/${c.spotifyId}">https://open.spotify.com/track/${c.spotifyId}</a>`);
  if (c.source === "library" && (c.audio ?? 0) >= PREVIEW_OK) lines.push("♻️ این فایل از نظر صدا همان آهنگِ موجود در کتابخانه است؛ نام و کاور از همان گرفته شده و فایل تازه به‌عنوان نسخهٔ جدا (Single) اضافه می‌شود.");
  if (c.source === "tags") lines.push("⚠️ در اسپاتیفای/کاتالوگ‌ها چیزی مطمئن پیدا نشد؛ فقط همین نام‌ها از خود فایل است.");
  else if (!c.spotifyId) lines.push("ℹ️ در اسپاتیفای پیدا نشد؛ نام و کاور از " + SRC_LABEL[c.source] + ".");
  const covers = c.covers;
  lines.push(covers.length ? `🖼 کاور ${(row.coverIdx % covers.length) + 1} از ${covers.length}${covers[row.coverIdx % covers.length] === "embedded" ? " (داخل خود فایل)" : ""}` : "🖼 کاوری پیدا نشد");
  lines.push(`پیشنهاد ${(row.idx % cands.length) + 1} از ${cands.length}`);
  return lines.join("\n");
}

async function cardKeyboard(row: IntakeRow): Promise<InlineKeyboard> {
  const cands = row.candidates as Candidate[];
  const c = cands[row.idx % Math.max(1, cands.length)];
  const dup = c?.spotifyId ? await trackBySpotifyId(c.spotifyId) : null;
  const kb = new InlineKeyboard();
  if (c?.spotifyId) kb.url("🔗 باز کردن در اسپاتیفای (چک دستی)", `https://open.spotify.com/track/${c.spotifyId}`).row();
  if (dup && row.kind === "voice") kb.text("ℹ️ از قبل در کتابخانه هست؛ ویس را پاک کن", `mi:${row.id}:ok`).row();
  else if (dup) kb.text("➕ نسخهٔ جدا اضافه کن (از قبل در کتابخانه هست)", `mi:${row.id}:dup`).row();
  else kb.text(row.kind === "voice" ? "✅ درست است؛ آهنگ کامل را اضافه کن" : "✅ تأیید و اضافه کن", `mi:${row.id}:ok`).row();
  if (cands.length > 1) kb.text("➡️ پیشنهاد بعدی", `mi:${row.id}:next`);
  if ((c?.covers.length ?? 0) > 1) kb.text("🖼 کاور بعدی", `mi:${row.id}:cover`);
  if (cands.length > 1 || (c?.covers.length ?? 0) > 1) kb.row();
  kb.text("✏️ ویرایش نام", `mi:${row.id}:edit`).text("🔎 اینها نیست", `mi:${row.id}:indep`).row();
  kb.text("🗑 رد کن", `mi:${row.id}:rej`);
  return kb;
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(20_000) }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}

export async function sendCard(id: number): Promise<void> {
  const row = await getIntake(id);
  const chat = await ownerChat();
  if (!row || !chat) return;
  const bot = await getBot();
  if (row.cardChat && row.cardMessageId) await bot.api.deleteMessage(row.cardChat, row.cardMessageId).catch(() => {});
  let sent: { message_id: number } | null = null;
  if (row.status === "upload") {
    const t = row.tags as { title?: string | null; artist?: string | null } | null;
    const mb = Math.round((row.fileSize ?? 0) / 1048576);
    const { getLegacyToken } = await import("./music-token");
    const link = `${(process.env.PLAYER_APP_URL || "https://playlist.bz").replace(/\/$/, "")}/player/${await getLegacyToken()}#add`;
    sent = await bot.api.sendMessage(chat,
      `📦 <b>فایل ${mb}MB است</b> — ربات تلگرام نمی‌تواند بیشتر از ۲۰MB را بگیرد، اما آهنگ گم نشده.\n\n<b>${esc(t?.title ?? row.fileName ?? "بدون نام")}</b>\n👤 ${esc(t?.artist ?? "—")}\n\nنام را درست کن (✏️)، بعد فایل را از پلیر ← <b>Add songs</b> آپلود کن؛ نام و کاور همان‌جا هم قابل ویرایش است.`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().url("⬆️ باز کردن صفحهٔ آپلود در پلیر", link).row().text("✏️ ویرایش نام", `mi:${id}:edit`).text("🗑 رد کن", `mi:${id}:rej`) }).catch(() => null);
  } else if (row.status === "failed") {
    sent = await bot.api.sendMessage(chat, `⚠️ آهنگ جدیدِ «${esc(row.fileName ?? "بدون نام")}» در My Music بررسی نشد:\n${esc(row.error ?? "")}`, {
      parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🔄 دوباره تلاش کن", `mi:${id}:retry`).text("🗑 رد کن", `mi:${id}:rej`),
    }).catch(() => null);
  } else {
    const cands = row.candidates as Candidate[];
    const c = cands[row.idx % Math.max(1, cands.length)];
    if (!c) {
      const voice = row.kind === "voice";
      const hasToken = !!((await getAllSettings()).auddToken ?? "").trim();
      const why = voice
        ? (hasToken ? "این تکه‌صدا شناسایی نشد." : "برای شناسایی یک تکهٔ کوتاه به سرویس شناسایی صدا (AudD) نیاز است و توکنش هنوز در تنظیمات نیست.") + "\nاگر نام آهنگ را می‌دانی، «ویرایش نام» را بزن."
        : "برای این فایل هیچ پیشنهادی نساختم.";
      sent = await bot.api.sendMessage(chat, `🎙 ${voice ? "ویس کانال My Music" : "فایل کانال My Music"}: ${why}`, { reply_markup: new InlineKeyboard().text("✏️ ویرایش نام", `mi:${id}:edit`).text("🗑 رد کن", `mi:${id}:rej`) }).catch(() => null);
      if (sent) await updateIntake(id, { cardChat: chat, cardMessageId: sent.message_id });
      return;
    }
    const caption = cardText(row), kb = await cardKeyboard(row);
    const cover = c.covers.length ? c.covers[row.coverIdx % c.covers.length]! : null;
    const opts = { caption, parse_mode: "HTML" as const, reply_markup: kb };
    if (cover === "embedded" && row.coverPath) sent = await bot.api.sendPhoto(chat, new InputFile(row.coverPath), opts).catch(() => null);
    else if (cover?.startsWith("file:")) sent = await bot.api.sendPhoto(chat, new InputFile(cover.slice(5)), opts).catch(() => null);
    else if (cover) {
      sent = await bot.api.sendPhoto(chat, cover, opts).catch(() => null);
      if (!sent) { const img = await fetchImage(cover); if (img) sent = await bot.api.sendPhoto(chat, new InputFile(img, "cover.jpg"), opts).catch(() => null); }
    }
    if (!sent) sent = await bot.api.sendMessage(chat, caption, { parse_mode: "HTML", reply_markup: kb }).catch(() => null);
  }
  if (sent) await updateIntake(id, { cardChat: chat, cardMessageId: sent.message_id });
}

// ---------------------------------------------------------------- confirming

async function tidyFile(src: string, ext: string, cover: string | null, c: Candidate, outBase: string): Promise<string> {
  const out = `${outBase}.${ext}`;
  const args = ["-i", src, ...(cover ? ["-i", cover] : []), "-map", "0:a", ...(cover ? ["-map", "1:v"] : []), "-map_metadata", "-1", "-c", "copy",
    ...(cover ? ["-disposition:v:0", "attached_pic"] : []), "-metadata", `title=${c.title}`, "-metadata", `artist=${c.artist}`, "-metadata", "album=Single",
    ...(ext === "mp3" ? ["-id3v2_version", "3"] : []), out];
  return (await runFfmpeg(args)) && (await exists(out)) ? out : src;
}

/** A voice clip was identified: the SONG (not the clip) is queued for download through the normal Spotify route. */
async function finalizeVoice(row: IntakeRow, bot: Bot): Promise<string> {
  const cands = row.candidates as Candidate[];
  const c = cands[row.idx % Math.max(1, cands.length)];
  if (!c?.spotifyId) throw new Error("این پیشنهاد شناسهٔ اسپاتیفای ندارد؛ فقط آهنگ‌های اسپاتیفای از روی ویس اضافه می‌شوند");
  const { addMusicTrack } = await import("./db");
  const r = await addMusicTrack(c.spotifyId, `https://open.spotify.com/track/${c.spotifyId}`);
  const { kickMusicQueue } = await import("./music");
  if (r.created) await kickMusicQueue().catch(() => {});
  await updateIntake(row.id, { status: "confirmed", trackId: r.track?.id ?? null });
  await bot.api.deleteMessage(row.chatId, row.messageId).catch(() => {});
  if (row.localPath) await fs.unlink(row.localPath).catch(() => {});
  return r.removed ? "این آهنگ قبلاً از کتابخانه حذف شده بود و دوباره اضافه نشد." : r.created ? `✅ «${c.title}» — ${c.artist} به صف دانلود اضافه شد؛ ویس از کانال پاک شد.` : `ℹ️ «${c.title}» از قبل در کتابخانه هست؛ ویس از کانال پاک شد.`;
}

async function finalize(row: IntakeRow, bot: Bot, force: boolean): Promise<string> {
  if (row.kind === "voice") return finalizeVoice(row, bot);
  const cands = row.candidates as Candidate[];
  const c = cands[row.idx % Math.max(1, cands.length)];
  if (!c || !row.localPath) throw new Error("nothing to add");
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(row.localPath)?.[1] ?? "mp3").toLowerCase();
  const spotifyId = force ? null : c.spotifyId;
  const mime = ext === "flac" ? "audio/flac" : ext === "ogg" || ext === "opus" ? "audio/ogg" : ext === "m4a" || ext === "aac" ? "audio/mp4" : ext === "wav" ? "audio/wav" : "audio/mpeg";
  // cover: the chosen picture (downloaded), else the one inside the file
  const pick = c.covers.length ? c.covers[row.coverIdx % c.covers.length]! : null;
  let coverFile: string | null = null;
  if (pick?.startsWith("file:")) {
    coverFile = path.join(INTAKE_DIR, `${row.id}.chosen.jpg`);
    await fs.copyFile(pick.slice(5), coverFile).catch(() => { coverFile = null; });
  } else if (pick && pick !== "embedded") {
    const img = await fetchImage(pick);
    if (img) { coverFile = path.join(INTAKE_DIR, `${row.id}.chosen.jpg`); await fs.writeFile(coverFile, img); }
  }
  if (!coverFile && row.coverPath && (await exists(row.coverPath))) coverFile = row.coverPath;
  const tidy = await tidyFile(row.localPath, ext, coverFile, c, path.join(INTAKE_DIR, `${row.id}.tidy`));
  const size = (await fs.stat(tidy)).size;
  const trackId = await createManualTrack({ spotifyId, title: c.title, artist: c.artist, album: "Single", releaseDate: c.releaseDate, durationS: c.durationS ?? row.durationS, filePath: tidy, mime, sizeBytes: size });
  const finalPath = path.join(MUSIC_DIR, `${trackId}.${ext}`);
  await fs.copyFile(tidy, finalPath);
  let coverPath: string | null = null;
  if (coverFile) { coverPath = path.join(MUSIC_DIR, `${trackId}.cover.jpg`); await fs.copyFile(coverFile, coverPath); }
  await updateMusicTrack(trackId, { filePath: finalPath, coverPath });
  await attachPendingLyrics(trackId, c.title);
  // The channel keeps one tidy copy: send it, then remove the original upload.
  try {
    let thumb: InputFile | undefined;
    if (coverFile) {
      const t = path.join(INTAKE_DIR, `${row.id}.thumb.jpg`);
      if (await runFfmpeg(["-i", coverFile, "-vf", "scale=320:320:force_original_aspect_ratio=decrease", "-q:v", "5", t], 30_000) && (await exists(t))) thumb = new InputFile(t);
    }
    await bot.api.sendAudio(row.chatId, new InputFile(finalPath, `${c.artist} - ${c.title}.${ext}`), { title: c.title, performer: c.artist, duration: c.durationS ?? row.durationS ?? undefined, thumbnail: thumb, caption: `🎵 ${c.title}\n👤 ${c.artist}` });
    await bot.api.deleteMessage(row.chatId, row.messageId).catch((e) => reportWarn("music", "intake: original not deleted:", e));
  } catch (err) { reportWarn("music", `intake ${row.id}: channel copy failed (original kept):`, err); }
  await updateIntake(row.id, { status: "confirmed", trackId });
  for (const p of [row.localPath, row.coverPath, tidy, coverFile, path.join(INTAKE_DIR, `${row.id}.thumb.jpg`)]) if (p && p !== finalPath) await fs.unlink(p).catch(() => {});
  return `✅ «${c.title}» — ${c.artist} به کتابخانه اضافه شد (Single${spotifyId ? " · اسپاتیفای" : ""}).`;
}

// ---------------------------------------------------------------- callbacks / typed edits

export async function handleIntakeCallback(ctx: Context, data: string, bot: Bot): Promise<void> {
  const from = ctx.from;
  const m = /^mi:(\d+):(\w+)$/.exec(data);
  if (!from || !m) { await ctx.answerCallbackQuery().catch(() => {}); return; }
  if (!(await isAllowedUser(from.id).catch(() => false))) { await ctx.answerCallbackQuery({ text: "فقط صاحب اکانت" }).catch(() => {}); return; }
  const id = Number(m[1]), act = m[2]!;
  const row = await getIntake(id);
  if (!row) { await ctx.answerCallbackQuery({ text: "پیدا نشد" }).catch(() => {}); return; }
  if (row.status === "confirmed") { await ctx.answerCallbackQuery({ text: "قبلاً اضافه شده" }).catch(() => {}); return; }
  const n = Math.max(1, (row.candidates as Candidate[]).length);
  try {
    if (act === "ok" || act === "dup") {
      await ctx.answerCallbackQuery({ text: "در حال اضافه کردن…" }).catch(() => {});
      const msg = await finalize(row, bot, act === "dup");
      if (row.cardChat && row.cardMessageId) await bot.api.deleteMessage(row.cardChat, row.cardMessageId).catch(() => {});
      await bot.api.sendMessage(row.cardChat ?? from.id, msg);
      return;
    }
    if (act === "next") { await updateIntake(id, { idx: (row.idx + 1) % n, coverIdx: 0 }); }
    else if (act === "cover") { await updateIntake(id, { coverIdx: row.coverIdx + 1 }); }
    else if (act === "rej") {
      await updateIntake(id, { status: "rejected" });
      for (const p of [row.localPath, row.coverPath]) if (p) await fs.unlink(p).catch(() => {});
      if (row.cardChat && row.cardMessageId) await bot.api.deleteMessage(row.cardChat, row.cardMessageId).catch(() => {});
      // Rejected = not needed: it goes from the channel too.
      const gone = await bot.api.deleteMessage(row.chatId, row.messageId).then(() => true).catch((e) => { reportWarn("music", `intake ${id}: rejected file not deleted from the channel:`, e); return false; });
      await ctx.answerCallbackQuery({ text: gone ? "رد شد و از کانال پاک شد" : "رد شد (از کانال پاک نشد)" }).catch(() => {});
      await bot.api.sendMessage(from.id, gone ? `🗑 «${row.fileName ?? "فایل"}» رد شد و از کانال My Music پاک شد؛ نیازی به آن نداریم.` : `🗑 «${row.fileName ?? "فایل"}» رد شد، ولی ربات اجازهٔ پاک‌کردن پیام در کانال را ندارد؛ «Delete messages» را برای ربات در ادمین‌های کانال روشن کن یا دستی پاکش کن.`).catch(() => {});
      return;
    } else if (act === "retry") {
      await updateIntake(id, { status: "new", error: null });
      await ctx.answerCallbackQuery({ text: "دوباره بررسی می‌شود" }).catch(() => {});
      await intakeStep(1);
      return;
    } else if (act === "edit") {
      await setSetting("musicIntakeEdit", `${id}:${Date.now()}`);
      await ctx.answerCallbackQuery().catch(() => {});
      await bot.api.sendMessage(from.id, "✏️ نام درست را به این شکل بفرست:\n«نام آهنگ - خواننده»\nمثلاً: Kooche Tanhaei - Martik");
      return;
    } else if (act === "indep") {
      await ctx.answerCallbackQuery({ text: "در حال جستجوی مستقل…" }).catch(() => {});
      await rebuild(row, await knownOf(row), false);
    }
    await ctx.answerCallbackQuery().catch(() => {});
    await sendCard(id);
  } catch (err) {
    reportWarn("music", `intake callback ${act} failed:`, err);
    await ctx.answerCallbackQuery({ text: "ناموفق بود؛ لاگ را ببین" }).catch(() => {});
    await bot.api.sendMessage(from.id, `⚠️ انجام نشد: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`).catch(() => {});
  }
}

async function knownOf(row: IntakeRow): Promise<Known> {
  return knownFrom(row, { title: row.tags?.title ?? null, artist: row.tags?.artist ?? null, album: row.tags?.album ?? null, date: row.tags?.date ?? null, durationS: null });
}

/** New candidate list for known names (typed by the owner, or "not these": without Spotify). */
async function rebuild(row: IntakeRow, known: Known, withSpotify: boolean, typed = false): Promise<void> {
  if (!row.localPath) throw new Error("file is gone");
  const queries = known.title && known.artist ? [`${known.title} ${known.artist}`, known.title] : [known.text];
  const cands = await findCandidates(row, row.localPath, known, queries, { spotify: withSpotify });
  const have = !!row.coverPath;
  if (have) for (const c of cands) if (!c.covers.includes("embedded")) c.covers.push("embedded");
  // a voice clip is only ever a question: its answer must be a real song, never "just these names"
  const fallback = row.kind === "voice" ? null : tagsCandidate(known, { title: null, artist: null, album: null, date: null, durationS: null }, have, row.durationS);
  await addChannelCover(row, cands, fallback);
  // Names the owner typed are an answer, not a search: exactly those names lead the list (catalogue matches follow as alternatives).
  if (fallback) { if (typed) cands.unshift(fallback); else cands.push(fallback); }
  await updateIntake(row.id, { candidates: cands, idx: 0, coverIdx: 0 });
}

/** The owner's next private message after "✏️ ویرایش نام" is the corrected name. Returns true when it was consumed. */
export async function handleIntakeText(m: Message, bot: Bot): Promise<boolean> {
  if (m.chat.type !== "private" || !m.from || !m.text || m.text.startsWith("/")) return false;
  const pend = (await getAllSettings()).musicIntakeEdit ?? "";
  const [idStr, at] = pend.split(":");
  if (!idStr || Date.now() - Number(at) > 15 * 60_000) return false;
  if (!(await isAllowedUser(m.from.id).catch(() => false))) return false;
  const row = await getIntake(Number(idStr));
  await setSetting("musicIntakeEdit", "");
  if (!row || row.status === "confirmed") return false;
  const p = parseTitleArtist(m.text);
  if (row.status === "upload") { // nothing to search yet (the file is not here): just keep the names for the upload
    await updateIntake(row.id, { tags: { title: p.title, artist: p.artist, upload: true } });
    await sendCard(row.id);
    return true;
  }
  await bot.api.sendMessage(m.chat.id, "🔎 دارم با این نام می‌گردم…").catch(() => {});
  try {
    await rebuild(row, { title: p.title, artist: p.artist, text: [p.artist, p.title].filter(Boolean).join(" ") }, true, true);
    await sendCard(row.id);
  } catch (err) { await bot.api.sendMessage(m.chat.id, `⚠️ جستجو نشد: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`).catch(() => {}); }
  return true;
}

// ---------------------------------------------------------------- a file uploaded by hand for a song the bot could not download

const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", wav: "audio/wav" };

/** Attach an uploaded file to a waiting intake item: names as given, cover = the channel photo, else the one inside the file. Returns the new song id. */
export async function finalizeUpload(rowId: number, upload: { data?: Uint8Array; path?: string; name: string }, title: string, artist: string): Promise<number> {
  const row = await getIntake(rowId);
  if (!row || row.status !== "upload") throw new Error("this item is not waiting for a file");
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(upload.name)?.[1] ?? "").toLowerCase();
  if (!AUDIO_MIME[ext]) throw new Error("supported: mp3, m4a, aac, ogg, opus, flac, wav");
  await fs.mkdir(INTAKE_DIR, { recursive: true });
  const src = path.join(INTAKE_DIR, `${row.id}.upload.${ext}`);
  if (upload.path) await fs.copyFile(upload.path, src); else await fs.writeFile(src, upload.data ?? new Uint8Array());
  const tags = await probe(src);
  let coverFile = await channelCoverFile(row);
  if (!coverFile) {
    const embedded = path.join(INTAKE_DIR, `${row.id}.embedded.jpg`);
    if (await runFfmpeg(["-i", src, "-an", "-frames:v", "1", embedded], 30_000) && (await exists(embedded))) coverFile = embedded;
  }
  const c = { title, artist } as Candidate;
  const tidy = await tidyFile(src, ext, coverFile, c, path.join(INTAKE_DIR, `${row.id}.tidy`));
  const dur = tags.durationS ?? row.durationS ?? null;
  const trackId = await createManualTrack({ spotifyId: null, title, artist, album: "Single", releaseDate: tags.date?.slice(0, 10) ?? null, durationS: dur, filePath: tidy, mime: AUDIO_MIME[ext]!, sizeBytes: (await fs.stat(tidy)).size });
  const finalPath = path.join(MUSIC_DIR, `${trackId}.${ext}`);
  await fs.copyFile(tidy, finalPath);
  let coverPath: string | null = null;
  if (coverFile) { coverPath = path.join(MUSIC_DIR, `${trackId}.cover.jpg`); await fs.copyFile(coverFile, coverPath); }
  await updateMusicTrack(trackId, { filePath: finalPath, coverPath });
  await updateIntake(row.id, { status: "confirmed", trackId });
  await attachPendingLyrics(trackId, title); // an album booklet page uploaded earlier for this title
  // The channel keeps one tidy copy where Telegram allows it (a bot may upload up to 50 MB); the original is removed only then.
  // That upload can take minutes: it runs after the answer is sent, so the browser (and the proxy in front of it) never waits for Telegram.
  background("musicUploadChannelCopy", async () => {
    try {
      if ((await fs.stat(finalPath)).size <= 49 * 1024 * 1024) {
        const bot = await getBot();
        await bot.api.sendAudio(row.chatId, new InputFile(finalPath, `${artist} - ${title}.${ext}`), { title, performer: artist, duration: dur ?? undefined, caption: `🎵 ${title}\n👤 ${artist}` });
        await bot.api.deleteMessage(row.chatId, row.messageId).catch(() => {});
      }
      if (row.cardChat && row.cardMessageId) await (await getBot()).api.deleteMessage(row.cardChat, row.cardMessageId).catch(() => {});
    } catch (err) { reportWarn("music", `upload ${row.id}: channel copy failed (original kept):`, err); }
    for (const p of [src, tidy, row.coverPath]) if (p && p !== finalPath) await fs.unlink(p).catch(() => {});
  });
  return trackId;
}
