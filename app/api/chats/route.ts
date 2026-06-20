import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  chatFacets,
  type ChatListFilters,
  listChats,
  type Relationship,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bool(v: string | null): boolean | undefined {
  if (v == null) return undefined;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (url.searchParams.get("facets") === "1") {
    try {
      const facets = await chatFacets();
      return NextResponse.json({ facets });
    } catch (err) {
      console.error("[chats] facets failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }
  const limit = url.searchParams.get("limit")
    ? Number(url.searchParams.get("limit"))
    : undefined;
  const offset = url.searchParams.get("offset")
    ? Number(url.searchParams.get("offset"))
    : undefined;

  const filters: ChatListFilters = {
    mode: (url.searchParams.get("mode") as ChatListFilters["mode"]) || null,
    chatType: url.searchParams.get("chatType") || null,
    relationship:
      (url.searchParams.get("relationship") as Relationship | "__unset__") ||
      null,
    functionRole: url.searchParams.get("role") || null,
    vip: bool(url.searchParams.get("vip")),
    muted: bool(url.searchParams.get("muted")),
    isBot: bool(url.searchParams.get("isBot")),
    hasProfile: bool(url.searchParams.get("hasProfile")),
    hasPhone: bool(url.searchParams.get("hasPhone")),
    autoSummarizeOn: bool(url.searchParams.get("autoSummarize")),
    followUpOn: bool(url.searchParams.get("followUp")),
    followUpTranscribeOn: bool(url.searchParams.get("followUpTranscribe")),
    autoForwardVoiceOn: bool(url.searchParams.get("autoForwardVoice")),
    autoForwardVideoOn: bool(url.searchParams.get("autoForwardVideo")),
    autoForwardPhotoOn: bool(url.searchParams.get("autoForwardPhoto")),
    autoExtractNotesOn: bool(url.searchParams.get("autoExtractNotes")),
    profileId: url.searchParams.get("profileId")
      ? Number(url.searchParams.get("profileId"))
      : null,
    q: url.searchParams.get("q"),
  };
  const chats = await listChats({ limit, offset, filters });
  return NextResponse.json({ chats });
}
