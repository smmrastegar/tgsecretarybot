import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  addNoteWatchAlias,
  getNoteWatchItem,
  listNoteWatchAliases,
} from "@/lib/db";
import { extractWatchlistAliasesFromDescription } from "@/lib/classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Reads the concept's free-form description (e.g.
// "خواننده مورد علاقه من. گروه‌هاش: ماخولا، بالزن. بهش امیر بال
// هم می‌گن") and extracts every alternative name / nickname / band
// name / abbreviation the operator mentioned. Each new entry is
// appended to the concept's aliases list — duplicates are skipped
// at the DB layer via the (item_id, alias) unique key.
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const item = await getNoteWatchItem(itemId);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!item.description || !item.description.trim()) {
    return NextResponse.json({
      ok: false,
      error: "این concept توضیح نداره. اول توی textarea توضیح بنویس.",
    });
  }
  const existingAliases = await listNoteWatchAliases(itemId);
  const existingSet = new Set(
    existingAliases.map((a) => a.alias.toLowerCase()),
  );
  const extracted = await extractWatchlistAliasesFromDescription({
    concept: item.concept,
    description: item.description,
  });
  const added: string[] = [];
  const skippedAsDuplicates: string[] = [];
  for (const a of extracted) {
    const trimmed = a.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === item.concept.toLowerCase()) continue;
    if (existingSet.has(trimmed.toLowerCase())) {
      skippedAsDuplicates.push(trimmed);
      continue;
    }
    await addNoteWatchAlias({ itemId, alias: trimmed.slice(0, 200) });
    existingSet.add(trimmed.toLowerCase());
    added.push(trimmed);
  }
  const final = await listNoteWatchAliases(itemId);
  return NextResponse.json({
    ok: true,
    extracted,
    added,
    skippedAsDuplicates,
    aliases: final,
  });
}
