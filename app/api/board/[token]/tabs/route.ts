import { NextResponse } from "next/server";
import {
  listBoardTabs,
  getBoardTab,
  createBoardTab,
  updateBoardTab,
  deleteBoardTab,
  seedBoardTabsOnce,
  logBoardEvent,
} from "@/lib/db";
import { authBoard } from "@/lib/board-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List content tabs (seeds the defaults from the AI analysis on first open).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  await seedBoardTabsOnce(auth!.chatId).catch(() => {});
  const tabs = await listBoardTabs(auth!.chatId);
  return NextResponse.json({ ok: true, tabs });
}

// Create a tab (owner only — this is board management).
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.isOwner) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as {
    title?: string; icon?: string; kind?: string;
    config?: Record<string, unknown>; items?: Array<{ id: string; values: string[] }>;
  };
  const title = (b.title ?? "").toString().trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const kind = b.kind === "filter" ? "filter" : b.kind === "group" ? "group" : "list";
  const defaultConfig =
    kind === "list" ? { fields: ["ستون ۱"] } : kind === "group" ? { by: "assignee" } : {};
  const tab = await createBoardTab({
    chatId: auth!.chatId,
    title,
    icon: (b.icon ?? "").toString().slice(0, 8) || null,
    kind,
    config: b.config ?? defaultConfig,
    items: kind === "list" ? (Array.isArray(b.items) ? b.items : []) : [],
    source: "manual",
  });
  if (tab) {
    await logBoardEvent({
      chatId: auth!.chatId, taskId: null, action: "tab",
      actor: auth!.actor, summary: `🗂 تب «${title}» اضافه شد`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, tab });
}

// Edit a tab. Body/title editable by any approved member; reordering
// and renaming are fine collaboratively (all logged).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.actor) return NextResponse.json({ error: "login required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    id?: number; title?: string; icon?: string | null; position?: number;
    config?: Record<string, unknown>; items?: Array<{ id: string; values: string[] }>;
  };
  const id = Number(b.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const before = await getBoardTab(id, auth!.chatId);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Structural changes (reorder, rename, columns/filter config) are
  // management → owner only. Editing list ITEMS is collaborative.
  if ((b.position !== undefined || b.config !== undefined || b.title !== undefined) && !auth!.isOwner) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  const items = Array.isArray(b.items)
    ? b.items.slice(0, 500).map((it, i) => ({
        id: String(it?.id ?? `r${i}`),
        values: Array.isArray(it?.values) ? it.values.map((v) => String(v ?? "").slice(0, 2000)) : [],
      }))
    : undefined;
  const tab = await updateBoardTab({
    id,
    chatId: auth!.chatId,
    title: b.title,
    icon: "icon" in b ? (b.icon ? String(b.icon).slice(0, 8) : null) : undefined,
    config: b.config,
    items,
    position: b.position,
  });
  if (!tab) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parts: string[] = [];
  if (b.title && b.title !== before.title) parts.push("عنوان");
  if (items !== undefined) parts.push("محتوا");
  if (b.config !== undefined) parts.push("تنظیمات");
  if (b.position !== undefined) parts.push("ترتیب");
  await logBoardEvent({
    chatId: auth!.chatId, taskId: null, action: "tab",
    actor: auth!.actor, summary: `🗂 تب «${before.title}»: ${parts.join("، ") || "ویرایش"}`,
  }).catch(() => {});
  return NextResponse.json({ ok: true, tab });
}

// Delete a tab (owner only).
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const { auth, error } = await authBoard(req, token);
  if (error) return error;
  if (!auth!.isOwner) return NextResponse.json({ error: "owner only" }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const before = await getBoardTab(id, auth!.chatId);
  const ok = await deleteBoardTab({ id, chatId: auth!.chatId });
  if (ok && before) {
    await logBoardEvent({
      chatId: auth!.chatId, taskId: null, action: "tab",
      actor: auth!.actor, summary: `🗂 تب «${before.title}» حذف شد`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok });
}
