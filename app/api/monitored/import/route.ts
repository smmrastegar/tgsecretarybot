import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getBot } from "@/lib/bot";
import { config } from "@/lib/config";
import {
  audit,
  getMonitoredAccount,
  upsertMonitoredAccounts,
} from "@/lib/db";
import { HikerOutOfCreditsError } from "@/lib/hikerapi";
import { processAccount, resolveTargetChat } from "@/lib/instagram-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Parse a CSV with the header:
//   id;type;param;url;created_at;topic_id
// Separator is auto-detected (`;` then `,`). Quoted values are
// supported. Header is matched case-insensitively. type/platform
// filters to "instagram" only for now.
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return rows;
  const firstLine = lines[0]!;
  const sep = firstLine.includes(";")
    ? ";"
    : firstLine.includes("\t")
      ? "\t"
      : ",";
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else {
        if (c === '"') inQ = true;
        else if (c === sep) {
          out.push(cur);
          cur = "";
        } else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(firstLine).map((h) => h.toLowerCase());
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let csvText = "";
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const body = (await request.json()) as { csv?: string };
      csvText = body.csv ?? "";
    } else {
      csvText = await request.text();
    }
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!csvText.trim()) {
    return NextResponse.json({ error: "empty csv" }, { status: 400 });
  }

  const parsed = parseCsv(csvText);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "no rows parsed" }, { status: 400 });
  }
  const items = parsed
    .map((r) => {
      const platform = (r.type || r.platform || "instagram").toLowerCase();
      const username = (r.param || r.username || "").trim();
      const url = (r.url || "").trim() || null;
      const externalId = (r.id || r.external_id || "").trim() || null;
      const topicId = (r.topic_id || r.topicid || "").trim() || null;
      return { platform, username, url, externalId, topicId };
    })
    .filter((r) => r.platform === "instagram" && r.username);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "no valid instagram rows" },
      { status: 400 },
    );
  }
  const { inserted, updated, insertedIds } = await upsertMonitoredAccounts(items);
  await audit({
    actorId: session.userId,
    actorName: session.username ?? null,
    action: "monitor.import",
    details: { inserted, updated, parsed: parsed.length },
  });

  // Immediate on-add processing for newly inserted accounts. We cap
  // to a handful so a 47-row CSV doesn't try to fan out 47 × 4
  // HikerAPI calls inside a 60s function — the cron picks up the
  // rest within 5 minutes.
  const IMMEDIATE_ON_ADD = 5;
  let detected = 0;
  let forwarded = 0;
  const errors: string[] = [];
  let outOfCredits: { message: string; billingUrl: string } | null = null;
  if (insertedIds.length > 0 && config.hikerApiKey) {
    const target = await resolveTargetChat();
    if (target) {
      const bot = getBot();
      const slice = insertedIds.slice(0, IMMEDIATE_ON_ADD);
      for (const id of slice) {
        const acc = await getMonitoredAccount(id);
        if (!acc) continue;
        try {
          const result = await processAccount({
            account: acc,
            target,
            bot,
            forceAllKinds: true,
            postsLimit: 3,
            reelsLimit: 0,
          });
          detected += result.detected;
          forwarded += result.forwarded;
          errors.push(...result.errors);
        } catch (err) {
          if (err instanceof HikerOutOfCreditsError) {
            // Bail out — every subsequent account would hit the same 402.
            outOfCredits = { message: err.message, billingUrl: err.billingUrl };
            errors.push(`HikerAPI out of credits: ${err.message}`);
            break;
          }
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    updated,
    parsed: parsed.length,
    valid: items.length,
    immediatelyProcessed: Math.min(insertedIds.length, IMMEDIATE_ON_ADD),
    detected,
    forwarded,
    errors: errors.slice(0, 10),
    ...(outOfCredits
      ? { outOfCredits: true, billingUrl: outOfCredits.billingUrl }
      : {}),
  });
}
