import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  FUNCTION_ROLES,
  listChatsByFunctionWithCategory,
  listFunctionCategories,
  type FunctionRole,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRow = {
  chatId: number;
  chatTitle: string | null;
  chatType: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
};

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // For each role: a map of category-slug → list of chats in that
  // category. Front-end can present "Downloader bots: {default: [...],
  // work: [...], news: [...]}" naturally.
  const byRole = Object.fromEntries(
    FUNCTION_ROLES.map((r) => [r, {} as Record<string, ChatRow[]>]),
  ) as Record<FunctionRole, Record<string, ChatRow[]>>;

  for (const role of FUNCTION_ROLES) {
    const rows = await listChatsByFunctionWithCategory(role);
    const grouped: Record<string, ChatRow[]> = {};
    for (const r of rows) {
      const cat = r.category || "default";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        chatId: r.chatId,
        chatTitle: r.chatTitle,
        chatType: r.chatType,
        firstName: r.firstName,
        lastName: r.lastName,
        nickname: r.nickname,
      });
    }
    byRole[role] = grouped;
  }

  const categories = await listFunctionCategories();
  return NextResponse.json({ byRole, categories });
}
