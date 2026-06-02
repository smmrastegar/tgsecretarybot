import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  FUNCTION_ROLES,
  listChatsByFunction,
  type FunctionRole,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const byRole: Record<
    FunctionRole,
    Array<{
      chatId: number;
      chatTitle: string | null;
      chatType: string;
      firstName: string | null;
      lastName: string | null;
      nickname: string | null;
      functionConfig: Record<string, unknown> | null;
    }>
  > = {
    downloader: [],
    sms_inbox: [],
    download_archive: [],
    news: [],
  };
  for (const r of FUNCTION_ROLES) {
    const rows = await listChatsByFunction(r);
    byRole[r] = rows.map((c) => ({
      chatId: c.chatId,
      chatTitle: c.chatTitle,
      chatType: c.chatType,
      firstName: c.firstName,
      lastName: c.lastName,
      nickname: c.nickname,
      functionConfig: c.functionConfig,
    }));
  }
  return NextResponse.json({ byRole });
}
